"""Per-event football metrics computed from raw events.

The engine works these out itself from positions, pressure and speeds; it
does not read anything the simulator kept private. Positions arrive in the
fixed frame (home attacks toward x = 105) and are turned into the acting
team's attacking frame where it matters.
"""

from __future__ import annotations

import math

LENGTH, WIDTH = 105.0, 68.0
FINAL_THIRD = 70.0
BOX_X, BOX_HALF_WIDTH = 88.5, 20.15
SPRINT_KMH = 30.0       # a carry faster than this triggers a speed tag
FAST_SHOT_KMH = 100.0   # a shot faster than this triggers a speed badge


def attacking(x: float, y: float, team: str, home: str) -> tuple[float, float]:
    """Turn a fixed-frame position into the attacking frame of `team` (0 = own goal line)."""
    return (x, y) if team == home else (LENGTH - x, WIDTH - y)


def in_box(ax: float, ay: float) -> bool:
    """Whether an attacking-frame position is inside the opponent's penalty area."""
    return ax >= BOX_X and abs(ay - 34) <= BOX_HALF_WIDTH


def kmh(mps: float) -> float:
    """Metres per second to kilometres per hour."""
    return mps * 3.6


def pass_distance(e: dict) -> float:
    """Straight-line distance of a pass or carry, in metres."""
    return math.hypot(e["end_x"] - e["x"], e["end_y"] - e["y"])


def completion_chance(e: dict, home: str) -> float:
    """How likely a pass of this length, pressure and target was to be completed."""
    d = pass_distance(e)
    end_ax, end_ay = attacking(e["end_x"], e["end_y"], e["team"], home)
    start_ax, _ = attacking(e["x"], e["y"], e["team"], home)
    forward = max(0.0, end_ax - start_ax)
    p = 0.97 - 0.0045 * d - 0.24 * e.get("pressure", 0.0) - 0.002 * max(0.0, end_ax - FINAL_THIRD) - 0.002 * forward
    if e.get("subtype") == "cross":
        p -= 0.45
    elif e.get("subtype") == "long_ball":
        p -= 0.12
    if in_box(end_ax, end_ay):
        p -= 0.08
    return max(0.05, min(0.99, p))


def pass_difficulty(e: dict, home: str) -> int:
    """Difficulty from 1 (routine) to 5 (very hard), from the pass's completion chance."""
    p = completion_chance(e, home)
    if p >= 0.88:
        return 1
    if p >= 0.78:
        return 2
    if p >= 0.66:
        return 3
    if p >= 0.5:
        return 4
    return 5


def shot_quality(e: dict, home: str) -> float:
    """Expected-goals estimate for a shot event, from distance, angle, pressure and type."""
    if e.get("subtype") == "penalty":
        return 0.76
    ax, ay = attacking(e["x"], e["y"], e["team"], home)
    dx, dy = LENGTH - ax, 34 - ay
    d = math.hypot(dx, dy)
    angle = math.atan2(7.32 * max(dx, 0.1), dx * dx + dy * dy - 3.66 ** 2)
    if angle < 0:
        angle += math.pi
    # Scaled by 1.5 so that, over many matches, total xG matches the league's goals per shot (about 0.10).
    xg = 1.5 * 0.6 * angle / (angle + 0.35) * math.exp(-0.09 * d) * (1 - 0.45 * e.get("pressure", 0.0))
    if e.get("subtype") == "header":
        xg *= 0.6
    if e.get("subtype") == "free_kick":
        xg = min(xg, 0.07)
    return round(max(0.005, min(0.8, xg)), 3)


def shot_distance(e: dict, home: str) -> float:
    """Distance from the shot to the centre of the goal, in metres."""
    ax, ay = attacking(e["x"], e["y"], e["team"], home)
    return math.hypot(LENGTH - ax, 34 - ay)
