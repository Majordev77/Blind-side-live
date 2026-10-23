"""Message transport behind one small interface: publish(message) and subscribe(handler).

Local mode needs no cloud account. The Azure versions (Event Hubs and Web
PubSub) implement the same interface and are added when Azure is available;
BLINDSIDE_MODE picks which one is used.
"""

from __future__ import annotations

import json
import os
import sys
from collections.abc import Callable
from pathlib import Path
from typing import Protocol, TextIO

Handler = Callable[[dict], None]


class Transport(Protocol):
    """Anything that can carry match messages between services."""

    def publish(self, message: dict) -> None: ...
    def subscribe(self, handler: Handler) -> None: ...


class MemoryTransport:
    """Calls every subscriber in the same process. Used by tests and by the local pipeline."""

    def __init__(self) -> None:
        self.handlers: list[Handler] = []

    def publish(self, message: dict) -> None:
        for h in self.handlers:
            h(message)

    def subscribe(self, handler: Handler) -> None:
        self.handlers.append(handler)


class StreamTransport(MemoryTransport):
    """Also writes each message as one JSON line to a stream (stdout by default) or a file."""

    def __init__(self, out: TextIO | None = None) -> None:
        super().__init__()
        self.out = out or sys.stdout

    def publish(self, message: dict) -> None:
        self.out.write(json.dumps(message, separators=(",", ":")) + "\n")
        self.out.flush()
        super().publish(message)


def from_env(path: Path | None = None) -> Transport:
    """Choose the transport from BLINDSIDE_MODE. Only local mode exists so far."""
    mode = os.environ.get("BLINDSIDE_MODE", "local")
    if mode != "local":
        raise NotImplementedError(f"BLINDSIDE_MODE={mode} is not available yet; use local")
    if path is not None:
        return StreamTransport(path.open("w", encoding="utf-8"))
    return StreamTransport()
