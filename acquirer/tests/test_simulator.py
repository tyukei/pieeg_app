"""Unit tests for acquirer.simulator (no hardware)."""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from simulator import NCH, SimulatedPiEEG16  # noqa: E402


def test_read_sample_shape_and_type() -> None:
    dev = SimulatedPiEEG16(seed=0)
    s = dev.read_sample()
    assert len(s) == NCH
    assert all(isinstance(v, float) for v in s)


def test_stats_increment() -> None:
    dev = SimulatedPiEEG16(seed=0)
    for _ in range(10):
        dev.read_sample()
    assert dev.stats.samples == 10
    assert dev.stats.spi_errors == 0


def test_deterministic_with_seed() -> None:
    a = SimulatedPiEEG16(seed=42)
    b = SimulatedPiEEG16(seed=42)
    assert a.read_sample() == b.read_sample()


def test_values_in_plausible_eeg_range() -> None:
    """Synthetic μV should stay well inside the ±750000 μV hardware full scale."""
    dev = SimulatedPiEEG16(seed=1)
    for _ in range(2500):  # 10 s at 250 Hz — spans a full alpha-burst cycle
        for v in dev.read_sample():
            assert -500.0 < v < 500.0


def test_alpha_power_modulates_over_time() -> None:
    """The 10 Hz alpha component should visibly wax and wane across the burst."""
    import math

    dev = SimulatedPiEEG16(seed=0)
    srate = dev.srate
    # Collect ch0 over 10 s, correlate against a 10 Hz probe in an early vs late
    # window; alpha energy should differ because of the burst envelope.
    ch0 = [dev.read_sample()[0] for _ in range(srate * 10)]

    def alpha_energy(seg: list[float], start: int) -> float:
        e = 0.0
        for i, v in enumerate(seg):
            t = (start + i) / srate
            e += v * math.sin(2 * math.pi * 10.0 * t)
        return abs(e)

    win = srate  # 1 s windows
    energies = [alpha_energy(ch0[k : k + win], k) for k in range(0, srate * 10 - win, win)]
    assert max(energies) > 2.0 * min(energies)
