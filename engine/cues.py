"""Sound cues: each event becomes at most one small, timed cue for the phone.

A cue carries the start, the end and the duration; the phone glides the ball
between them on its own audio clock. We never send a stream of positions.
Cues skip the AI entirely, so the ball never waits for a sentence.
"""

from __future__ import annotations

import math

from engine import metrics as m
from engine.state import MatchState

SOUND = {
    "pass": "pass", "carry": "carry", "shot": "shot", "save": "save", "goal": "goal",
    "tackle": "tackle", "interception": "tackle", "clearance": "clearance", "out": "out",
    "foul": "whistle", "set_piece": "restart", "period_start": "whistle", "period_end": "whistle",
}


def sound_cue(e: dict, state: MatchState) -> dict | None:
    """Build the sound cue for one event, or None if the event makes no sound."""
    sound = SOUND.get(e["type"])
    if sound is None:
        return None
    cue: dict = {"t": e["t"], "clock": e["clock"], "type": "sound", "sound": sound, "event": e["id"]}
    for k in ("team", "player", "recipient", "outcome", "subtype", "pressure"):
        if k in e:
            cue[k] = e[k]
    if "x" in e:
        cue["from"] = [e["x"], e["y"]]
        cue["to"] = [e.get("end_x", e["x"]), e.get("end_y", e["y"])]
        dist = math.dist(cue["from"], cue["to"])
        speed = e.get("speed_mps") or 0
        cue["duration"] = round(dist / speed, 2) if speed and dist else 0.0
    if "speed_mps" in e:
        cue["speed_kmh"] = round(m.kmh(e["speed_mps"]), 1)
    if e["type"] == "pass":
        cue["distance_m"] = round(m.pass_distance(e), 1)
        cue["difficulty"] = m.pass_difficulty(e, state.home)
    if e["type"] == "shot":
        cue["xg"] = m.shot_quality(e, state.home)
    if e["type"] == "goal":
        cue["score"] = dict(state.score)
    return cue
