"""Choose the demo matches: simulate many seeds, score each for drama, keep the best.

The demo matches are not hand-written. They are honest simulator output,
picked for lead changes, late goals and long spells of pressure.

Run: python -m simulator.pick_demos [--seeds 500] [--keep 3]
"""

from __future__ import annotations

import argparse
import itertools
import json

from simulator.generate import MATCHES, load_league, save
from simulator.model import simulate

WINDOW = 180.0  # the "best three minutes"


def drama(events: list[dict]) -> tuple[float, dict]:
    """Score a match for drama and find the start of its best three minutes."""
    score: dict[str, int] = {}
    leader, lead_changes, late_goals, equalisers = None, 0, 0, 0
    for e in events:
        if e["type"] != "goal":
            continue
        score[e["team"]] = score.get(e["team"], 0) + 1
        values = sorted(score.values(), reverse=True) + [0]
        if values[0] == values[1]:
            equalisers += 1
            leader = None
        else:
            top = max(score, key=score.get)
            if leader is not None and top != leader:
                lead_changes += 1
            if leader is None and top is not None and len(score) > 1:
                lead_changes += 1
            leader = top
        if e["clock"] >= 75 * 60:
            late_goals += 1
    goals = sum(score.values())

    weights = {"goal": 10, "shot": 3, "save": 2, "interception": 0.5, "tackle": 0.5}
    marks = [(e["t"], weights.get(e["type"], 0)) for e in events if e["type"] in weights]
    best_start, best_val, j, run = 0.0, -1.0, 0, 0.0
    for i, (t, w) in enumerate(marks):
        run += w
        while marks[j][0] < t - WINDOW:
            run -= marks[j][1]
            j += 1
        if run > best_val:
            best_val, best_start = run, max(0.0, marks[j][0] - 10)

    value = 4 * lead_changes + 3 * late_goals + 2 * equalisers + min(goals, 6) * 0.8 + best_val / 10
    if goals == 0:
        value -= 5
    start_clock = next(e["clock"] for e in events if e["t"] >= best_start)
    return value, {
        "drama": round(value, 2),
        "goals": goals,
        "lead_changes": lead_changes,
        "late_goals": late_goals,
        "equalisers": equalisers,
        "best_three_minutes": {"t": round(best_start, 2), "clock": round(start_clock, 2)},
    }


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--seeds", type=int, default=500)
    ap.add_argument("--keep", type=int, default=3)
    args = ap.parse_args()
    league = load_league()
    pairs = list(itertools.permutations([c["code"] for c in league["clubs"]], 2))
    scored = []
    for i in range(args.seeds):
        home, away = pairs[i % len(pairs)]
        seed = 20_000 + i
        value, info = drama(simulate(league, home, away, seed))
        scored.append((value, home, away, seed, info))
    scored.sort(key=lambda r: r[0], reverse=True)
    picked, used_pairs = [], set()
    for row in scored:  # prefer different pairings so the demos are not all the same fixture
        if frozenset((row[1], row[2])) in used_pairs:
            continue
        picked.append(row)
        used_pairs.add(frozenset((row[1], row[2])))
        if len(picked) == args.keep:
            break
    index = []
    for n, (value, home, away, seed, info) in enumerate(picked, start=1):
        mid = f"demo_{n}"
        path = save(league, home, away, seed, mid, extra={"demo": info})
        index.append({"match_id": mid, "home": home, "away": away, "seed": seed} | info)
        print(f"{mid}: {home} v {away}, seed {seed}, drama {info['drama']}, goals {info['goals']}, "
              f"lead changes {info['lead_changes']}, best 3 min from {info['best_three_minutes']['clock'] / 60:.1f}' -> {path.name}")
    (MATCHES / "demos.json").write_text(json.dumps(index, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
