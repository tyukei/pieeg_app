"""Unit tests for server.aggregate — the band-power math."""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from aggregate import BANDS, band_powers, band_powers_mean  # noqa: E402

SRATE = 250


def _sine(freq: float, n: int, srate: int = SRATE, nch: int = 16, amp: float = 10.0) -> np.ndarray:
    t = np.arange(n) / srate
    col = amp * np.sin(2 * np.pi * freq * t)
    return np.tile(col[:, None], (1, nch))


def test_band_keys_present() -> None:
    out = band_powers(_sine(10.0, SRATE), SRATE)
    assert set(out.keys()) == set(BANDS.keys())


def test_shape_per_channel() -> None:
    out = band_powers(_sine(10.0, SRATE, nch=16), SRATE)
    for vals in out.values():
        assert len(vals) == 16


def test_alpha_tone_lands_in_alpha_band() -> None:
    """A pure 10 Hz sine should put nearly all its energy in the alpha band."""
    out = band_powers_mean(_sine(10.0, SRATE), SRATE)
    dominant = max(out, key=out.get)
    assert dominant == "alpha"
    others = sum(v for k, v in out.items() if k != "alpha")
    assert out["alpha"] > 5.0 * others


def test_beta_tone_lands_in_beta_band() -> None:
    out = band_powers_mean(_sine(20.0, SRATE), SRATE)
    assert max(out, key=out.get) == "beta"


def test_theta_tone_lands_in_theta_band() -> None:
    out = band_powers_mean(_sine(6.0, SRATE), SRATE)
    assert max(out, key=out.get) == "theta"


def test_larger_amplitude_gives_more_power() -> None:
    small = band_powers_mean(_sine(10.0, SRATE, amp=5.0), SRATE)
    big = band_powers_mean(_sine(10.0, SRATE, amp=10.0), SRATE)
    # Power ∝ amplitude²; doubling amplitude ≈ 4× power.
    assert big["alpha"] > 3.0 * small["alpha"]


def test_dc_offset_ignored() -> None:
    """A constant offset is detrended out and must not leak into any band."""
    win = np.full((SRATE, 16), 123.4)
    out = band_powers_mean(win, SRATE)
    assert all(v < 1e-6 for v in out.values())


def test_rejects_bad_shape() -> None:
    import pytest

    with pytest.raises(ValueError):
        band_powers(np.zeros(10), SRATE)  # 1-D
    with pytest.raises(ValueError):
        band_powers(np.zeros((1, 16)), SRATE)  # too few samples


def test_mean_matches_manual_mean() -> None:
    win = _sine(10.0, SRATE)
    per_ch = band_powers(win, SRATE)
    mean = band_powers_mean(win, SRATE)
    for band in BANDS:
        assert abs(mean[band] - float(np.mean(per_ch[band]))) < 1e-9
