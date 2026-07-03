"""Tests for the server Hub (buffering + frame assembly), no live sockets."""
from __future__ import annotations

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from main import Hub  # noqa: E402  (requires fastapi + numpy)

SRATE = 250


def _chunk(freq: float, n: int, nch: int = 16, srate: int = SRATE) -> list[list[float]]:
    return [
        [10.0 * math.sin(2 * math.pi * freq * (i / srate)) for _ in range(nch)]
        for i in range(n)
    ]


def test_add_chunk_updates_counters() -> None:
    hub = Hub(srate=SRATE)
    hub.add_chunk(_chunk(10.0, 25), srate=SRATE)
    assert hub.samples_total == 25
    assert hub.last_ingest_ts > 0


def test_frame_none_when_empty() -> None:
    assert Hub(srate=SRATE).aggregate_frame() is None


def test_frame_has_expected_fields() -> None:
    hub = Hub(srate=SRATE)
    hub.add_chunk(_chunk(10.0, SRATE), srate=SRATE)
    frame = hub.aggregate_frame()
    assert frame is not None
    for key in ("ts", "srate", "channels", "raw", "bands", "bands_per_ch", "samples_total"):
        assert key in frame
    assert frame["channels"] == 16
    assert set(frame["bands"]) == {"delta", "theta", "alpha", "beta", "gamma"}
    assert frame["bands_per_ch"]["alpha"].__len__() == 16


def test_frame_alpha_dominates_for_10hz_input() -> None:
    hub = Hub(srate=SRATE)
    hub.add_chunk(_chunk(10.0, SRATE), srate=SRATE)
    bands = hub.aggregate_frame()["bands"]
    assert max(bands, key=bands.get) == "alpha"


def test_raw_is_downsampled() -> None:
    hub = Hub(srate=SRATE)
    hub.add_chunk(_chunk(10.0, SRATE), srate=SRATE)  # 1 s of 250 Hz
    frame = hub.aggregate_frame()
    # display target 50 Hz → step 5 → ~50 rows, far fewer than 250.
    assert len(frame["raw"]) < SRATE
    assert frame["display_hz"] == 50


def test_buffer_bounded() -> None:
    hub = Hub(srate=SRATE)
    for _ in range(10):
        hub.add_chunk(_chunk(10.0, SRATE), srate=SRATE)  # 10 s pushed
    # RAW_SECONDS=4 → buffer capped near 4 s worth.
    assert len(hub.buf) <= SRATE * 4
