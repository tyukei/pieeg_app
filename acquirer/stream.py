"""Acquirer → server bridge.

Reads 16ch samples from a PiEEG-16 (hardware) or the simulator and streams them
to the aggregation server over a WebSocket as 100 ms JSON chunks:

    {"ts": <unix_seconds_of_first_sample>, "srate": 250, "samples": [[16 floats], ...]}

Replaces the reference project's LSL outlet + MQTT beacon with a single plain
WebSocket so the whole pipeline is self-contained (no LSL / MQTT broker needed).

Usage:
    python stream.py --source sim  --server ws://localhost:8000/ingest
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
CHUNK = 25  # samples per WebSocket message = 100 ms at 250 Hz

log = logging.getLogger("acquirer")


def _make_source(kind: str):
    """Return an object exposing read_sample() -> list[float] and close()."""
    if kind == "hardware":
        from spi_driver import PiEEG16  # imports gpiod/spidev; Pi only

        return PiEEG16()
    if kind == "sim":
        from simulator import SimulatedPiEEG16

        return SimulatedPiEEG16(srate=SRATE, seed=None)
    raise ValueError(f"unknown source: {kind!r} (use 'sim' or 'hardware')")


def _read_chunk(dev, n: int) -> list[list[float]]:
    """Read n samples. Skips SPI read errors on hardware (matches reference)."""
    samples: list[list[float]] = []
    while len(samples) < n:
        try:
            samples.append(dev.read_sample())
        except OSError:
            log.warning("SPI read error")
    return samples


async def run(source: str, server: str, srate: int = SRATE) -> None:
    dev = _make_source(source)
    period = CHUNK / srate
    log.info("acquirer started: source=%s → %s (%d Hz)", source, server, srate)
    try:
        while True:
            try:
                async with websockets.connect(server, max_queue=None) as ws:
                    log.info("connected to %s", server)
                    next_tick = time.perf_counter()
                    while True:
                        # For the simulator, pace to real time; hardware paces
                        # itself by blocking on DRDY inside read_sample().
                        chunk = await asyncio.to_thread(_read_chunk, dev, CHUNK)
                        msg = json.dumps(
                            {"ts": time.time(), "srate": srate, "samples": chunk}
                        )
                        await ws.send(msg)
                        if source == "sim":
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
    p.add_argument("--source", choices=["sim", "hardware"], default="sim")
    p.add_argument("--server", default="ws://localhost:8000/ingest")
    p.add_argument("--srate", type=int, default=SRATE)
    args = p.parse_args()
    with contextlib.suppress(KeyboardInterrupt):
        asyncio.run(run(args.source, args.server, args.srate))


if __name__ == "__main__":
    main()
