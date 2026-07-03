"""Band-power aggregation — pure NumPy, no I/O.

Mirrors the reference feature_svc (Welch PSD → δ/θ/α/β/γ band integrals) but is a
dependency-light, side-effect-free function so it is trivial to unit-test.

The server keeps a sliding window of raw samples and calls `band_powers()` once
per hop to produce the numbers the web UI plots.
"""
from __future__ import annotations

import numpy as np

# Canonical EEG bands (Hz), identical to the reference project.
BANDS: dict[str, tuple[float, float]] = {
    "delta": (1.0, 4.0),
    "theta": (4.0, 8.0),
    "alpha": (8.0, 13.0),
    "beta": (13.0, 30.0),
    "gamma": (30.0, 45.0),
}


def _psd(window: np.ndarray, srate: float) -> tuple[np.ndarray, np.ndarray]:
    """Single-segment periodogram with a Hann taper.

    window: [N, ch] float array. Returns (freqs [F], psd [F, ch]) with psd in
    μV²/Hz. NumPy-only stand-in for scipy.signal.welch — good enough for a demo
    and keeps the server free of a scipy dependency.
    """
    x = np.asarray(window, dtype="float64")
    if x.ndim != 2:
        raise ValueError("window must be 2-D [N, ch]")
    n = x.shape[0]
    x = x - x.mean(axis=0, keepdims=True)  # detrend (remove DC)
    taper = np.hanning(n)
    xw = x * taper[:, None]
    # Window-power normalization so the PSD scale is independent of N.
    norm = (taper**2).sum() * srate
    spec = np.fft.rfft(xw, axis=0)
    psd = (np.abs(spec) ** 2) / norm
    psd[1:-1] *= 2.0  # one-sided: double all but DC and Nyquist
    freqs = np.fft.rfftfreq(n, d=1.0 / srate)
    return freqs, psd


def _integrate_band(freqs: np.ndarray, psd: np.ndarray, lo: float, hi: float) -> np.ndarray:
    mask = (freqs >= lo) & (freqs <= hi)
    if not mask.any():
        return np.zeros(psd.shape[1])
    return np.trapezoid(psd[mask], freqs[mask], axis=0)


def band_powers(window: np.ndarray, srate: float) -> dict[str, list[float]]:
    """Per-channel band power for each EEG band.

    Returns {band: [power_ch0, power_ch1, ...]} in μV². Requires at least a few
    samples; raises ValueError on an empty window.
    """
    x = np.asarray(window, dtype="float64")
    if x.ndim != 2 or x.shape[0] < 2:
        raise ValueError("need at least 2 samples in a 2-D [N, ch] window")
    freqs, psd = _psd(x, srate)
    return {
        name: _integrate_band(freqs, psd, lo, hi).tolist()
        for name, (lo, hi) in BANDS.items()
    }


def band_powers_mean(window: np.ndarray, srate: float) -> dict[str, float]:
    """Band power averaged across all channels — the headline numbers for the UI."""
    per_ch = band_powers(window, srate)
    return {name: float(np.mean(vals)) for name, vals in per_ch.items()}
