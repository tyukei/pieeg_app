"""Synthetic PiEEG-16 source — no hardware required.

Drop-in replacement for `spi_driver.PiEEG16` so `stream.py` runs on a laptop or
in CI. Generates 16 channels of plausible EEG in μV: a mix of band oscillations
(δ/θ/α/β) plus noise, with an "alpha burst" that periodically rises and falls so
the aggregated band powers on the web UI visibly move.

Dependency-free (stdlib only) to keep the acquirer light on the Pi.
"""
from __future__ import annotations

import math
import random
from dataclasses import dataclass

NCH = 16
SRATE = 250

# (frequency Hz, base amplitude μV) for the always-on background rhythms.
_BANDS = [
    (2.0, 8.0),    # delta
    (6.0, 6.0),    # theta
    (10.0, 12.0),  # alpha (modulated by the burst envelope below)
    (20.0, 4.0),   # beta
]
# Alpha burst: a slow envelope (period ~10 s) scaling the 10 Hz component.
_ALPHA_BURST_PERIOD = 10.0


@dataclass
class FrameStats:
    samples: int = 0
    spi_errors: int = 0


class SimulatedPiEEG16:
    """Generates one 16-channel μV sample per `read_sample()` call.

    Mirrors the PiEEG16 API (`read_sample`, `stats`, `close`) so callers do not
    care whether the data is real or synthetic.
    """

    def __init__(self, srate: int = SRATE, seed: int | None = 0) -> None:
        self.srate = srate
        self._rng = random.Random(seed)
        self._n = 0  # sample counter → phase
        self.stats = FrameStats()
        # Per-channel phase offsets so channels are not identical.
        self._phase = [self._rng.uniform(0, 2 * math.pi) for _ in range(NCH)]

    def read_sample(self) -> list[float]:
        t = self._n / self.srate
        # Alpha envelope in [0, 1]: peaks/troughs on a 10 s cycle.
        alpha_env = 0.5 * (1.0 + math.sin(2 * math.pi * t / _ALPHA_BURST_PERIOD))
        out: list[float] = []
        for ch in range(NCH):
            ph = self._phase[ch]
            v = 0.0
            for freq, amp in _BANDS:
                gain = (0.4 + 1.2 * alpha_env) if abs(freq - 10.0) < 0.1 else 1.0
                v += amp * gain * math.sin(2 * math.pi * freq * t + ph)
            v += self._rng.gauss(0.0, 3.0)  # broadband noise
            out.append(v)
        self._n += 1
        self.stats.samples += 1
        return out

    def close(self) -> None:  # symmetry with PiEEG16
        pass
