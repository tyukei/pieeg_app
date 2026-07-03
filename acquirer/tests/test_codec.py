"""Unit tests for acquirer.codec.

Pure-math tests so they run on CI without gpiod / spidev.
(Copied from eeg_roomba/pi_a_acquirer/tests/test_codec.py.)
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from codec import _FRAME_BYTES, _PGA_GAIN, _UV_SCALE, _decode_frame  # noqa: E402


def test_uv_scale_matches_pieeg_gui_with_gain_6() -> None:
    # PiEEG-16 GUI uses: result = 1_000_000 * 4.5 * (raw / 16_777_215)
    # That is gain-1 baseline. We divide by PGA gain (=6) on top.
    expected = 1_000_000 * 4.5 / (6 * (2**23 - 1))
    assert abs(_UV_SCALE - expected) < 1e-15
    assert _PGA_GAIN == 6


def test_frame_size_constant() -> None:
    assert _FRAME_BYTES == 27


def test_decode_frame_returns_eight_floats() -> None:
    buf = bytes(_FRAME_BYTES)  # all zeros
    out = _decode_frame(buf)
    assert len(out) == 8
    assert all(v == 0.0 for v in out)


def test_decode_frame_positive_max() -> None:
    """Channel 0 raw = +max int24 (0x7FFFFF) → +full_scale / gain μV."""
    buf = bytearray(_FRAME_BYTES)
    buf[3], buf[4], buf[5] = 0x7F, 0xFF, 0xFF
    out = _decode_frame(bytes(buf))
    assert abs(out[0] - 750_000.0) < 1.0
    assert all(out[i] == 0.0 for i in range(1, 8))


def test_decode_frame_negative_max() -> None:
    """Channel 0 raw = -2^23 (0x800000) → -full_scale / gain μV (two's complement)."""
    buf = bytearray(_FRAME_BYTES)
    buf[3], buf[4], buf[5] = 0x80, 0x00, 0x00
    out = _decode_frame(bytes(buf))
    assert -750_001.0 < out[0] < -750_000.0
    assert all(out[i] == 0.0 for i in range(1, 8))


def test_decode_frame_skips_status_bytes() -> None:
    """First 3 bytes are status, must be ignored."""
    buf = bytearray(_FRAME_BYTES)
    buf[0], buf[1], buf[2] = 0xFF, 0xFF, 0xFF  # status: all ones
    out = _decode_frame(bytes(buf))
    assert all(v == 0.0 for v in out)


def test_decode_frame_per_channel_independence() -> None:
    """Each channel is decoded from its own 3 bytes; verify ch3 in isolation."""
    buf = bytearray(_FRAME_BYTES)
    buf[12], buf[13], buf[14] = 0x00, 0x00, 0x01  # raw = +1 LSB
    out = _decode_frame(bytes(buf))
    assert abs(out[3] - _UV_SCALE) < 1e-9
    assert all(out[i] == 0.0 for i in (0, 1, 2, 4, 5, 6, 7))


def test_decode_frame_realistic_eeg_range() -> None:
    """A ±50 μV raw input should produce ±50 μV output (μV stays μV)."""
    target_uv = 50.0
    raw = int(round(target_uv / _UV_SCALE))
    buf = bytearray(_FRAME_BYTES)
    buf[3] = (raw >> 16) & 0xFF
    buf[4] = (raw >> 8) & 0xFF
    buf[5] = raw & 0xFF
    out = _decode_frame(bytes(buf))
    assert abs(out[0] - target_uv) <= _UV_SCALE
