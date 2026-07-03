"""PiEEG-16 sample decoding — pure-Python, dependency-free.

Split out from spi_driver.py so the math is testable on hosts without
gpiod / spidev (CI runners, dev laptops). Hardware I/O stays in spi_driver.py.

(Copied from eeg_roomba/pi_a_acquirer/codec.py — unchanged.)
"""
from __future__ import annotations

# Conversion: ±4.5V full scale across 24-bit signed → μV, divided by PGA gain.
# Both ADS1299 chips on PiEEG-16 are initialized with CH?SET = 0x00 (gain=6)
# to match the upstream PiEEG-16 GUI reference (2.Graph_Gpio_D_1_5_4_OS.py).
_PGA_GAIN = 6
_VREF = 4.5
_FULLSCALE = (2**23) - 1
_UV_SCALE = 1_000_000 * _VREF / (_PGA_GAIN * _FULLSCALE)

# 3 status bytes + 8 channels * 3 bytes per ADS1299 frame.
_FRAME_BYTES = 27


def _decode_frame(buf: bytes) -> list[float]:
    """Decode one 27-byte ADS1299 frame into 8 channel μV values.

    Skips the leading 3 status bytes, then reads 8 big-endian int24
    samples and applies two's-complement + `_UV_SCALE`.
    """
    out: list[float] = []
    for i in range(8):
        b0, b1, b2 = buf[3 + i * 3], buf[4 + i * 3], buf[5 + i * 3]
        raw = (b0 << 16) | (b1 << 8) | b2
        if raw & 0x800000:
            raw -= 0x1000000
        out.append(raw * _UV_SCALE)
    return out
