"""Moment detection: one small rule per kind of moment.

Each moment has a type, a starting score from 0 to 1, the team and players
involved, the IDs of the events that prove it, and `facts`: the exact values
the narrator is allowed to say. The verifier checks spoken lines against
these facts.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from engine import metrics as m
from engine.state import WINS_BALL, MatchState

CLASS = {  # 1 = always aired, 2 = aired if the budget allows, 3 = quiet spells only
    "goal": 1, "big_chance": 2, "high_turnover": 2, "momentum_swing": 2,
    "hard_pass": 3, "long_move": 3, "press_change": 3, "milestone": 3, "drought": 3, "sprint": 3,
}


@dataclass
class MomentDetector:
    """Watches the state after every event and emits moments."""

    state: MatchState
    moments: list[dict] = field(default_factory=list)
    _cooldown: dict[tuple, float] = field(default_factory=dict)
    _leader: str | None = None
    _leader_since: float = 0.0
    _swing_reported_for: str | None = None
    _drought_reported: dict[str, float] = field(default_factory=dict)
    _first_on_target: bool = False
    _turnover_count: dict[str, int] = field(default_factory=dict)

    def process(self, e: dict) -> list[dict]:
        """Run every rule against the latest event; return any new moments."""
        found: list[dict] = []
        for rule in (self.goal, self.big_chance, self.high_turnover, self.hard_pass, self.long_move,
                     self.milestone, self.sprint):
            mo = rule(e)
            if mo:
                found.append(mo)
        for rule in (self.momentum_swing, self.press_change, self.drought):
            found.extend(rule(e))
        for mo in found:
            mo["moment_id"] = f"mo_{len(self.moments) + 1:04d}"
            self.moments.append(mo)
        return found

    # ---------- helpers ----------

    def new(self, type_: str, score: float, team: str | None, players: list[str], evidence: list[str],
            facts: dict) -> dict:
        s = self.state
        return {
            "moment_id": "",
            "t": s.t,
            "clock": s.clock,
            "minute": s.scoreline()["minute"],
            "type": type_,
            "class": CLASS[type_],
            "score": round(min(1.0, score), 2),
            "team": team,
            "players": players,
            "evidence": evidence,
            "facts": facts,
        }

    def ready(self, key: tuple, seconds: float) -> bool:
        """True if this kind of moment for this key has not fired in the last `seconds`."""
        last = self._cooldown.get(key)
        if last is not None and self.state.t - last < seconds:
            return False
        self._cooldown[key] = self.state.t
        return True

    def name(self, pid: str | None) -> str | None:
        return self.state.names.get(pid, pid) if pid else None

    def prior(self, e: dict, n: int = 6, team: str | None = None) -> list[dict]:
        """The last n events before e, optionally only those by one team."""
        evs = self.state.events[:-1]
        if team:
            evs = [x for x in evs[-40:] if x.get("team") == team]
        return evs[-n:]

    # ---------- rules ----------

    def goal(self, e: dict) -> dict | None:
        if e["type"] != "goal":
            return None
        s = self.state
        shot = s.events[-2]
        team = e["team"]
        assist = next((x for x in reversed(self.prior(e, 8, team))
                       if x["type"] == "pass" and x["outcome"] == "complete" and x.get("recipient") == e["player"]), None)
        facts = {
            "scorer": self.name(e["player"]),
            "team": team,
            "minute": s.scoreline()["minute"],
            "score_home": s.score[s.home],
            "score_away": s.score[s.away],
            "shot_distance_m": round(m.shot_distance(shot, s.home)),
            "shot_speed_kmh": round(m.kmh(shot.get("speed_mps", 0))),
            "goals_for_scorer": s.players[e["player"]].goals,
        }
        if shot.get("subtype"):
            facts["finish"] = shot["subtype"]
        players = [e["player"]]
        evidence = [shot["id"], e["id"]]
        if assist:
            facts["assist"] = self.name(assist["player"])
            players.append(assist["player"])
            evidence.insert(0, assist["id"])
        return self.new("goal", 1.0, team, players, evidence, facts)

    def big_chance(self, e: dict) -> dict | None:
        if e["type"] != "shot" or e["outcome"] == "goal":
            return None
        xg = m.shot_quality(e, self.state.home)
        if xg < 0.18:
            return None
        return self.new("big_chance", 0.55 + xg, e["team"], [e["player"]], [e["id"]], {
            "shooter": self.name(e["player"]),
            "team": e["team"],
            "outcome": e["outcome"],
            "chance_quality_pct": round(xg * 100),
            "shot_distance_m": round(m.shot_distance(e, self.state.home)),
        })

    def high_turnover(self, e: dict) -> dict | None:
        if e["type"] not in WINS_BALL:
            return None
        s = self.state
        ax, _ = s.ax(e)
        if ax < m.FINAL_THIRD:
            return None
        recent = [x for x in s.window(300) if x.get("team") == e["team"] and x["type"] in WINS_BALL
                  and s.ax(x)[0] >= m.FINAL_THIRD]
        # One report per spell of pressing, unless the spell keeps growing past three.
        key = ("high_turnover", e["team"])
        last_count = self._turnover_count.get(e["team"], 0)
        growing = len(recent) >= 3 and len(recent) > last_count
        if not (self.ready(key, 150) or growing):
            return None
        self._cooldown[key] = s.t
        self._turnover_count[e["team"]] = len(recent)
        return self.new("high_turnover", 0.45 + 0.07 * len(recent), e["team"], [e["player"]],
                        [x["id"] for x in recent][-4:], {
                            "player": self.name(e["player"]),
                            "team": e["team"],
                            "won_by": e["type"],
                            "metres_from_goal": round(m.LENGTH - ax),
                            "turnovers_in_final_third_last_5min": len(recent),
                        })

    def hard_pass(self, e: dict) -> dict | None:
        if e["type"] != "pass" or e["outcome"] != "complete" or e.get("subtype") == "cross":
            return None
        diff = m.pass_difficulty(e, self.state.home)
        end_ax, _ = self.state.ax(e, end=True)
        if diff < 4 or end_ax < m.FINAL_THIRD or not self.ready(("hard_pass", e["team"]), 240):
            return None
        return self.new("hard_pass", 0.3 + 0.05 * diff, e["team"], [e["player"], e["recipient"]], [e["id"]], {
            "passer": self.name(e["player"]),
            "receiver": self.name(e["recipient"]),
            "team": e["team"],
            "difficulty": diff,
            "distance_m": round(m.pass_distance(e)),
            "completion_chance_pct": round(m.completion_chance(e, self.state.home) * 100),
        })

    def long_move(self, e: dict) -> dict | None:
        p = self.state.possession
        if e["type"] != "pass" or e["outcome"] != "complete" or p.passes != 10:
            return None
        evidence = [x["id"] for x in self.state.events if x["t"] >= p.start_t and x.get("team") == p.team
                    and x["type"] == "pass"][-10:]
        return self.new("long_move", 0.4, p.team, [e["player"]], evidence, {
            "team": p.team,
            "passes_in_move": 10,
            "seconds_in_possession": round(self.state.t - p.start_t),
        })

    def milestone(self, e: dict) -> dict | None:
        s = self.state
        if e["type"] == "pass" and e["outcome"] == "complete":
            n = s.players[e["player"]].passes_complete
            if n in (50, 75):
                return self.new("milestone", 0.3, e["team"], [e["player"]], [e["id"]], {
                    "player": self.name(e["player"]), "team": e["team"], "completed_passes": n})
        if e["type"] == "shot":
            team_shots = sum(1 for x in s.events if x["type"] == "shot" and x["team"] == e["team"])
            if team_shots == 10:
                return self.new("milestone", 0.3, e["team"], [e["player"]], [e["id"]], {
                    "team": e["team"], "team_shots": 10})
            if e["outcome"] in ("on_target", "goal") and not self._first_on_target:
                self._first_on_target = True
                if e["outcome"] == "on_target":
                    return self.new("milestone", 0.35, e["team"], [e["player"]], [e["id"]], {
                        "team": e["team"], "player": self.name(e["player"]), "first_shot_on_target_of_match": True})
        return None

    def sprint(self, e: dict) -> dict | None:
        if e["type"] != "carry":
            return None
        speed = m.kmh(e.get("speed_mps", 0))
        if speed < m.SPRINT_KMH or not self.ready(("sprint", e["player"]), 600):
            return None
        return self.new("sprint", 0.25, e["team"], [e["player"]], [e["id"]], {
            "player": self.name(e["player"]), "team": e["team"], "speed_kmh": round(speed, 1)})

    def momentum_swing(self, e: dict) -> list[dict]:
        """Momentum crosses from one side to the other and stays there for a minute."""
        s = self.state
        mom = s.momentum()
        leader = None if abs(mom) < 0.6 else s.home if mom > 0 else s.away
        if leader is None:
            return []
        if leader != self._leader:
            previous = self._leader
            self._leader, self._leader_since = leader, s.t
            self._prev_leader = previous
            return []
        if (s.t - self._leader_since >= 60 and self._swing_reported_for != leader
                and getattr(self, "_prev_leader", None) not in (None, leader) and s.clock > 600):
            self._swing_reported_for = leader
            w = s.team_window(leader, 300)
            o = s.team_window(s.other(leader), 300)
            evidence = [x["id"] for x in s.window(300) if x.get("team") == leader and x["type"] in ("shot", "tackle", "interception")][-5:]
            return [self.new("momentum_swing", 0.55, leader, [], evidence, {
                "team": leader,
                "shots_last_5min": w["shots"],
                "opponent_shots_last_5min": o["shots"],
                "turnovers_won_final_third_last_5min": w["turnovers_won_final_third"],
                "passes_last_5min": w["passes"],
                "opponent_passes_last_5min": o["passes"],
            })]
        return []

    def press_change(self, e: dict) -> list[dict]:
        s = self.state
        out = []
        if s.clock < 900:
            return out
        for team in (s.home, s.away):
            p = s.pressing(team)
            if p["ratio"] is None:
                continue
            if p["ratio"] >= 1.3 or p["ratio"] <= 0.7:
                if not self.ready(("press_change", team), 600):
                    continue
                direction = "up" if p["ratio"] >= 1.3 else "down"
                evidence = [x["id"] for x in s.window(180) if x["type"] in ("pass", "carry") and x.get("team") == s.other(team)
                            and "pressure" in x and s.ax(x)[0] < 52.5][-5:]
                out.append(self.new("press_change", 0.4, team, [], evidence, {
                    "team": team, "direction": direction,
                    "pressing_change_pct": round((p["ratio"] - 1) * 100),
                    "window_min": 3,
                }))
        return out

    def drought(self, e: dict) -> list[dict]:
        s = self.state
        out = []
        for team in (s.home, s.away):
            since = s.last_shot_t[team]
            if s.t - since >= 900 and self._drought_reported.get(team) != since:
                self._drought_reported[team] = since
                out.append(self.new("drought", 0.35, team, [], [e["id"]], {
                    "team": team, "minutes_without_a_shot": 15}))
        return out
