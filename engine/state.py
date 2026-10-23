"""Live match state built from the event stream, with no AI in it.

MatchState.update(event) is called once per event, in order. Everything the
agents may say comes from here: the score, who has the ball, rolling team
windows, per-player totals and the four story signals (momentum, control
versus chaos, pressing level, tempo).
"""

from __future__ import annotations

import bisect
import math
from dataclasses import dataclass, field

from engine import metrics as m

ON_BALL = {"pass", "carry", "shot", "set_piece", "possession_change", "clearance"}
WINS_BALL = {"tackle", "interception"}
MOMENTUM_TAU = 180.0  # seconds for older actions to count about a third as much


@dataclass
class PlayerStats:
    """Running totals for one player."""

    touches: int = 0
    passes: int = 0
    passes_complete: int = 0
    hard_passes_complete: int = 0
    shots: int = 0
    shots_on_target: int = 0
    goals: int = 0
    tackles: int = 0
    interceptions: int = 0
    carry_distance_m: float = 0.0
    top_speed_kmh: float = 0.0

    def as_dict(self) -> dict:
        d = self.__dict__.copy()
        d["pass_accuracy"] = round(self.passes_complete / self.passes, 3) if self.passes else None
        d["carry_distance_m"] = round(self.carry_distance_m, 1)
        d["top_speed_kmh"] = round(self.top_speed_kmh, 1)
        return d


@dataclass
class Possession:
    """The current spell of possession."""

    team: str | None = None
    start_t: float = 0.0
    start_x: float = 0.0  # attacking frame of the team in possession
    passes: int = 0
    max_x: float = 0.0


@dataclass
class MatchState:
    """Everything the engine knows about one match so far."""

    match_id: str
    home: str
    away: str
    names: dict[str, str] = field(default_factory=dict)
    t: float = 0.0
    clock: float = 0.0
    period: int = 1
    score: dict[str, int] = field(default_factory=dict)
    ball: tuple[float, float] = (52.5, 34.0)
    carrier: str | None = None
    possession: Possession = field(default_factory=Possession)
    players: dict[str, PlayerStats] = field(default_factory=dict)
    player_team: dict[str, str] = field(default_factory=dict)
    events: list[dict] = field(default_factory=list)
    _ts: list[float] = field(default_factory=list)
    _danger: dict[str, list[tuple[float, float]]] = field(default_factory=dict)
    _pressure_applied: dict[str, list[tuple[float, float]]] = field(default_factory=dict)
    possessions: list[tuple[str, int]] = field(default_factory=list)  # (team, passes) of finished spells
    last_shot_t: dict[str, float] = field(default_factory=dict)

    def __post_init__(self) -> None:
        self.score = {self.home: 0, self.away: 0}
        self._danger = {self.home: [], self.away: []}
        self._pressure_applied = {self.home: [], self.away: []}
        self.last_shot_t = {self.home: 0.0, self.away: 0.0}

    # ---------- helpers ----------

    def other(self, team: str) -> str:
        return self.away if team == self.home else self.home

    def ax(self, e: dict, end: bool = False) -> tuple[float, float]:
        """An event's position in the acting team's attacking frame."""
        x, y = (e["end_x"], e["end_y"]) if end else (e["x"], e["y"])
        return m.attacking(x, y, e["team"], self.home)

    def player(self, pid: str) -> PlayerStats:
        return self.players.setdefault(pid, PlayerStats())

    def window(self, seconds: float) -> list[dict]:
        """Events from the last `seconds` of play."""
        i = bisect.bisect_left(self._ts, self.t - seconds)
        return self.events[i:]

    # ---------- update ----------

    def update(self, e: dict) -> None:
        """Apply one event to the state."""
        self.events.append(e)
        self._ts.append(e["t"])
        self.t, self.clock, self.period = e["t"], e["clock"], e["period"]
        team, pid, kind = e.get("team"), e.get("player"), e["type"]
        if pid and team:
            self.player_team.setdefault(pid, team)
        if kind == "substitution" and e.get("recipient") and team:
            self.player_team[e["recipient"]] = team
        if "x" in e:
            self.ball = (e["x"], e["y"])
        if team and kind in ON_BALL | WINS_BALL:
            self._track_possession(e)
        if pid and kind in ON_BALL | WINS_BALL | {"save"}:
            self.player(pid).touches += 1
            self.carrier = pid
        getattr(self, f"_on_{kind}", lambda _e: None)(e)
        self._track_pressure(e)
        self._track_danger(e)

    def _track_possession(self, e: dict) -> None:
        team = e["team"]
        if team != self.possession.team:
            if self.possession.team is not None:
                self.possessions.append((self.possession.team, self.possession.passes))
            ax, _ = self.ax(e) if "x" in e else (0.0, 0.0)
            self.possession = Possession(team, e["t"], ax, 0, ax)
        if "x" in e:
            self.possession.max_x = max(self.possession.max_x, self.ax(e)[0])

    def _on_pass(self, e: dict) -> None:
        p = self.player(e["player"])
        p.passes += 1
        if e["outcome"] == "complete":
            p.passes_complete += 1
            self.possession.passes += 1
            if m.pass_difficulty(e, self.home) >= 4:
                p.hard_passes_complete += 1
            if e.get("recipient"):
                self.carrier = e["recipient"]

    def _on_carry(self, e: dict) -> None:
        p = self.player(e["player"])
        p.carry_distance_m += m.pass_distance(e)
        p.top_speed_kmh = max(p.top_speed_kmh, m.kmh(e.get("speed_mps", 0.0)))

    def _on_shot(self, e: dict) -> None:
        p = self.player(e["player"])
        p.shots += 1
        if e["outcome"] in ("goal", "on_target"):
            p.shots_on_target += 1
        self.last_shot_t[e["team"]] = e["t"]

    def _on_goal(self, e: dict) -> None:
        self.score[e["team"]] += 1
        self.player(e["player"]).goals += 1

    def _on_tackle(self, e: dict) -> None:
        self.player(e["player"]).tackles += 1

    def _on_interception(self, e: dict) -> None:
        self.player(e["player"]).interceptions += 1

    def _track_pressure(self, e: dict) -> None:
        """Pressure on the ball carrier counts as pressing by the other side, in the carrier's own half."""
        if e["type"] in ("pass", "carry") and "pressure" in e:
            ax, _ = self.ax(e)
            if ax < 52.5:
                self._pressure_applied[self.other(e["team"])].append((e["t"], e["pressure"]))

    def _track_danger(self, e: dict) -> None:
        """How threatening each action was, for momentum."""
        team, kind = e.get("team"), e["type"]
        if not team:
            return
        value = 0.0
        if kind == "shot":
            value = 0.3 + 2.0 * m.shot_quality(e, self.home)
        elif kind in ("pass", "carry") and e.get("outcome") == "complete" and "end_x" in e:
            ex, ey = self.ax(e, end=True)
            sx, _ = self.ax(e)
            if m.in_box(ex, ey):
                value = 0.35
            elif ex >= m.FINAL_THIRD > sx:
                value = 0.15
        elif kind == "set_piece" and e.get("subtype") in ("corner", "penalty"):
            value = 0.25
        elif kind in WINS_BALL:
            ax, _ = self.ax(e)
            if ax >= m.FINAL_THIRD:
                value = 0.3
        if value:
            self._danger[team].append((e["t"], value))

    # ---------- queries (also used by the MCP tools) ----------

    def momentum(self) -> float:
        """Recent danger of the home side minus the away side, older actions counting less."""
        def total(team: str) -> float:
            return sum(v * math.exp(-(self.t - t) / MOMENTUM_TAU) for t, v in self._danger[team] if self.t - t < 900)
        return round(total(self.home) - total(self.away), 3)

    def team_window(self, team: str, seconds: float) -> dict:
        """A team's numbers over the last `seconds` of play."""
        evs = [e for e in self.window(seconds) if e.get("team") == team]
        passes = [e for e in evs if e["type"] == "pass"]
        done = sum(1 for e in passes if e["outcome"] == "complete")
        xs = [self.ax(e)[0] for e in evs if "x" in e and e["type"] in ("pass", "carry")]
        won = [e for e in evs if e["type"] in WINS_BALL]
        shots = [e for e in evs if e["type"] == "shot"]
        return {
            "team": team,
            "window_s": seconds,
            "passes": len(passes),
            "pass_accuracy": round(done / len(passes), 3) if passes else None,
            "avg_ball_x": round(sum(xs) / len(xs), 1) if xs else None,
            "turnovers_won_final_third": sum(1 for e in won if self.ax(e)[0] >= m.FINAL_THIRD),
            "turnovers_won": len(won),
            "shots": len(shots),
            "shots_on_target": sum(1 for e in shots if e["outcome"] in ("goal", "on_target")),
            "xg": round(sum(m.shot_quality(e, self.home) for e in shots), 2),
            "goals": sum(1 for e in evs if e["type"] == "goal"),
        }

    def control_vs_chaos(self, seconds: float = 120.0) -> dict:
        """Passes per possession (control) against turnovers per minute (chaos), recently."""
        evs = self.window(seconds)
        changes = sum(1 for e in evs if e["type"] == "possession_change")
        passes = sum(1 for e in evs if e["type"] == "pass" and e["outcome"] == "complete")
        minutes = max(seconds / 60, 1e-6)
        per_poss = passes / max(changes, 1)
        per_min = changes / minutes
        return {"passes_per_possession": round(per_poss, 1), "turnovers_per_minute": round(per_min, 2),
                "state": "control" if per_poss >= 5 and per_min < 1.5 else "chaos" if per_min >= 2.5 else "balanced"}

    def pressing(self, team: str, seconds: float = 180.0) -> dict:
        """Average pressure a team applies in the opponent's half: recent versus whole match."""
        rows = self._pressure_applied[team]
        if not rows:
            return {"team": team, "recent": None, "match": None, "ratio": None}
        recent = [p for t, p in rows if t >= self.t - seconds]
        overall = sum(p for _, p in rows) / len(rows)
        r = sum(recent) / len(recent) if recent else None
        return {"team": team, "recent": round(r, 2) if r is not None else None, "match": round(overall, 2),
                "ratio": round(r / overall, 2) if r is not None and overall else None}

    def tempo(self, seconds: float = 120.0) -> dict:
        """Events per minute recently, against the match average."""
        recent = len(self.window(seconds)) / (seconds / 60)
        overall = len(self.events) / max(self.t / 60, 1)
        return {"events_per_minute": round(recent, 1), "match_average": round(overall, 1),
                "ratio": round(recent / overall, 2) if overall else None}

    def signals(self) -> dict:
        """The four story signals together."""
        return {
            "momentum": self.momentum(),
            "momentum_leader": None if abs(self.momentum()) < 0.3 else self.home if self.momentum() > 0 else self.away,
            "control_vs_chaos": self.control_vs_chaos(),
            "pressing": {t: self.pressing(t) for t in (self.home, self.away)},
            "tempo": self.tempo(),
        }

    def scoreline(self) -> dict:
        """Score, clock and period, for the agents and the screen."""
        mm, ss = divmod(int(self.clock), 60)
        return {"home": self.home, "away": self.away, "score": dict(self.score), "clock": f"{mm:02d}:{ss:02d}",
                "minute": mm + 1, "period": self.period, "possession": self.possession.team}
