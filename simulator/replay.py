"""Replay a saved match in real time.

Each event is published when its play time t arrives on the wall clock.

Run: python -m simulator.replay data/matches/demo_1.jsonl [--speed 10] [--start 60]
--speed plays faster than real time; --start jumps to a minute on the match clock.
--pretty prints a readable line per event instead of JSON.
"""

from __future__ import annotations

import argparse
import json
import time
from collections.abc import Callable, Iterator
from pathlib import Path

from simulator.transport import Transport, from_env


def read_events(path: Path) -> list[dict]:
    """Load a .jsonl match file."""
    with path.open(encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def schedule(events: list[dict], start_clock: float = 0.0) -> Iterator[tuple[float, dict]]:
    """Yield (seconds after replay start, event) for events at or after start_clock."""
    first = next((e for e in events if e["clock"] >= start_clock), None)
    if first is None:
        return
    t0 = first["t"]
    for e in events:
        if e["t"] >= t0:
            yield e["t"] - t0, e


def replay(events: list[dict], transport: Transport, speed: float = 1.0, start_clock: float = 0.0,
           sleep: Callable[[float], None] = time.sleep, now: Callable[[], float] = time.monotonic) -> int:
    """Publish events in real time (divided by speed). Returns how many were published."""
    began = now()
    count = 0
    for offset, event in schedule(events, start_clock):
        wait = began + offset / speed - now()
        if wait > 0:
            sleep(wait)
        transport.publish(event)
        count += 1
    return count


def describe(e: dict, names: dict[str, str] | None = None) -> str:
    """One readable line for an event, with player names when they are given."""
    m, s = divmod(int(e["clock"]), 60)
    player = e.get("player", "")
    bits = [f"{m:02d}:{s:02d}", e["type"].upper(), e.get("team", ""), (names or {}).get(player, player)]
    if "outcome" in e:
        bits.append(e["outcome"])
    if "subtype" in e:
        bits.append(e["subtype"])
    if "x" in e:
        bits.append(f"({e['x']:.0f},{e['y']:.0f})")
    return " ".join(b for b in bits if b)


class PrettyTransport:
    """Prints readable lines; for watching a replay in the terminal."""

    def __init__(self, names: dict[str, str] | None = None) -> None:
        self.names = names or {}

    def publish(self, message: dict) -> None:
        print(describe(message, self.names), flush=True)

    def subscribe(self, handler: Callable[[dict], None]) -> None:
        raise NotImplementedError


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("match", type=Path)
    ap.add_argument("--speed", type=float, default=1.0)
    ap.add_argument("--start", type=float, default=0.0, help="match clock minute to start from")
    ap.add_argument("--pretty", action="store_true")
    args = ap.parse_args()
    if args.pretty:
        league = json.loads((Path(__file__).resolve().parent.parent / "data" / "league.json").read_text(encoding="utf-8"))
        names = {p["id"]: p["name"] for c in league["clubs"] for p in c["players"]}
        transport: Transport = PrettyTransport(names)
    else:
        transport = from_env()
    try:
        replay(read_events(args.match), transport, args.speed, args.start * 60)
    except (BrokenPipeError, KeyboardInterrupt):
        pass  # the reader stopped listening (for example `| head`) or the user pressed Ctrl+C


if __name__ == "__main__":
    main()
