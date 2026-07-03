"""PiEEG-16 SPI driver.

Extracted from upstream `2.Graph_Gpio_D_1_5_4_OS.py`. Two ADS129x chips on
SPI0/SPI0-CS1, 16ch total at 250 Hz, 24-bit signed samples scaled to microvolts.

Hardware layout:
  Chip A: spidev0.0 (GPIO8 CS), RDATAC continuous mode, DRDY → GPIO26
  Chip B: spidev0.1 (GPIO7 CS) + GPIO19 software MUX, SDATAC+RDATA command mode

(Copied from eeg_roomba/pi_a_acquirer/spi_driver.py — unchanged. Imports gpiod /
spidev, so it only loads on the Raspberry Pi. On a laptop use simulator.py.)
"""
from __future__ import annotations

import time
from collections.abc import Callable
from dataclasses import dataclass

import gpiod
import spidev
from codec import _FRAME_BYTES, _decode_frame
from gpiod.line import Direction, Edge, Value

_CS_LINE = 19           # GPIO19: software MUX for chip B MISO routing
_DRDY_LINE = 26         # GPIO26: DRDY from chip A (active-low falling edge)
_GPIO_CHIP = "/dev/gpiochip4"
_RDATA_CMD = 0x12       # One-shot read command for chip B


def _open_spi(bus: int, device: int = 0) -> spidev.SpiDev:
    spi = spidev.SpiDev()
    spi.open(bus, device)
    spi.max_speed_hz = 1_000_000
    spi.mode = 0b01  # CPOL=0, CPHA=1
    spi.bits_per_word = 8
    return spi


def _init_chip_a(spi: spidev.SpiDev) -> None:
    spi.xfer2([0x02])  # WAKEUP
    spi.xfer2([0x0A])  # STOP
    spi.xfer2([0x06])  # RESET
    time.sleep(0.1)
    spi.xfer2([0x11])  # SDATAC
    spi.xfer2([0x41, 0x00, 0x96])  # CONFIG1: 250 SPS
    spi.xfer2([0x42, 0x00, 0xD4])  # CONFIG2
    spi.xfer2([0x43, 0x00, 0xFF])  # CONFIG3: internal reference on
    for reg in range(0x05, 0x0D):  # CH1SET-CH8SET: gain 6 (match chip B + GUI ref)
        spi.xfer2([0x40 | reg, 0x00, 0x00])
    spi.xfer2([0x10])  # RDATAC
    spi.xfer2([0x08])  # START


def _init_chip_b(spi: spidev.SpiDev, cs_fn: Callable) -> None:
    def send(data: list[int]) -> None:
        cs_fn(Value.INACTIVE)
        spi.xfer2(data)
        cs_fn(Value.ACTIVE)

    send([0x02])  # WAKEUP
    send([0x0A])  # STOP
    send([0x06])  # RESET
    time.sleep(0.1)
    send([0x11])  # SDATAC
    send([0x54, 0x00, 0x80])  # WREG GPIO(0x14)=0x80 — required for chip B
    send([0x41, 0x00, 0x96])  # CONFIG1: 250 SPS
    send([0x42, 0x00, 0xD4])  # CONFIG2
    send([0x43, 0x00, 0xFF])  # CONFIG3: internal reference on
    for reg in range(0x05, 0x0D):  # CH1SET-CH8SET: gain 6 (default)
        send([0x40 | reg, 0x00, 0x00])
    # Chip B uses RDATA one-shot reads; do NOT send RDATAC
    send([0x08])  # START


@dataclass
class FrameStats:
    samples: int = 0
    spi_errors: int = 0


class PiEEG16:
    """Two-chip 16-channel reader. Blocking, returns one 16ch sample per call."""

    def __init__(self) -> None:
        self.spi_a = _open_spi(0, 0)
        self.spi_b = _open_spi(0, 1)
        self.gpio = gpiod.request_lines(
            _GPIO_CHIP,
            consumer="pieeg",
            config={
                _CS_LINE: gpiod.LineSettings(direction=Direction.OUTPUT),
                _DRDY_LINE: gpiod.LineSettings(edge_detection=Edge.FALLING),
            },
        )
        self.gpio.set_value(_CS_LINE, Value.ACTIVE)  # MUX idle = chip A path
        _init_chip_a(self.spi_a)
        _init_chip_b(self.spi_b, cs_fn=lambda v: self.gpio.set_value(_CS_LINE, v))
        self.stats = FrameStats()

    def read_sample(self) -> list[float]:
        # Wait for chip A DRDY falling edge (conversion done), timeout 20ms
        self.gpio.wait_edge_events(0.020)
        self.gpio.read_edge_events()
        try:
            # Chip A: RDATAC — output starts immediately when CS asserted by kernel
            a = bytes(self.spi_a.xfer2([0x00] * _FRAME_BYTES))
            # Chip B: RDATA one-shot command (28 bytes, skip first response byte)
            self.gpio.set_value(_CS_LINE, Value.INACTIVE)
            raw_b = bytes(self.spi_b.xfer2([_RDATA_CMD] + [0x00] * _FRAME_BYTES))
            self.gpio.set_value(_CS_LINE, Value.ACTIVE)
        except OSError:
            self.stats.spi_errors += 1
            raise
        self.stats.samples += 1
        b = raw_b[1:]  # skip command echo byte, keep 27-byte frame
        return _decode_frame(a) + _decode_frame(b)

    def close(self) -> None:
        try:
            self.spi_a.close()
            self.spi_b.close()
            self.gpio.release()
        except Exception:
            pass
