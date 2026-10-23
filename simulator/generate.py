"""Simulate one match and save it.

Writes data/matches/<match_id>.jsonl (one event per line, sorted by t) and
data/matches/<match_id>.match.json (clubs, line-ups, styles, final score).

Run: python -m simulator.generate --home ALD --away CRV --seed 7
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from simulator.model import simulate

ROOT = Path(__file__).resolve().parent.parent
MATCHES = ROOT / "data" / "matches"


def load_league() -> dict:
    """Read the invented league from data/league.json."""
    return json.loads((ROOT / "data" / "league.json").read_text(encoding="utf-8"))


def match_meta(league: dict, events: list[dict], home: str, away: str, seed: int) -> dict:
    """Describe a simulated match: clubs, starting line-ups, styles and the final score."""
    clubs = {c["code"]: c for c in league["clubs"]}
    goals = [e["team"] for e in events if e["type"] == "goal"]

    def side(code: str) -> dict:
        club = clubs[code]
        return {
            "code": code,
            "name": club["name"],
            "formation": club["formation"],
            "style": club["style"],
            "starting": [p["id"] for p in club["players"] if p["role"] != "SUB"],
            "bench": [p["id"] for p in club["players"] if p["role"] == "SUB"],
            "goals": goals.count(code),
        }

    return {
        "match_id": events[0]["match_id"],
        "seed": seed,
        "home": side(home),
        "away": side(away),
        "attacking": "home attacks toward x = 105 in both halves",
        "events": len(events),
    }


def save(league: dict, home: str, away: str, seed: int, match_id: str | None = None,
         extra: dict | None = None) -> Path:
    """Simulate and write one match; return the path of its .jsonl file."""
    events = simulate(league, home, away, seed, match_id)
    mid = events[0]["match_id"]
    MATCHES.mkdir(parents=True, exist_ok=True)
    path = MATCHES / f"{mid}.jsonl"
    with path.open("w", encoding="utf-8", newline="\n") as f:
        for e in events:
            f.write(json.dumps(e, separators=(",", ":")) + "\n")
    meta = match_meta(league, events, home, away, seed) | (extra or {})
    (MATCHES / f"{mid}.match.json").write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")
    return path


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--home", default="ALD")
    ap.add_argument("--away", default="CRV")
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--match-id")
    args = ap.parse_args()
    print(f"wrote {save(load_league(), args.home, args.away, args.seed, args.match_id)}")


if __name__ == "__main__":
    main()
