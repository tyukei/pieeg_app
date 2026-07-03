"""End-to-end smoke check: acquirer(sim) → server → web-client frame.

Starts nothing itself; assumes `uvicorn main:app` is already running on :8000.
Streams a few simulated chunks into /ingest and asserts a well-formed aggregated
frame arrives on /ws with alpha present. Exits non-zero on failure.
"""
from __future__ import annotations

import asyncio
import json
import sys
import time

import websockets

BASE = "ws://localhost:8000"


async def feed_ingest(stop: asyncio.Event) -> None:
    sys.path.insert(0, "acquirer")
    from simulator import SimulatedPiEEG16

    dev = SimulatedPiEEG16(seed=1)
    async with websockets.connect(f"{BASE}/ingest") as ws:
        while not stop.is_set():
            chunk = [dev.read_sample() for _ in range(25)]
            await ws.send(json.dumps({"ts": time.time(), "srate": 250, "samples": chunk}))
            await asyncio.sleep(0.1)


async def main() -> int:
    stop = asyncio.Event()
    feeder = asyncio.create_task(feed_ingest(stop))
    try:
        async with websockets.connect(f"{BASE}/ws") as ws:
            frame = json.loads(await asyncio.wait_for(ws.recv(), timeout=5.0))
    finally:
        stop.set()
        feeder.cancel()

    assert frame["channels"] == 16, frame["channels"]
    assert set(frame["bands"]) == {"delta", "theta", "alpha", "beta", "gamma"}
    assert len(frame["raw"]) > 0
    assert len(frame["bands_per_ch"]["alpha"]) == 16
    print("E2E OK — frame:", {k: frame[k] for k in ("channels", "srate", "samples_total")})
    print("bands:", {k: round(v, 3) for k, v in frame["bands"].items()})
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
