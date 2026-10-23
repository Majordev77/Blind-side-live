"""Tests for the match simulator, the demo picker and the replayer."""

from __future__ import annotations

import json
from pathlib import Path

import jsonschema
import pytest

from simulator.build_league import BLOCKED, build
from simulator.model import shot_quality, simulate
from simulator.pick_demos import drama
from simulator.replay import replay, schedule
from simulator.stats import summarize
from simulator.transport import MemoryTransport

ROOT = Path(__file__).resolve().parent.parent
SCHEMA = json.loads((ROOT / "shared" / "event.schema.json").read_text(encoding="utf-8"))
LEAGUE = json.loads((ROOT / "data" / "league.json").read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def match() -> list[dict]:
    return simulate(LEAGUE, "ALD", "CRV", seed=7)


def test_league_file_matches_builder() -> None:
    assert build() == LEAGUE


def test_league_is_four_clubs_of_eighteen_with_unique_names() -> None:
    clubs = LEAGUE["clubs"]
    assert len(clubs) == 4
    assert all(len(c["players"]) == 18 for c in clubs)
    names = [p["name"] for c in clubs for p in c["players"]]
    assert len(names) == len(set(names))
    assert not {n.split()[-1] for n in names} & BLOCKED


def test_same_seed_same_match(match: list[dict]) -> None:
    assert simulate(LEAGUE, "ALD", "CRV", seed=7) == match
    assert simulate(LEAGUE, "ALD", "CRV", seed=8) != match


def test_every_event_fits_the_schema(match: list[dict]) -> None:
    validator = jsonschema.Draft202012Validator(SCHEMA)
    for e in match:
        validator.validate(e)


def test_events_are_ordered_and_ids_unique(match: list[dict]) -> None:
    ts = [e["t"] for e in match]
    assert ts == sorted(ts)
    assert len({e["id"] for e in match}) == len(match)
    assert match[0]["type"] == "period_start" and match[-1]["type"] == "period_end"


def test_second_half_clock_starts_at_45_minutes(match: list[dict]) -> None:
    second = [e for e in match if e["period"] == 2]
    assert second[0]["type"] == "period_start"
    assert second[0]["clock"] == pytest.approx(2700, abs=0.01)
    assert match[-1]["clock"] > 90 * 60


def test_every_goal_follows_a_scoring_shot(match: list[dict]) -> None:
    for i, e in enumerate(match):
        if e["type"] == "goal":
            shot = match[i - 1]
            assert shot["type"] == "shot" and shot["outcome"] == "goal" and shot["team"] == e["team"]


def test_home_attacks_toward_x_105(match: list[dict]) -> None:
    home = match[1]["team"]
    shots = [e for e in match if e["type"] == "shot" and "end_x" in e]
    assert shots
    for s in shots:
        assert s["end_x"] == (105.0 if s["team"] == home else 0.0)


def test_numbers_look_like_football() -> None:
    rows = [summarize(simulate(LEAGUE, h, a, seed=s))
            for s, (h, a) in enumerate([("ALD", "CRV"), ("OST", "KES"), ("KES", "ALD"), ("CRV", "OST")] * 5)]
    mean = {k: sum(r[k] for r in rows) / len(rows) for k in rows[0]}
    assert 1.5 <= mean["goals"] <= 4.0
    assert 18 <= mean["shots"] <= 34
    assert 750 <= mean["passes"] <= 1100
    assert 0.74 <= mean["completion"] <= 0.88


def test_shot_quality_falls_with_distance_and_pressure() -> None:
    assert shot_quality(99, 34, 0) > shot_quality(90, 34, 0) > shot_quality(80, 34, 0)
    assert shot_quality(94, 34, 0.8) < shot_quality(94, 34, 0)
    assert shot_quality(100, 2, 0) < shot_quality(100, 34, 0)


def test_drama_finds_a_window_inside_the_match(match: list[dict]) -> None:
    _, info = drama(match)
    assert 0 <= info["best_three_minutes"]["t"] <= match[-1]["t"]
    assert info["goals"] == sum(1 for e in match if e["type"] == "goal")


def test_replay_publishes_in_order_at_the_right_times(match: list[dict]) -> None:
    clock = {"now": 0.0}
    waits: list[float] = []

    def sleep(s: float) -> None:
        waits.append(s)
        clock["now"] += s

    got: list[dict] = []
    bus = MemoryTransport()
    bus.subscribe(got.append)
    sample = match[:200]
    n = replay(sample, bus, speed=4.0, sleep=sleep, now=lambda: clock["now"])
    assert n == len(sample) and got == sample
    assert clock["now"] == pytest.approx((sample[-1]["t"] - sample[0]["t"]) / 4.0, abs=1e-6)


def test_replay_can_start_mid_match(match: list[dict]) -> None:
    offsets = list(schedule(match, start_clock=60 * 60))
    assert offsets[0][0] == 0
    assert offsets[0][1]["clock"] >= 3600
