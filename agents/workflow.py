"""The commentary workflow: editor, then narrators, then verifier, then publish.

Built with Microsoft Agent Framework's workflow building blocks. Each step is
an executor; the verifier routes a line back to the narrator once when it
fails and time remains, otherwise the template airs. Shared state lives in
`Desk`: the storylines, the said log (through the match tools) and the agent
log that the companion screen's agent desk shows.

Goals take the fast road: the editor sends them at once with priority 1, and
the template is always ready if the narrator is slow.
"""

from __future__ import annotations

import asyncio
import json
import time
from dataclasses import dataclass, field
from typing import Any, Never

from agent_framework import Agent, Executor, WorkflowBuilder, WorkflowContext, handler

from agents.match_tools import MatchTools
from agents.models import ModelInfo, first_json
from agents.templates import template
from agents.verifier import check_line, name_sets

LANGS = ("en", "pcm")
LEVELS = ("essentials", "full", "analyst")
WORD_LIMIT = {"essentials": 16, "full": 26, "analyst": 34}
BUDGET = {"essentials": 12, "full": 25, "analyst": 35}  # seconds of speech per minute
MAX_CLASS = {"essentials": 2, "full": 3, "analyst": 3}
LANGUAGE_NAME = {"en": "English", "pcm": "Nigerian Pidgin"}


def speaking_time(text: str) -> float:
    return 0.4 + len(text.split()) / 2.6


def _detail(exc: BaseException) -> str:
    """The error's own message, with its cause, short enough for the agent log."""
    parts = [str(exc)] + ([str(exc.__cause__)] if exc.__cause__ else [])
    return " | ".join(p for p in parts if p)[:300]


# ---------------------------------------------------------------- messages


@dataclass(frozen=True)
class Variant:
    """One listener group: language, the club they support, and the detail level."""

    lang: str
    club: str
    level: str

    @property
    def key(self) -> str:
        return f"{self.lang}:{self.club}:{self.level}"


@dataclass
class Tick:
    """New moments for the editor, at play time t."""

    t: float
    moments: list[dict]


@dataclass
class Assignment:
    """What the editor wants said: a moment, the angle, and who should hear it."""

    moment: dict
    angle: str
    storyline: str | None
    priority: int
    variants: list[Variant]
    expires_t: float
    deadline_s: float
    started: float = field(default_factory=time.monotonic)

    @property
    def remaining(self) -> float:
        return self.deadline_s - (time.monotonic() - self.started)


@dataclass
class Drafts:
    assignment: Assignment
    lines: dict[str, dict]  # variant key -> {"text", "claims", "source"}
    attempt: int
    failed_keys: list[str] = field(default_factory=list)


@dataclass
class Retry:
    assignment: Assignment
    previous: Drafts
    reasons: dict[str, list[str]]


@dataclass
class Verified:
    assignment: Assignment
    lines: dict[str, dict]  # variant key -> aired line


# ---------------------------------------------------------------- shared state


@dataclass
class Desk:
    """Everything the agents share: the match tools, storylines, budgets and the log."""

    tools: MatchTools
    model: ModelInfo
    client: Any
    variants: list[Variant]
    deadline_s: float = 8.0
    storylines: list[dict] = field(default_factory=list)
    log: list[dict] = field(default_factory=list)
    spoken: dict[str, list[tuple[float, float]]] = field(default_factory=dict)  # level -> (t, seconds)
    last_end: dict[str, float] = field(default_factory=dict)
    aired: list[dict] = field(default_factory=list)

    def note(self, agent: str, action: str, **fields: Any) -> None:
        s = self.tools.engine.state
        self.log.append({"t": round(s.t, 2), "clock": round(s.clock, 2), "agent": agent, "action": action, **fields})

    def club(self, code: str) -> str:
        return self.tools.club_name(code)

    def fallback(self, moment: dict, v: Variant) -> str | None:
        if moment["type"] == "recap":
            from agents.templates import recap_template

            return recap_template(moment["facts"], v.lang, self.club, self.tools.home, self.tools.away, v.club)
        return template(moment, v.lang, v.level, self.club, self.tools.home, self.tools.away, v.club)


# ---------------------------------------------------------------- prompts

EDITOR_RULES = """You are the editor of live football commentary for blind and low-vision fans.
They follow the ball through sound, so words are scarce and must matter.
You are given candidate moments, the current storylines and what was said recently.
Choose at most two moments worth airing now, and for each give a short angle (under 12 words)
that links it to a storyline or says why it matters. Prefer moments that change the story.
Never invent facts. Reply with JSON only: {"picks": [{"moment_id": "...", "angle": "..."}]}"""

NARRATOR_RULES = """You write live football commentary for listeners who cannot see the match.
They hear the ball's position as sound, so do not describe every pass.
Rules:
- Use only the facts given. Never state a number, name or club that is not in the facts.
- Write each line directly in the requested language; never translate from English.
  Nigerian Pidgin must sound natural, the way a Lagos radio commentator speaks.
- Stay within each line's word limit.
- Be warm toward the listener's club, but never change a fact.
- essentials = what happened; full = what and why; analyst = what, why and one number from the facts.
- Say why the moment matters, using the angle.
- A plain version of each line is provided; you may improve it but must keep it true.
Reply with JSON only: {"lines": {"<variant key>": {"text": "...", "claims": [{"claim": "...", "fact_key": "..."}]}}}"""

CHECKER_RULES = """You check football commentary lines against facts for a blind audience. Be strict.
For each line, decide whether every claim is supported by the facts and the evidence events.
A line fails if it states anything not in the facts: a wrong number, a name not listed, an event that did not happen,
or a claim about why that the facts do not support.
Reply with JSON only: {"results": {"<variant key>": {"verdict": "pass" or "fail", "reason": "..."}}}"""


# ---------------------------------------------------------------- executors


class EditorExecutor(Executor):
    """Decides what is worth saying, and to whom, within each detail level's speaking budget."""

    def __init__(self, desk: Desk) -> None:
        super().__init__(id="editor")
        self.desk = desk
        self.agent = Agent(client=desk.client, name="Editor", instructions=EDITOR_RULES) if desk.model.writes else None

    @handler
    async def on_tick(self, tick: Tick, ctx: WorkflowContext[Assignment]) -> None:
        self.update_storylines(tick.t)
        goals = [m for m in tick.moments if m["class"] == 1]
        others = sorted((m for m in tick.moments if m["class"] > 1), key=lambda m: -m["score"])
        for m in goals:  # class 1: announced by code, never left to a model
            await ctx.send_message(self.assign(m, "a goal: say who scored and the score", self.levels_for(m) or list(LEVELS)))
        if not others:
            return
        picks = await self.choose(others)
        for m, angle in picks:
            levels = self.levels_for(m)
            if levels:
                await ctx.send_message(self.assign(m, angle, levels))
            else:
                self.desk.note("editor", "skipped", moment_id=m["moment_id"], type=m["type"], reason="over budget at every level")

    async def choose(self, candidates: list[dict]) -> list[tuple[dict, str]]:
        """Pick up to two moments and an angle. The model chooses when there is a real choice to make."""
        default = [(m, self.default_angle(m)) for m in candidates[:2]]
        if self.agent is None or len(candidates) == 1:
            return default
        brief = {
            "candidates": [{"moment_id": m["moment_id"], "type": m["type"], "team": m["team"], "score": m["score"],
                            "facts": m["facts"]} for m in candidates[:6]],
            "storylines": [s["text"] for s in self.desk.storylines[-3:]],
            "said_recently": [x["text"] for x in self.desk.tools.get_said_log(f"en:{self.desk.tools.home}:full", 3)],
            "score": self.desk.tools.get_score(),
        }
        try:
            reply = await asyncio.wait_for(self.agent.run(json.dumps(brief)), timeout=self.desk.deadline_s)
            picks = first_json(reply.text)["picks"]
            by_id = {m["moment_id"]: m for m in candidates}
            chosen = [(by_id[p["moment_id"]], str(p.get("angle") or self.default_angle(by_id[p["moment_id"]])))
                      for p in picks if p.get("moment_id") in by_id][:2]
            if chosen:
                self.desk.note("editor", "model_pick", picks=[{"moment_id": m["moment_id"], "angle": a} for m, a in chosen])
                return chosen
        except Exception as exc:  # a slow or broken model must never stop the match
            self.desk.note("editor", "model_failed", reason=type(exc).__name__, detail=_detail(exc))
        return default

    def default_angle(self, m: dict) -> str:
        for s in reversed(self.desk.storylines):
            if s["team"] == m["team"]:
                return s["text"]
        return {"high_turnover": "winning the ball back near goal", "big_chance": "how close it was",
                "momentum_swing": "who is on top now", "press_change": "a change in how hard they press",
                "hard_pass": "the quality of the pass", "long_move": "keeping the ball"}.get(m["type"], "why it matters")

    def levels_for(self, m: dict) -> list[str]:
        """Detail levels with room in their speaking budget for this moment."""
        out = []
        for level in LEVELS:
            if m["class"] > MAX_CLASS[level]:
                continue
            text = template(m, "en", level, self.desk.club, self.desk.tools.home, self.desk.tools.away, self.desk.tools.home)
            if not text:
                continue
            secs = speaking_time(text)
            used = sum(s for t, s in self.desk.spoken.get(level, []) if t > m["t"] - 60)
            quiet = m["t"] - self.desk.last_end.get(level, -1e9)
            if m["class"] == 1 or (m["class"] == 2 and used + secs <= BUDGET[level] and quiet >= 4) or \
                    (m["class"] == 3 and used + secs <= BUDGET[level] * 0.7 and quiet >= 20):
                out.append(level)
                self.desk.spoken.setdefault(level, []).append((m["t"], secs))
                self.desk.last_end[level] = max(self.desk.last_end.get(level, -1e9), m["t"]) + secs
        return out

    def assign(self, m: dict, angle: str, levels: list[str]) -> Assignment:
        variants = [v for v in self.desk.variants if v.level in levels]
        story = next((s["text"] for s in reversed(self.desk.storylines) if s["team"] == m["team"]), None)
        a = Assignment(m, angle, story, m["class"], variants, m["t"] + (20 if m["class"] == 1 else 8), self.desk.deadline_s)
        self.desk.note("editor", "assigned", moment_id=m["moment_id"], type=m["type"], priority=m["class"],
                       angle=angle, levels=levels, variants=len(variants))
        return a

    def update_storylines(self, t: float) -> None:
        """Storylines from the signals: who is on top and who is pressing, and since when."""
        s = self.desk.tools.engine.state
        sig = s.signals()
        minute = s.scoreline()["minute"]
        lead = sig["momentum_leader"]
        last = self.desk.storylines[-1] if self.desk.storylines else None
        if lead and (not last or last["kind"] != "momentum" or last["team"] != lead):
            self.desk.storylines.append({"kind": "momentum", "team": lead, "since": minute,
                                         "text": f"{self.desk.club(lead)} on top since minute {minute}"})
            self.desk.note("editor", "storyline", text=self.desk.storylines[-1]["text"])
        for team, p in sig["pressing"].items():
            if p["ratio"] and p["ratio"] >= 1.25 and not any(x["kind"] == "press" and x["team"] == team and minute - x["since"] < 15
                                                            for x in self.desk.storylines):
                self.desk.storylines.append({"kind": "press", "team": team, "since": minute,
                                             "text": f"{self.desk.club(team)} pressing high since minute {minute}"})
                self.desk.note("editor", "storyline", text=self.desk.storylines[-1]["text"])


class NarratorExecutor(Executor):
    """Writes one line per variant, one language per model call, all languages in parallel."""

    def __init__(self, desk: Desk) -> None:
        super().__init__(id="narrator")
        self.desk = desk

    @handler
    async def on_assignment(self, a: Assignment, ctx: WorkflowContext[Drafts]) -> None:
        lines = await self.write(a, a.variants, retry=None)
        await ctx.send_message(Drafts(a, lines, attempt=1))

    @handler
    async def on_retry(self, r: Retry, ctx: WorkflowContext[Drafts]) -> None:
        redo = [v for v in r.assignment.variants if v.key in r.reasons]
        fresh = await self.write(r.assignment, redo, retry=r.reasons)
        lines = dict(r.previous.lines) | fresh
        await ctx.send_message(Drafts(r.assignment, lines, attempt=2, failed_keys=list(r.reasons)))

    async def write(self, a: Assignment, variants: list[Variant], retry: dict[str, list[str]] | None) -> dict[str, dict]:
        by_lang: dict[str, list[Variant]] = {}
        for v in variants:
            by_lang.setdefault(v.lang, []).append(v)
        results = await asyncio.gather(*(self.write_lang(a, lang, vs, retry) for lang, vs in by_lang.items()))
        out: dict[str, dict] = {}
        for r in results:
            out |= r
        return out

    async def write_lang(self, a: Assignment, lang: str, variants: list[Variant], retry: dict[str, list[str]] | None) -> dict[str, dict]:
        m = a.moment
        request = {
            "moment_id": m["moment_id"], "type": m["type"], "minute": m.get("minute"), "facts": m["facts"],
            "angle": a.angle, "storyline": a.storyline, "language": LANGUAGE_NAME[lang], "retry": bool(retry),
            "variants": {
                v.key: {"listener_supports": self.desk.club(v.club), "level": v.level,
                        "word_limit": WORD_LIMIT[v.level] + (6 if a.priority == 1 else 0),
                        "fallback": self.desk.fallback(m, v) or "",
                        **({"previous_problems": retry[v.key]} if retry and v.key in retry else {})}
                for v in variants
            },
        }
        started = time.monotonic()
        agent = Agent(client=self.desk.client, name=f"Narrator-{lang}", instructions=NARRATOR_RULES)
        try:
            budget = max(0.5, a.remaining)
            reply = await asyncio.wait_for(agent.run(json.dumps(request, ensure_ascii=False)), timeout=budget)
            lines = first_json(reply.text)["lines"]
            source = "model" if self.desk.model.writes else "offline"
            out = {}
            for v in variants:
                got = lines.get(v.key) or {}
                text = str(got.get("text", "")).strip()
                out[v.key] = {"text": text, "claims": got.get("claims", []), "source": source}
                self.desk.note("narrator", "draft", moment_id=m["moment_id"], variant=v.key, text=text,
                               attempt=2 if retry else 1, ms=round((time.monotonic() - started) * 1000))
            return out
        except Exception as exc:
            reason = "late" if isinstance(exc, (asyncio.TimeoutError, TimeoutError)) else type(exc).__name__
            self.desk.note("narrator", "failed", moment_id=m["moment_id"], lang=lang, reason=reason, detail=_detail(exc),
                           ms=round((time.monotonic() - started) * 1000))
            return {v.key: {"text": "", "claims": [], "source": "none", "error": reason} for v in variants}


class VerifierExecutor(Executor):
    """Checks every line: code checks first, then a separate model check. Sends failures back once."""

    def __init__(self, desk: Desk) -> None:
        super().__init__(id="verifier")
        self.desk = desk
        self.checker = Agent(client=desk.client, name="Checker", instructions=CHECKER_RULES) if desk.model.writes else None
        league_names = desk.tools.names
        self.all_clubs = {c: n for c, n in _league_clubs().items()}
        self.league_names = league_names

    @handler
    async def on_drafts(self, d: Drafts, ctx: WorkflowContext[Retry | Verified]) -> None:
        a = d.assignment
        m = a.moment
        keys = d.failed_keys if d.attempt == 2 else [v.key for v in a.variants]
        verdicts: dict[str, list[str]] = {}
        evidence_players = self.desk.tools.players_in(m.get("evidence", []))
        allowed, every = name_sets(self.league_names, self.all_clubs, m["facts"], evidence_players,
                                   {self.desk.club(self.desk.tools.home), self.desk.club(self.desk.tools.away)})
        variants = {v.key: v for v in a.variants}
        for key in keys:
            v = variants[key]
            line = d.lines.get(key, {})
            if not line.get("text"):
                verdicts[key] = [f"no line ({line.get('error', 'empty')})"]
                continue
            c = check_line(line["text"], facts=m["facts"], minute=m.get("minute"), lang=v.lang,
                           word_limit=WORD_LIMIT[v.level] + (6 if a.priority == 1 else 0),
                           allowed_names=allowed, all_names=every)
            if not c.ok:
                verdicts[key] = c.reasons
        passed_code = [k for k in keys if k not in verdicts and d.lines[k].get("source") == "model"]
        if passed_code and self.checker is not None:
            verdicts |= await self.model_check(a, {k: d.lines[k]["text"] for k in passed_code})
        for key in keys:
            ok = key not in verdicts
            self.desk.note("verifier", "pass" if ok else "fail", moment_id=m["moment_id"], variant=key,
                           text=d.lines.get(key, {}).get("text", ""), reasons=verdicts.get(key, []), attempt=d.attempt)
        if verdicts and d.attempt == 1 and a.remaining > 0.5:
            await ctx.send_message(Retry(a, d, verdicts))
            return
        final: dict[str, dict] = {}
        for v in a.variants:
            line = dict(d.lines.get(v.key, {}))
            if v.key in verdicts or not line.get("text"):
                fb = self.desk.fallback(m, v)
                if not fb:
                    continue
                line = {"text": fb, "claims": [], "source": "template", "rejected": verdicts.get(v.key, [])}
                self.desk.note("verifier", "template", moment_id=m["moment_id"], variant=v.key, text=fb)
            line["attempts"] = d.attempt
            final[v.key] = line
        await ctx.send_message(Verified(a, final))

    async def model_check(self, a: Assignment, lines: dict[str, str]) -> dict[str, list[str]]:
        m = a.moment
        ids = set(m.get("evidence", []))
        events = [{k: e[k] for k in ("id", "type", "team", "outcome", "subtype") if k in e} |
                  ({"player": self.desk.tools.names.get(e["player"], e["player"])} if "player" in e else {})
                  for e in self.desk.tools.events if e["id"] in ids]
        req = {"facts": m["facts"], "minute": m.get("minute"), "evidence_events": events, "lines": lines}
        try:
            reply = await asyncio.wait_for(self.checker.run(json.dumps(req, ensure_ascii=False)),  # type: ignore[union-attr]
                                           timeout=max(0.5, a.remaining))
            results = first_json(reply.text)["results"]
            return {k: [f"model check: {r.get('reason', 'unsupported claim')}"] for k, r in results.items()
                    if k in lines and str(r.get("verdict", "")).lower() == "fail"}
        except Exception as exc:  # if the checker cannot answer, the code checks stand
            self.desk.note("verifier", "model_check_skipped", moment_id=m["moment_id"], reason=type(exc).__name__, detail=_detail(exc))
            return {}


class PublisherExecutor(Executor):
    """Publishes checked lines, one per variant, and records them in the said log."""

    def __init__(self, desk: Desk) -> None:
        super().__init__(id="publisher")
        self.desk = desk

    @handler
    async def on_verified(self, v: Verified, ctx: WorkflowContext[Never, list[dict]]) -> None:
        a = v.assignment
        m = a.moment
        out = []
        for key, line in v.lines.items():
            row = {
                "variant": key, "t": round(m["t"] + 0.6, 2), "expires_t": round(a.expires_t, 2), "priority": a.priority,
                "text": line["text"], "evidence": m.get("evidence", []), "moment_id": m["moment_id"], "type": m["type"],
                "source": line.get("source"), "attempts": line.get("attempts", 1), "rejected": line.get("rejected", []),
                "angle": a.angle, "model": self.desk.model.model, "provider": self.desk.model.provider,
                "ms": round((time.monotonic() - a.started) * 1000),
            }
            out.append(row)
            self.desk.tools.record_said(key, {"t": row["t"], "text": row["text"]})
        self.desk.aired.extend(out)
        self.desk.note("publisher", "published", moment_id=m["moment_id"], lines=len(out),
                       group=f"match:{self.desk.tools.match_id}:speech:<lang>:<club>:<level>")
        await ctx.yield_output(out)


def _league_clubs() -> dict[str, str]:
    from agents.match_tools import ROOT

    league = json.loads((ROOT / "data" / "league.json").read_text(encoding="utf-8"))
    return {c["code"]: c["name"] for c in league["clubs"]}


def build(desk: Desk) -> Any:
    """Wire the four executors into one workflow."""
    editor, narrator = EditorExecutor(desk), NarratorExecutor(desk)
    verifier, publisher = VerifierExecutor(desk), PublisherExecutor(desk)
    return (
        WorkflowBuilder(name="blindside-commentary", start_executor=editor, output_from=[publisher])
        .add_edge(editor, narrator)
        .add_edge(narrator, verifier)
        .add_edge(verifier, narrator, condition=lambda msg: isinstance(msg, Retry))
        .add_edge(verifier, publisher, condition=lambda msg: isinstance(msg, Verified))
        .build()
    )
