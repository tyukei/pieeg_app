"""LSL input source — consume an existing Lab Streaming Layer EEG stream.

Lets the aggregation server read the raw waveform from the *reference* PiEEG
acquisition daemon (which publishes an LSL outlet named "PiEEG-16") WITHOUT
touching the SPI bus. That means the original `pieeg-acquirer.service` keeps
running untouched and we just tap its stream on localhost.

Requires `pylsl` (installed only where an LSL stream is consumed).
"""
from __future__ import annotations


class LSLSource:
    """Blocking chunk reader over an LSL inlet, matching stream.py's source API."""

    def __init__(self, name: str = "PiEEG-16", timeout: float = 10.0) -> None:
        from pylsl import StreamInlet, resolve_byprop  # type: ignore

        streams = resolve_byprop("name", name, timeout=timeout)
        if not streams:
            raise RuntimeError(f"LSL stream {name!r} not found (is the acquirer running?)")
        self._inlet = StreamInlet(streams[0], max_buflen=60, recover=True)
        info = self._inlet.info()
        self.srate = int(info.nominal_srate()) or 250
        self.nch = info.channel_count()

    def read_chunk(self, max_samples: int) -> list[list[float]]:
        """Pull up to `max_samples` samples. May return [] if none are ready yet."""
        samples, _ts = self._inlet.pull_chunk(timeout=1.0, max_samples=max_samples)
        return samples or []

    def close(self) -> None:
        pass
