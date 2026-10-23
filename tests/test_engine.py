"""Tests for the state engine, metrics, moment rules and sound cues.

Most tests feed short hand-made event lists, so each rule is checked on a
situation we can reason about. One regression test pins the moments found
in a fixed simulated match.
"""

from __future__ import annotations

import json
from pathlib import Path

import jsonschema
import pytest

from engine import metrics as m
from engine.pipeline import Engine, run_file
from engine.state import MatchState

ROOT = Path(__file__).resolve().parent.parent
MOMENT_SCHEMA = json.loads((ROOT / "shared" / "moment.schema.json").read_text(encoding="utf-8"))
CUE_SCHEMA = json.loads((ROOT / "shared" / "cue.schema.json").read_text(encoding="utf-8"))
HOME, AWAY = "ALD", "CRV"


class Feed:
    """Builds events one by one with increasing ids and times."""

    def __init__(self) -> None:
        self.n = 0
        self.t = 0.0
        self.engine = Engine.for_match("m_test", HOME, AWAY, {"p_101": "Home Ten", "p_102": "Home Nine",
                                                              "p_201": "Away Six"})

    def __call__(self, type_: str, team: str | None = None, player: str | None = None, dt: float = 2.0,
                 **fields: object) -> tuple[dict, list[dict]]:
        self.n += 1
        self.t += dt
        e: dict = {"id": f"ev_{self.n:06d}", "match_id": "m_test", "t": self.t, "clock": self.t, "period": 1, "type": type_}
        if team:
            e["team"] = team
        if player:
            e["player"] = player
        e.update(fields)
        _, moments = self.engine.handle(e)
        return e, moments

    @property
    def state(self) -> MatchState:
        return self.engine.state


def pass_ev(x: float, y: float, ex: float, ey: float, pressure: float = 0.0, team: str = HOME, **kw: object) -> dict:
    return {"id": "ev_000001", "type": "pass", "team": team, "x": x, "y": y, "end_x": ex, "end_y": ey,
            "pressure": pressure, "outcome": "complete", **kw}


# ---------- metrics ----------

def test_pass_difficulty_rises_with_distance_pressure_and_target() -> None:
    easy = pass_ev(40, 34, 48, 34)
    long_pressed = pass_ev(40, 34, 75, 34, pressure=0.8)
    into_box = pass_ev(80, 20, 95, 34, pressure=0.5)
    assert m.pass_difficulty(easy, HOME) == 1
    assert m.pass_difficulty(long_pressed, HOME) >= 4
    assert m.pass_difficulty(into_box, HOME) > m.pass_difficulty(easy, HOME)
    assert m.pass_difficulty(pass_ev(40, 34, 48, 34, subtype="cross"), HOME) == 5


def test_difficulty_scale_is_monotonic_in_pressure() -> None:
    levels = [m.pass_difficulty(pass_ev(30, 34, 55, 30, pressure=p / 10), HOME) for p in range(11)]
    assert levels == sorted(levels)
    assert levels[0] < levels[-1]


def test_away_positions_are_mirrored() -> None:
    assert m.attacking(100, 30, AWAY, HOME) == (5, 38)
    shot_home = {"type": "shot", "team": HOME, "x": 95, "y": 34}
    shot_away = {"type": "shot", "team": AWAY, "x": 10, "y": 34}
    assert m.shot_quality(shot_home, HOME) == m.shot_quality(shot_away, HOME)


def test_shot_quality_prefers_close_central_unpressed_shots() -> None:
    close = {"team": HOME, "x": 99, "y": 34, "pressure": 0.0}
    far = {"team": HOME, "x": 80, "y": 34, "pressure": 0.0}
    tight = {"team": HOME, "x": 103, "y": 5, "pressure": 0.0}
    pressed = {"team": HOME, "x": 99, "y": 34, "pressure": 0.9}
    assert m.shot_quality(close, HOME) > m.shot_quality(far, HOME)
    assert m.shot_quality(close, HOME) > m.shot_quality(tight, HOME)
    assert m.shot_quality(close, HOME) > m.shot_quality(pressed, HOME)
    assert m.shot_quality({"team": HOME, "x": 94, "y": 34, "subtype": "penalty"}, HOME) == 0.76


# ---------- state ----------

def test_possession_changes_and_counts_passes() -> None:
    f = Feed()
    f("pass", HOME, "p_101", x=40, y=34, end_x=50, end_y=30, outcome="complete", pressure=0.1, recipient="p_102")
    f("pass", HOME, "p_102", x=50, y=30, end_x=60, end_y=34, outcome="complete", pressure=0.1, recipient="p_101")
    assert f.state.possession.team == HOME and f.state.possession.passes == 2
    f("interception", AWAY, "p_201", x=58, y=34, outcome="won")
    f("possession_change", AWAY, "p_201", x=58, y=34)
    assert f.state.possession.team == AWAY
    assert f.state.possession.passes == 0
    assert f.state.possessions[-1] == (HOME, 2)
    assert f.state.players["p_201"].interceptions == 1
    assert f.state.players["p_101"].as_dict()["pass_accuracy"] == 1.0


def test_goal_updates_score_and_scoreline() -> None:
    f = Feed()
    f("shot", AWAY, "p_201", x=10, y=34, end_x=0, end_y=34, outcome="goal", pressure=0.2, speed_mps=25)
    f("goal", AWAY, "p_201", dt=0.5, x=0, y=34)
    assert f.state.score == {HOME: 0, AWAY: 1}
    assert f.state.scoreline()["score"] == {HOME: 0, AWAY: 1}


def test_momentum_swings_from_one_side_to_the_other() -> None:
    f = Feed()
    for _ in range(8):
        f("shot", HOME, "p_101", dt=40, x=96, y=34, end_x=105, end_y=36, outcome="off_target", pressure=0.1, speed_mps=25)
    assert f.state.momentum() > 0.6  # swings only count after minute 10, so this spell runs past it
    swings = []
    for _ in range(14):
        _, mo = f("shot", AWAY, "p_201", dt=30, x=9, y=34, end_x=0, end_y=33, outcome="off_target", pressure=0.1, speed_mps=25)
        swings += [x for x in mo if x["type"] == "momentum_swing"]
    assert f.state.momentum() < -0.6
    assert swings and swings[0]["team"] == AWAY


# ---------- moment rules ----------

def test_goal_moment_names_scorer_and_assist() -> None:
    f = Feed()
    f("pass", HOME, "p_102", x=80, y=20, end_x=97, end_y=34, outcome="complete", pressure=0.2, recipient="p_101")
    f("shot", HOME, "p_101", x=97, y=34, end_x=105, end_y=35, outcome="goal", pressure=0.3, speed_mps=24)
    _, mo = f("goal", HOME, "p_101", dt=0.4, x=105, y=35)
    goal = next(x for x in mo if x["type"] == "goal")
    assert goal["class"] == 1
    assert goal["facts"]["scorer"] == "Home Ten" and goal["facts"]["assist"] == "Home Nine"
    assert goal["facts"]["score_home"] == 1 and goal["facts"]["score_away"] == 0
    assert goal["facts"]["shot_speed_kmh"] == round(24 * 3.6)
    assert len(goal["evidence"]) == 3


def test_big_chance_only_for_good_misses() -> None:
    f = Feed()
    _, mo = f("shot", HOME, "p_101", x=100, y=34, end_x=105, end_y=34, outcome="on_target", pressure=0.0, speed_mps=25)
    assert "big_chance" in [x["type"] for x in mo]  # also the first shot on target: a milestone
    _, mo = f("shot", HOME, "p_101", x=75, y=34, end_x=105, end_y=34, outcome="off_target", pressure=0.5, speed_mps=25)
    assert not any(x["type"] == "big_chance" for x in mo)


def test_high_turnover_counts_recent_wins_in_the_final_third() -> None:
    f = Feed()
    _, mo = f("interception", AWAY, "p_201", x=20, y=30, outcome="won")  # 20 m from the home goal: away's final third
    ht = [x for x in mo if x["type"] == "high_turnover"]
    assert ht and ht[0]["facts"]["metres_from_goal"] == 20
    _, mo = f("tackle", AWAY, "p_201", x=60, y=30, outcome="won")  # midfield: not high
    assert not any(x["type"] == "high_turnover" for x in mo)


def test_hard_pass_into_the_final_third() -> None:
    f = Feed()
    _, mo = f("pass", HOME, "p_101", x=45, y=20, end_x=85, end_y=40, outcome="complete", pressure=0.7, recipient="p_102")
    hp = [x for x in mo if x["type"] == "hard_pass"]
    assert hp and hp[0]["facts"]["difficulty"] >= 4


def test_long_move_fires_on_the_tenth_pass() -> None:
    f = Feed()
    found = []
    for i in range(12):
        _, mo = f("pass", HOME, "p_101", x=30 + i, y=34, end_x=32 + i, end_y=30, outcome="complete", pressure=0.1, recipient="p_102")
        found += [x for x in mo if x["type"] == "long_move"]
    assert len(found) == 1 and found[0]["facts"]["passes_in_move"] == 10
    assert len(found[0]["evidence"]) == 10


def test_milestone_on_fiftieth_completed_pass() -> None:
    f = Feed()
    found = []
    for _ in range(50):
        _, mo = f("pass", HOME, "p_101", dt=5, x=40, y=34, end_x=45, end_y=34, outcome="complete", pressure=0.0, recipient="p_102")
        found += [x for x in mo if x["type"] == "milestone"]
    assert found and found[-1]["facts"]["completed_passes"] == 50


def test_sprint_needs_the_speed_threshold() -> None:
    f = Feed()
    _, mo = f("carry", HOME, "p_101", x=40, y=34, end_x=50, end_y=34, outcome="complete", pressure=0.0, speed_mps=7.0)
    assert not any(x["type"] == "sprint" for x in mo)
    _, mo = f("carry", HOME, "p_101", x=50, y=34, end_x=60, end_y=34, outcome="complete", pressure=0.0, speed_mps=8.6)
    assert any(x["type"] == "sprint" and x["facts"]["speed_kmh"] == 31.0 for x in mo)


def test_drought_after_fifteen_minutes_without_a_shot() -> None:
    f = Feed()
    found = []
    for _ in range(31):
        _, mo = f("pass", HOME, "p_101", dt=30, x=40, y=34, end_x=45, end_y=34, outcome="complete", pressure=0.0)
        found += [x for x in mo if x["type"] == "drought"]
    assert {x["team"] for x in found} == {HOME, AWAY}
    assert all(x["facts"]["minutes_without_a_shot"] == 15 for x in found)


def test_press_change_when_pressing_jumps() -> None:
    f = Feed()
    for _ in range(60):  # 20 minutes of light pressing on the home side's build-up
        f("pass", HOME, "p_101", dt=20, x=30, y=34, end_x=40, end_y=34, outcome="complete", pressure=0.1)
    found = []
    for _ in range(10):  # then the away side presses hard
        _, mo = f("pass", HOME, "p_101", dt=10, x=30, y=34, end_x=40, end_y=34, outcome="complete", pressure=0.8)
        found += [x for x in mo if x["type"] == "press_change"]
    assert found and found[0]["team"] == AWAY and found[0]["facts"]["direction"] == "up"


# ---------- whole match ----------

@pytest.fixture(scope="module")
def demo() -> Engine:
    return run_file(ROOT / "data" / "matches" / "demo_1.jsonl")


def test_demo_moments_and_cues_fit_their_schemas(demo: Engine) -> None:
    mv = jsonschema.Draft202012Validator(MOMENT_SCHEMA)
    cv = jsonschema.Draft202012Validator(CUE_SCHEMA)
    for mo in demo.moments:
        mv.validate(mo)
    for c in demo.cues:
        cv.validate(c)


def test_every_moment_cites_real_events(demo: Engine) -> None:
    ids = {e["id"] for e in demo.state.events}
    for mo in demo.moments:
        assert set(mo["evidence"]) <= ids


def test_demo_goals_match_the_final_score(demo: Engine) -> None:
    goals = [mo for mo in demo.moments if mo["type"] == "goal"]
    assert len(goals) == sum(demo.state.score.values())
    last = goals[-1]["facts"]
    assert (last["score_home"], last["score_away"]) == (demo.state.score[demo.state.home], demo.state.score[demo.state.away])


def test_regression_moment_list_for_demo_1(demo: Engine) -> None:
    """Fails if the engine's moments for this fixed match change. Update the snapshot on purpose only."""
    snapshot = ROOT / "tests" / "fixtures" / "demo_1_moments.json"
    got = [[mo["moment_id"], mo["type"], mo["minute"], mo["team"]] for mo in demo.moments]
    if not snapshot.exists():
        snapshot.parent.mkdir(parents=True, exist_ok=True)
        snapshot.write_text(json.dumps(got) + "\n", encoding="utf-8")
        pytest.skip("snapshot written")
    assert got == json.loads(snapshot.read_text(encoding="utf-8"))
