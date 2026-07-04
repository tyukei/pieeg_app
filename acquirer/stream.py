"""Acquirer → server bridge.

Reads 16ch samples and streams them to the aggregation server over a WebSocket
as ~100 ms JSON chunks:

    {"ts": <unix_seconds>, "srate": 250, "samples": [[16 floats], ...]}

Three sources (chosen with --source):
    sim       synthetic EEG, no hardware (laptop / CI / GitHub Pages demo)
    hardware  read the PiEEG-16 over SPI directly (needs gpiod/spidev; claims SPI)
    lsl       tap an existing LSL stream (e.g. the reference pieeg-acquirer daemon)
              — does NOT touch SPI, so the original service keeps running

Usage:
    python stream.py --source sim  --server ws://localhost:8000/ingest
    python stream.py --source lsl  --server ws://localhost:8000/ingest --lsl-name PiEEG-16
    python stream.py --source hardware --server ws://analysis-pc.local:8000/ingest
"""
from __future__ import annotations

import argparse
import asyncio
import contextlib
import json
import logging
import time

import websockets

SRATE = 250
CHUNK = 25  # samples per WebSocket message ≈ 100 ms at 250 Hz

log = logging.getLogger("acquirer")


class _SampleSource:
    """Wraps a per-sample device (sim/hardware) as a chunk reader."""

    def __init__(self, dev, srate: int, paced: bool) -> None:
        self.dev = dev
        self.srate = srate
        self.paced = paced  # True → caller must sleep to run at real time

    def read_chunk(self, n: int) -> list[list[float]]:
        out: list[list[float]] = []
        while len(out) < n:
            try:
                out.append(self.dev.read_sample())
            except OSError:
                log.warning("SPI read error")
        return out

    def close(self) -> None:
        self.dev.close()


def _make_source(kind: str, lsl_name: str):
    """Return an object exposing read_chunk(n), .srate, .paced, close()."""
    if kind == "hardware":
        from spi_driver import PiEEG16  # imports gpiod/spidev; Pi only

        return _SampleSource(PiEEG16(), SRATE, paced=False)
    if kind == "sim":
        from simulator import SimulatedPiEEG16

        return _SampleSource(SimulatedPiEEG16(srate=SRATE, seed=None), SRATE, paced=True)
    if kind == "lsl":
        from lsl_source import LSLSource

        src = LSLSource(name=lsl_name)
        src.paced = False  # LSL pull_chunk blocks/paces itself
        return src
    raise ValueError(f"unknown source: {kind!r} (use sim | hardware | lsl)")


async def run(source: str, server: str, lsl_name: str = "PiEEG-16") -> None:
    dev = _make_source(source, lsl_name)
    srate = dev.srate
    paced = getattr(dev, "paced", False)
    period = CHUNK / srate
    log.info("acquirer started: source=%s → %s (%d Hz)", source, server, srate)
    try:
        while True:
            try:
                async with websockets.connect(server, max_queue=None) as ws:
                    log.info("connected to %s", server)
                    next_tick = time.perf_counter()
                    while True:
                        chunk = await asyncio.to_thread(dev.read_chunk, CHUNK)
                        if not chunk:
                            continue
                        await ws.send(
                            json.dumps({"ts": time.time(), "srate": srate, "samples": chunk})
                        )
                        if paced:
                            next_tick += period
                            sleep = next_tick - time.perf_counter()
                            if sleep > 0:
                                await asyncio.sleep(sleep)
                            else:
                                next_tick = time.perf_counter()
            except (OSError, websockets.WebSocketException) as e:
                log.warning("connection lost (%s); retrying in 2s", e)
                await asyncio.sleep(2.0)
    finally:
        dev.close()


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    p = argparse.ArgumentParser(description="PiEEG-16 acquirer → server bridge")
    p.add_argument("--source", choices=["sim", "hardware", "lsl"], default="sim")
    p.add_argument("--server", default="ws://localhost:8000/ingest")
    p.add_argument("--lsl-name", default="PiEEG-16", help="LSL stream name for --source lsl")
    args = p.parse_args()
    with contextlib.suppress(KeyboardInterrupt):
        asyncio.run(run(args.source, args.server, args.lsl_name))


if __name__ == "__main__":
    main()
