"""Run the commentary agents over a match.

Replays the match through the engine, hands each batch of new moments to the
editor -> narrator -> verifier -> publisher workflow, and writes:
- data/derived/<match>.commentary.json: every aired line per listener variant,
  with its evidence, source (model, template or offline), attempts and rejections;
- data/derived/<match>.agentlog.json: every agent step, for the agent desk.

Run:
  python -m agents.run demo_1                       # the best three minutes, no model (templates)
  BLINDSIDE_FAULT_RATE=0.3 python -m agents.run demo_1   # offline writer with planted errors: watch the verifier
  BLINDSIDE_MODEL=foundry-local python -m agents.run demo_1
  python -m agents.run demo_1 --full                # the whole match, with the full-time recap
  BLINDSIDE_MODEL=github python -m agents.run demo_1 --merge   # a model writes the best three minutes, kept
                                                    # inside the whole-match commentary already saved
"""

from __future__ import annotations

import argparse
import asyncio
import json
import statistics
import time
from pathlib import Path
import logging

from agents.match_tools import MatchTools
from agents.models import make_client
from agents.verifier import check_line, name_sets
from agents.workflow import LANGS, LEVELS, WORD_LIMIT, Assignment, Desk, Tick, Variant, Verified, build, _league_clubs

ROOT = Path(__file__).resolve().parent.parent
DERIVED = ROOT / "data" / "derived"
TICK = 5.0  # seconds of play between editor runs
CONTEXT_BEFORE = 20.0
WINDOW = 200.0


def recap_moment(tools: MatchTools) -> dict:
    """The full-time recap as a moment, so it goes through the same checks."""
    s = tools.engine.state
    goals = [m for m in tools.engine.moments if m["type"] == "goal"]

    def scorers(team: str) -> str:
        names = [str(m["facts"]["scorer"]) for m in goals if m["team"] == team]
        return " and ".join(dict.fromkeys(names))

    home, away = tools.home, tools.away
    whole = 200 * 60
    return {
        "moment_id": "recap", "t": s.t, "clock": s.clock, "minute": s.scoreline()["minute"], "type": "recap",
        "class": 2, "score": 1.0, "team": None, "players": [], "evidence": [m["evidence"][-1] for m in goals] or [s.events[-1]["id"]],
        "facts": {
            "score_home": s.score[home], "score_away": s.score[away],
            "home_scorers": scorers(home), "away_scorers": scorers(away),
            "shots_home": s.team_window(home, whole)["shots"], "shots_away": s.team_window(away, whole)["shots"],
        },
    }


async def run_match(match_id: str, full: bool = False, deadline: float = 8.0) -> Desk:
    tools = MatchTools(match_id)
    client, info = make_client()
    variants = [Variant(lang, club, level) for lang in LANGS for club in (tools.home, tools.away) for level in LEVELS]
    desk = Desk(tools=tools, model=info, client=client, variants=variants, deadline_s=deadline)
    workflow = build(desk)
    start, end = (0.0, float("inf")) if full else window_of(match_id)
    tools.advance_to(start)  # the state before the window is known, but not narrated
    last_t = tools.events[-1]["t"]
    t = start
    while t < min(end, last_t + TICK):
        t += TICK
        new = [m for m in tools.advance_to(t) if m["t"] > start]
        if new:
            await workflow.run(Tick(t, new))
    if full:
        tools.run_to_end()
        recap = recap_moment(tools)
        desk.note("editor", "assigned", moment_id="recap", type="recap", priority=2, levels=["full"], variants=4)
        narrators = [v for v in variants if v.level == "full"]
        a = Assignment(recap, "the full-time story for this listener's club", None, 2, narrators, recap["t"] + 60, deadline * 2)
        # The recap enters the workflow at the narrator: the editor's job (choosing) is already done.
        drafts_workflow = build_recap(desk)
        await drafts_workflow.run(a)
    return desk


def window_of(match_id: str) -> tuple[float, float]:
    """Match time of the best three minutes, with the run-up before them."""
    best = json.loads((ROOT / "data" / "matches" / f"{match_id}.match.json").read_text(encoding="utf-8"))["demo"]["best_three_minutes"]["t"]
    start = max(0.0, best - CONTEXT_BEFORE)
    return start, start + WINDOW


def merge_window(out: dict, log: list[dict], start: float, end: float) -> tuple[dict, list[dict]]:
    """Put a best-three-minutes run inside the saved whole-match run: its lines and steps replace the window's.

    Every line keeps its own source and provider, so the file still says which lines a model wrote.
    """
    path = DERIVED / f"{out['match_id']}.commentary.json"
    if not path.exists():
        return out, log
    whole = json.loads(path.read_text(encoding="utf-8"))
    whole_log = json.loads((DERIVED / f"{out['match_id']}.agentlog.json").read_text(encoding="utf-8"))
    outside = lambda x: not (start <= x["t"] < end)  # noqa: E731
    merged = dict(out)
    merged["window"] = "best_three_minutes, inside the whole match"
    merged["outside_window"] = {"provider": whole.get("provider"), "model": whole.get("model"), "stats": whole.get("stats")}
    merged["lines"] = sorted([x for x in whole["lines"] if outside(x)] + out["lines"], key=lambda x: (x["t"], x["variant"]))
    return merged, sorted([x for x in whole_log if outside(x)] + log, key=lambda x: x["t"])


def build_recap(desk: Desk):
    from agent_framework import WorkflowBuilder

    from agents.workflow import NarratorExecutor, PublisherExecutor, Retry, VerifierExecutor

    narrator, verifier, publisher = NarratorExecutor(desk), VerifierExecutor(desk), PublisherExecutor(desk)
    return (
        WorkflowBuilder(name="blindside-recap", start_executor=narrator, output_from=[publisher])
        .add_edge(narrator, verifier)
        .add_edge(verifier, narrator, condition=lambda msg: isinstance(msg, Retry))
        .add_edge(verifier, publisher, condition=lambda msg: isinstance(msg, Verified))
        .build()
    )


def audit(desk: Desk) -> dict:
    """Re-check every aired line with the code checks, and summarise the run (the agent evaluation)."""
    tools = desk.tools
    clubs = _league_clubs()
    moments = {m["moment_id"]: m for m in tools.engine.moments}
    wrong = 0
    for line in desk.aired:
        m = moments.get(line["moment_id"]) or (line["moment_id"] == "recap" and recap_moment(tools)) or None
        if not m:
            continue
        lang, _, level = line["variant"].split(":")
        allowed, every = name_sets(tools.names, clubs, m["facts"], tools.players_in(m.get("evidence", [])),
                                   {tools.club_name(tools.home), tools.club_name(tools.away)})
        c = check_line(line["text"], facts=m["facts"], minute=m.get("minute"), lang=lang,
                       word_limit=WORD_LIMIT[level] + 6, allowed_names=allowed, all_names=every)
        wrong += any(r.startswith("number") for r in c.reasons)
    drafts = [x for x in desk.log if x["agent"] == "verifier" and x["action"] in ("pass", "fail") and x["attempt"] == 1]
    ms = [x["ms"] for x in desk.aired]
    return {
        "lines_aired": len(desk.aired),
        "assignments": sum(1 for x in desk.log if x["agent"] == "editor" and x["action"] == "assigned"),
        "first_attempt_pass_rate": round(sum(1 for x in drafts if x["action"] == "pass") / len(drafts), 3) if drafts else None,
        "rejections": sum(1 for x in desk.log if x["agent"] == "verifier" and x["action"] == "fail"),
        "template_fallbacks": sum(1 for x in desk.aired if x["source"] == "template"),
        "aired_with_a_wrong_number": wrong,
        "median_ms_to_line": statistics.median(ms) if ms else None,
        "slowest_ms_to_line": max(ms) if ms else None,
    }


class _QuietOffline(logging.Filter):
    """The offline writer has no tools, and the framework says so on every agent; that is expected."""

    def filter(self, record: logging.LogRecord) -> bool:
        return "does not support function invoking" not in record.getMessage()


def main() -> None:
    logging.getLogger("agent_framework").addFilter(_QuietOffline())
    for h in logging.getLogger().handlers:
        h.addFilter(_QuietOffline())
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("match")
    ap.add_argument("--full", action="store_true", help="the whole match with the recap, not just the best three minutes")
    ap.add_argument("--deadline", type=float, default=8.0, help="seconds a line may take before the template airs")
    ap.add_argument("--merge", action="store_true", help="write the best three minutes into the saved whole-match files")
    args = ap.parse_args()
    began = time.monotonic()
    desk = asyncio.run(run_match(args.match, args.full, args.deadline))
    stats = audit(desk)
    out = {
        "match_id": args.match, "provider": desk.model.provider, "model": desk.model.model,
        "model_writes": desk.model.writes, "window": "full" if args.full else "best_three_minutes",
        "variants": [v.key for v in desk.variants], "stats": stats, "storylines": desk.storylines,
        "lines": sorted(desk.aired, key=lambda x: (x["t"], x["variant"])),
    }
    log = desk.log
    if args.merge and not args.full:
        out, log = merge_window(out, log, *window_of(args.match))
    DERIVED.mkdir(parents=True, exist_ok=True)
    (DERIVED / f"{args.match}.commentary.json").write_text(json.dumps(out, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    (DERIVED / f"{args.match}.agentlog.json").write_text(json.dumps(log, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"{args.match}: {desk.model.provider} ({desk.model.model}), {time.monotonic() - began:.1f} s")
    for k, v in stats.items():
        print(f"  {k}: {v}")
    for x in desk.log:
        if x["agent"] == "verifier" and x["action"] == "fail":
            print(f"  REJECTED {x['variant']}: {x['text']!r} -> {'; '.join(x['reasons'])}")
            break


if __name__ == "__main__":
    main()
