"""The agent workflow end to end, plus the failure drills.

These run the real Agent Framework workflow with stand-in chat clients, so
they need no model: an offline writer (with and without planted errors), a
model that crashes, and a model that is too slow for the deadline.
"""

from __future__ import annotations

import asyncio
from typing import Any

import pytest
from agent_framework import BaseChatClient

from agents import models, run as runner
from agents.models import ModelInfo, OfflineWriter


def run_with(client: Any, info: ModelInfo, *, full: bool = False, deadline: float = 2.0) -> Any:
    orig = models.make_client
    runner.make_client = lambda: (client, info)  # type: ignore[assignment]
    try:
        return asyncio.run(runner.run_match("demo_1", full=full, deadline=deadline))
    finally:
        runner.make_client = orig  # type: ignore[assignment]


class Broken(BaseChatClient):
    """A model endpoint that is down."""

    def _inner_get_response(self, **kwargs: Any) -> Any:
        async def fail() -> Any:
            raise ConnectionError("model endpoint is off")

        return fail()


class Slow(BaseChatClient):
    """A model that answers far too late."""

    def _inner_get_response(self, **kwargs: Any) -> Any:
        async def late() -> Any:
            await asyncio.sleep(30)
            raise AssertionError("should have been cancelled")

        return late()


MODEL = ModelInfo("test", "stand-in", True)


def goals_in(desk: Any) -> set[str]:
    return {m["moment_id"] for m in desk.tools.engine.moments if m["type"] == "goal" and m["t"] > 0}


def test_clean_run_airs_lines_for_every_variant() -> None:
    desk = run_with(OfflineWriter(), ModelInfo("offline", "templates", False))
    stats = runner.audit(desk)
    assert stats["lines_aired"] > 0 and stats["rejections"] == 0
    assert stats["aired_with_a_wrong_number"] == 0
    assert {line["variant"].split(":")[0] for line in desk.aired} == {"en", "pcm"}
    assert all(line["evidence"] for line in desk.aired)


def test_verifier_catches_planted_errors_and_none_air() -> None:
    desk = run_with(OfflineWriter(fault_rate=0.4), ModelInfo("offline", "templates", False))
    stats = runner.audit(desk)
    assert stats["rejections"] > 0
    assert stats["aired_with_a_wrong_number"] == 0
    fails = [x for x in desk.log if x["agent"] == "verifier" and x["action"] == "fail"]
    assert all(any("not in the facts" in r for r in x["reasons"]) for x in fails)
    retried = {(x["moment_id"], x["variant"]) for x in desk.log if x["agent"] == "narrator" and x.get("attempt") == 2}
    assert retried, "a failed line should go back to the narrator once"


def test_failure_drill_model_off_goals_still_announced() -> None:
    desk = run_with(Broken(), MODEL, full=True)
    aired_goals = {line["moment_id"] for line in desk.aired if line["type"] == "goal"}
    assert aired_goals == goals_in(desk)
    assert all(line["source"] == "template" for line in desk.aired)
    assert runner.audit(desk)["aired_with_a_wrong_number"] == 0
    assert any(x["agent"] == "narrator" and x["action"] == "failed" for x in desk.log)


def test_failure_drill_slow_model_falls_back_in_time() -> None:
    desk = run_with(Slow(), MODEL, deadline=0.3)
    assert desk.aired and all(line["source"] == "template" for line in desk.aired)
    assert any(x.get("reason") == "late" for x in desk.log)
    assert max(line["ms"] for line in desk.aired) < 5000


def test_full_match_has_a_recap_per_club_and_language() -> None:
    desk = run_with(OfflineWriter(), ModelInfo("offline", "templates", False), full=True)
    recaps = [line for line in desk.aired if line["moment_id"] == "recap"]
    tools = desk.tools
    clubs = (tools.home, tools.away)
    assert {line["variant"] for line in recaps} == {f"{lang}:{club}:full" for lang in ("en", "pcm") for club in clubs}
    score = tools.engine.state.score
    final = f"{tools.club_name(tools.home)} {score[tools.home]}, {tools.club_name(tools.away)} {score[tools.away]}."
    assert all(final in line["text"] for line in recaps), final


@pytest.mark.parametrize("level", ["essentials", "full", "analyst"])
def test_essentials_says_least(level: str) -> None:
    desk = run_with(OfflineWriter(), ModelInfo("offline", "templates", False), full=True)
    count = {lv: sum(1 for line in desk.aired if line["variant"] == f"en:CRV:{lv}") for lv in ("essentials", "full", "analyst")}
    assert count["essentials"] <= count[level]
