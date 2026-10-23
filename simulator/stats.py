"""Summary statistics for simulated matches, used by calibration and demo selection."""

from __future__ import annotations

from collections import Counter


def summarize(events: list[dict]) -> dict:
    """Return goals, shots, passes, pass completion and possession share for one match."""
    teams = [c for c, _ in Counter(e["team"] for e in events if "team" in e).most_common()]
    passes = Counter(e["team"] for e in events if e["type"] == "pass")
    complete = sum(1 for e in events if e["type"] == "pass" and e["outcome"] == "complete")
    total_passes = sum(passes.values())
    home = events[1]["team"] if len(events) > 1 and "team" in events[1] else teams[0]
    share = passes[home] / total_passes if total_passes else 0.5
    return {
        "goals": sum(1 for e in events if e["type"] == "goal"),
        "shots": sum(1 for e in events if e["type"] == "shot"),
        "on_target": sum(1 for e in events if e["type"] == "shot" and e["outcome"] in ("goal", "on_target")),
        "passes": total_passes,
        "completion": complete / total_passes if total_passes else 0.0,
        "possession_home": share,
        "possession_minor": min(share, 1 - share),
        "corners": sum(1 for e in events if e["type"] == "set_piece" and e.get("subtype") == "corner"),
        "fouls": sum(1 for e in events if e["type"] == "foul"),
        "duration_min": events[-1]["clock"] / 60 if events else 0.0,
    }
