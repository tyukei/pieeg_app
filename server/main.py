"""Aggregation server.

Pipeline (replaces the reference LSL/MQTT/TimescaleDB stack with one process):

    acquirer --WS /ingest--> [sliding window] --band_powers()--> WS /ws --> web

- WS  /ingest : the acquirer pushes {"ts", "srate", "samples": [[16f], ...]} chunks.
- WS  /ws     : web clients receive aggregated frames ~4×/s:
      {"ts", "srate", "channels", "raw": [[..downsampled..]], "bands": {...},
       "bands_per_ch": {...}, "samples_total"}
- GET /health : liveness + counters.

Run:  uvicorn main:app --host 0.0.0.0 --port 8000
"""
from __future__ import annotations

import asyncio
import contextlib
import logging
import time
from collections import deque
from contextlib import asynccontextmanager

import numpy as np
from aggregate import BANDS, band_powers, band_powers_mean
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

log = logging.getLogger("server")

NCH = 16
DEFAULT_SRATE = 250
WIN_SEC = 1.0        # analysis window (default; adjustable at runtime)
HOP_SEC = 0.25       # emit cadence (default; adjustable at runtime)
WIN_MIN, WIN_MAX = 0.25, 4.0   # allowed analysis-window range (s)
HOP_MIN, HOP_MAX = 0.05, 2.0   # allowed slide/hop range (s)
DISPLAY_HZ = 50      # raw waveform downsample target for the UI
RAW_SECONDS = 6.0    # recent raw buffered server-side (≥ WIN_MAX + display headroom)


class Hub:
    """Holds the sliding sample buffer and the set of connected web clients."""

    def __init__(self, srate: int = DEFAULT_SRATE, nch: int = NCH) -> None:
        self.srate = srate
        self.nch = nch
        self.win_sec = WIN_SEC
        self.hop_sec = HOP_SEC
        self.win_n = int(srate * self.win_sec)
        self.buf: deque[list[float]] = deque(maxlen=int(srate * RAW_SECONDS))
        self.clients: set[WebSocket] = set()
        self.samples_total = 0
        self.last_ingest_ts = 0.0

    def set_config(self, win_sec: float | None = None, hop_sec: float | None = None) -> None:
        """Clamp and apply a runtime window/hop change (from a web client)."""
        if win_sec is not None:
            self.win_sec = max(WIN_MIN, min(WIN_MAX, float(win_sec)))
            self.win_n = max(2, int(self.srate * self.win_sec))
        if hop_sec is not None:
            self.hop_sec = max(HOP_MIN, min(HOP_MAX, float(hop_sec)))

    def add_chunk(self, samples: list[list[float]], srate: int | None = None) -> None:
        if srate and srate != self.srate:
            self.srate = srate
            self.win_n = max(2, int(srate * self.win_sec))
        for s in samples:
            self.buf.append(s)
        self.samples_total += len(samples)
        self.last_ingest_ts = time.time()

    def _downsample(self, window: np.ndarray) -> list[list[float]]:
        step = max(1, int(round(self.srate / DISPLAY_HZ)))
        return window[::step].tolist()

    def aggregate_frame(self) -> dict | None:
        """Build one broadcast frame from the current window, or None if too little data."""
        if len(self.buf) < 2:
            return None
        window = np.asarray(self.buf, dtype="float64")  # [N, ch]
        analysis = window[-self.win_n :] if len(window) >= self.win_n else window
        return {
            "ts": self.last_ingest_ts,
            "srate": self.srate,
            "channels": window.shape[1],
            "raw": self._downsample(window),
            "display_hz": min(DISPLAY_HZ, self.srate),
            "bands": band_powers_mean(analysis, self.srate),
            "bands_per_ch": band_powers(analysis, self.srate),
            "samples_total": self.samples_total,
            "win_sec": self.win_sec,
            "hop_sec": self.hop_sec,
        }

    async def broadcast(self, frame: dict) -> None:
        if not self.clients:
            return
        import json

        msg = json.dumps(frame)
        dead: list[WebSocket] = []
        for ws in self.clients:
            try:
                await ws.send_text(msg)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.clients.discard(ws)


hub = Hub()


async def _emit_loop() -> None:
    while True:
        await asyncio.sleep(hub.hop_sec)  # cadence is runtime-adjustable
        frame = hub.aggregate_frame()
        if frame is not None:
            await hub.broadcast(frame)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    task = asyncio.create_task(_emit_loop())
    log.info("aggregation server up: win=%.1fs hop=%.2fs", WIN_SEC, HOP_SEC)
    try:
        yield
    finally:
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task


app = FastAPI(title="PiEEG aggregation server", lifespan=lifespan)
# The web UI is served from GitHub Pages (a different origin), so allow CORS /
# cross-origin WebSocket upgrades from anywhere for this LAN demo.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health() -> dict:
    online = (time.time() - hub.last_ingest_ts) < 3.0 if hub.last_ingest_ts else False
    return {
        "status": "ok",
        "ingest_online": online,
        "samples_total": hub.samples_total,
        "clients": len(hub.clients),
        "srate": hub.srate,
        "bands": list(BANDS.keys()),
    }


@app.websocket("/ingest")
async def ingest(ws: WebSocket) -> None:
    await ws.accept()
    log.info("acquirer connected")
    try:
        while True:
            data = await ws.receive_json()
            hub.add_chunk(data["samples"], data.get("srate"))
    except WebSocketDisconnect:
        log.info("acquirer disconnected")
    except Exception as e:  # noqa: BLE001
        log.warning("ingest error: %s", e)


@app.websocket("/ws")
async def ws_clients(ws: WebSocket) -> None:
    await ws.accept()
    hub.clients.add(ws)
    log.info("web client connected (%d total)", len(hub.clients))
    try:
        while True:
            # Clients mostly receive; an inbound message may carry a
            # {"win_sec":..,"hop_sec":..} config to adjust the sliding window.
            text = await ws.receive_text()
            try:
                import json

                cfg = json.loads(text)
                hub.set_config(cfg.get("win_sec"), cfg.get("hop_sec"))
                log.info("config: win=%.2fs hop=%.2fs", hub.win_sec, hub.hop_sec)
            except Exception:
                pass  # ignore non-config keepalives
    except WebSocketDisconnect:
        pass
    finally:
        hub.clients.discard(ws)
        log.info("web client disconnected (%d total)", len(hub.clients))


