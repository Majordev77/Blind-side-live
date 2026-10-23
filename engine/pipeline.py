"""Run the state engine over a match: state, moments and sound cues.

Run: python -m engine.pipeline data/matches/demo_1.jsonl
Writes data/derived/<match_id>.moments.json and <match_id>.cues.jsonl, and
prints the moments it found.
"""

from __future__ import annotations

import argparse
import json
from dataclasses import dataclass, field
from pathlib import Path

from engine.cues import sound_cue
from engine.moments import MomentDetector
from engine.state import MatchState

ROOT = Path(__file__).resolve().parent.parent
DERIVED = ROOT / "data" / "derived"


def player_names() -> dict[str, str]:
    """Player ID to full name, from the invented league."""
    league = json.loads((ROOT / "data" / "league.json").read_text(encoding="utf-8"))
    return {p["id"]: p["name"] for c in league["clubs"] for p in c["players"]}


@dataclass
class Engine:
    """State, moment detection and cue building for one match, fed one event at a time."""

    state: MatchState
    detector: MomentDetector = field(init=False)
    cues: list[dict] = field(default_factory=list)

    def __post_init__(self) -> None:
        self.detector = MomentDetector(self.state)

    @classmethod
    def for_match(cls, match_id: str, home: str, away: str, names: dict[str, str] | None = None) -> "Engine":
        return cls(MatchState(match_id, home, away, names or {}))

    def handle(self, event: dict) -> tuple[dict | None, list[dict]]:
        """Process one event; return its sound cue (if any) and any new moments."""
        self.state.update(event)
        cue = sound_cue(event, self.state)
        if cue:
            self.cues.append(cue)
        return cue, self.detector.process(event)

    @property
    def moments(self) -> list[dict]:
        return self.detector.moments


def run_file(path: Path) -> Engine:
    """Process a saved .jsonl match from start to finish."""
    meta = json.loads(path.with_name(path.stem + ".match.json").read_text(encoding="utf-8"))
    engine = Engine.for_match(meta["match_id"], meta["home"]["code"], meta["away"]["code"], player_names())
    with path.open(encoding="utf-8") as f:
        for line in f:
            if line.strip():
                engine.handle(json.loads(line))
    return engine


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("match", type=Path)
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args()
    engine = run_file(args.match)
    mid = engine.state.match_id
    DERIVED.mkdir(parents=True, exist_ok=True)
    (DERIVED / f"{mid}.moments.json").write_text(json.dumps(engine.moments, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    with (DERIVED / f"{mid}.cues.jsonl").open("w", encoding="utf-8", newline="\n") as f:
        for c in engine.cues:
            f.write(json.dumps(c, separators=(",", ":")) + "\n")
    if not args.quiet:
        for mo in engine.moments:
            print(f"{mo['minute']:>3}' c{mo['class']} {mo['type']:<15} {mo['team'] or '':<4} {mo['score']:.2f}  "
                  + ", ".join(f"{k}={v}" for k, v in mo["facts"].items() if k != "team"))
    counts: dict[str, int] = {}
    for mo in engine.moments:
        counts[mo["type"]] = counts.get(mo["type"], 0) + 1
    print(f"\n{mid}: {len(engine.cues)} sound cues, {len(engine.moments)} moments {counts}")
    print(f"final score {engine.state.scoreline()['score']}")


if __name__ == "__main__":
    main()
