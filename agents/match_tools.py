"""The match, as the agents see it: one set of read-only tools over the engine.

Every agent reads the match through these functions and nothing else. The
MCP server (agents/mcp_server.py) exposes the same functions to any MCP
client; the workflow calls them in-process. Results are plain JSON-ready
dicts, so what an agent sees is exactly what we can log and audit.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

from engine.pipeline import Engine, player_names

ROOT = Path(__file__).resolve().parent.parent
MATCHES = ROOT / "data" / "matches"


def load_events(match_id: str) -> tuple[dict, list[dict]]:
    """A saved match's metadata and events."""
    meta = json.loads((MATCHES / f"{match_id}.match.json").read_text(encoding="utf-8"))
    with (MATCHES / f"{match_id}.jsonl").open(encoding="utf-8") as f:
        events = [json.loads(line) for line in f if line.strip()]
    return meta, events


@dataclass
class MatchTools:
    """Read-only views of one match, as of a moment in time.

    `advance_to(t)` feeds the engine every event up to play time t, so a tool
    never sees the future. The said log records what has aired to each
    variant, so the editor can avoid repeating itself.
    """

    match_id: str
    meta: dict = field(init=False)
    events: list[dict] = field(init=False)
    engine: Engine = field(init=False)
    names: dict[str, str] = field(init=False)
    said: dict[str, list[dict]] = field(default_factory=dict)
    _next: int = 0

    def __post_init__(self) -> None:
        self.meta, self.events = load_events(self.match_id)
        self.names = player_names()
        self.engine = Engine.for_match(self.match_id, self.meta["home"]["code"], self.meta["away"]["code"], self.names)

    @property
    def home(self) -> str:
        return self.meta["home"]["code"]

    @property
    def away(self) -> str:
        return self.meta["away"]["code"]

    def club_name(self, code: str) -> str:
        return self.meta["home"]["name"] if code == self.home else self.meta["away"]["name"]

    def advance_to(self, t: float) -> list[dict]:
        """Process events up to play time t; return the moments found on the way."""
        found: list[dict] = []
        while self._next < len(self.events) and self.events[self._next]["t"] <= t:
            _, moments = self.engine.handle(self.events[self._next])
            found.extend(moments)
            self._next += 1
        return found

    def run_to_end(self) -> list[dict]:
        return self.advance_to(float("inf"))

    # ---------- the tools ----------

    def get_score(self) -> dict:
        """Current score, clock and period."""
        s = self.engine.state.scoreline()
        s["home_name"], s["away_name"] = self.club_name(self.home), self.club_name(self.away)
        return s

    def get_recent_events(self, seconds: int = 60, types: list[str] | None = None) -> list[dict]:
        """Events from the last N seconds of play, optionally only some types, with player names."""
        out = []
        for e in self.engine.state.window(seconds):
            if types and e["type"] not in types:
                continue
            row = {k: e[k] for k in ("id", "clock", "type", "team", "outcome", "subtype") if k in e}
            if "player" in e:
                row["player"] = self.names.get(e["player"], e["player"])
            out.append(row)
        return out

    def get_moment(self, moment_id: str) -> dict | None:
        """One moment with its facts and evidence."""
        return next((m for m in self.engine.moments if m["moment_id"] == moment_id), None)

    def get_player_stats(self, player: str) -> dict | None:
        """A player's running totals. Accepts an ID (p_123) or a name."""
        pid = player if player in self.engine.state.players else next(
            (k for k, v in self.names.items() if v.lower() == player.lower() or v.split()[-1].lower() == player.lower()), None)
        if pid is None or pid not in self.engine.state.players:
            return None
        stats = self.engine.state.players[pid].as_dict()
        stats["name"] = self.names.get(pid, pid)
        stats["team"] = self.engine.state.player_team.get(pid)
        return stats

    def get_team_stats(self, team: str, minutes: int = 5) -> dict:
        """A team's numbers over the last N minutes (use 120 for the whole match)."""
        return self.engine.state.team_window(team, minutes * 60)

    def get_signals(self) -> dict:
        """Momentum, control versus chaos, pressing level and tempo."""
        return self.engine.state.signals()

    def get_said_log(self, variant: str, last: int = 5) -> list[dict]:
        """The last lines aired to one listener variant, to avoid repeats."""
        return self.said.get(variant, [])[-last:]

    def record_said(self, variant: str, line: dict) -> None:
        self.said.setdefault(variant, []).append(line)

    def players_in(self, event_ids: list[str]) -> set[str]:
        """Names of every player mentioned by the given events (actors and pass receivers)."""
        wanted = set(event_ids)
        out: set[str] = set()
        for e in self.events[: self._next]:
            if e["id"] in wanted:
                for key in ("player", "recipient"):
                    if key in e:
                        out.add(self.names.get(e[key], e[key]))
        return out
