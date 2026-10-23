"""Simulate many matches and compare the averages with real football.

Run: python -m simulator.calibrate [--matches 200] [--write]
--write saves the table to docs/results/calibration.md.
"""

from __future__ import annotations

import argparse
import itertools
import json
import statistics
from pathlib import Path

from simulator.model import simulate
from simulator.stats import summarize

ROOT = Path(__file__).resolve().parent.parent
TARGETS = {
    "goals": (2.5, 3.0, "Goals"),
    "shots": (22, 28, "Shots"),
    "passes": (800, 1000, "Passes"),
    "completion": (0.78, 0.86, "Pass completion"),
    "possession_minor": (0.35, 0.50, "Smaller possession share"),
}


def run(n: int) -> dict[str, list[float]]:
    """Simulate n matches across every pairing of the four clubs."""
    league = json.loads((ROOT / "data" / "league.json").read_text(encoding="utf-8"))
    codes = [c["code"] for c in league["clubs"]]
    pairs = list(itertools.permutations(codes, 2))
    rows: dict[str, list[float]] = {}
    for i in range(n):
        home, away = pairs[i % len(pairs)]
        for k, v in summarize(simulate(league, home, away, seed=10_000 + i)).items():
            rows.setdefault(k, []).append(v)
    return rows


def table(rows: dict[str, list[float]], n: int) -> str:
    """Format the averages against their targets as a Markdown table."""
    lines = [f"Averages per match over {n} simulated matches (seeds 10000 to {10_000 + n - 1}, every pairing of the four clubs).",
             "",
             "| Measure | Simulated mean | Spread (sd) | Target | In range |",
             "|---|---|---|---|---|"]
    for key, (lo, hi, label) in TARGETS.items():
        vals = rows[key]
        mean, sd = statistics.fmean(vals), statistics.pstdev(vals)
        pct = key in ("completion", "possession_minor")
        fmt = (lambda v: f"{v:.1%}") if pct else (lambda v: f"{v:.1f}")
        ok = "yes" if lo <= mean <= hi else "no"
        lines.append(f"| {label} | {fmt(mean)} | {fmt(sd)} | {fmt(lo)} to {fmt(hi)} | {ok} |")
    extra = {k: statistics.fmean(rows[k]) for k in ("on_target", "corners", "fouls", "duration_min")}
    lines += ["",
              f"Also per match: {extra['on_target']:.1f} shots on target, {extra['corners']:.1f} corners, "
              f"{extra['fouls']:.1f} fouls, {extra['duration_min']:.1f} minutes including stoppage time.",
              "",
              "Targets are approximate ranges for top-flight football, from the build guide."]
    return "\n".join(lines)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--matches", type=int, default=200)
    ap.add_argument("--write", action="store_true")
    args = ap.parse_args()
    out = table(run(args.matches), args.matches)
    print(out)
    if args.write:
        path = ROOT / "docs" / "results" / "calibration.md"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("# Simulator calibration\n\n" + out + "\n", encoding="utf-8")
        print(f"\nwrote {path}")


if __name__ == "__main__":
    main()
