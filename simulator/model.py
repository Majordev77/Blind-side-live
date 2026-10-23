"""Possession-chain match simulator.

The player on the ball takes one action per step (pass, carry, shot or
clearance). The choice depends on the zone and the pressure, and the outcome
on skill, distance and pressure. Failures become tackles, interceptions or
the ball going out, followed by a possession change or a restart.

Internally positions are in the attacking frame of the team in possession
(ax from its own goal line, 0, to the opponent's, 105). Events are written in
the fixed frame of shared/event.schema.json: home attacks toward x = 105 in
both halves.
"""

from __future__ import annotations

import math
import random
from dataclasses import dataclass, field

LENGTH, WIDTH = 105.0, 68.0
GOAL = (105.0, 34.0)
HALF = 2700.0

# Where each role stands when its team has the ball at halfway (attacking frame).
ROLE_HOME: dict[str, tuple[float, float]] = {
    "GK": (6, 34), "RB": (34, 8), "RCB": (24, 24), "LCB": (24, 44), "LB": (34, 60),
    "DM": (40, 34), "RCM": (52, 20), "LCM": (52, 48), "RW": (72, 9), "ST": (76, 34), "LW": (72, 59),
}
# How far each role follows the ball along the pitch.
ROLE_MIN_X = {"GK": 3, "RB": 12, "RCB": 9, "LCB": 9, "LB": 12, "DM": 18,
              "RCM": 24, "LCM": 24, "RW": 34, "ST": 38, "LW": 34}
ROLE_MAX_X = {"GK": 22, "RB": 86, "RCB": 62, "LCB": 62, "LB": 86, "DM": 76,
              "RCM": 84, "LCM": 84, "RW": 90, "ST": 94, "LW": 90}
ROLE_FOLLOW = {"GK": 0.12, "RB": 0.7, "RCB": 0.6, "LCB": 0.6, "LB": 0.7, "DM": 0.7,
               "RCM": 0.8, "LCM": 0.8, "RW": 0.75, "ST": 0.7, "LW": 0.75}


@dataclass
class Player:
    """A player on the pitch or the bench. Ratings are scaled to 0..1."""

    id: str
    name: str
    position: str
    role: str
    passing: float
    pace: float
    finishing: float
    on_at: float = 0.0  # match clock when the player came on


@dataclass
class Team:
    """A club in one match: line-up, bench and style settings."""

    code: str
    name: str
    directness: float
    press: float
    width: float
    on_pitch: list[Player]
    bench: list[Player]
    subs_made: int = 0
    base: tuple[float, float] = field(default=(0.5, 0.5))

    def by_role(self, role: str) -> Player:
        return next(p for p in self.on_pitch if p.role == role)


def build_team(club: dict) -> Team:
    """Turn a club from data/league.json into a Team for one match."""
    players = [
        Player(p["id"], p["name"], p["position"], p["role"],
               p["passing"] / 100, p["pace"] / 100, p["finishing"] / 100)
        for p in club["players"]
    ]
    style = club["style"]
    return Team(club["code"], club["name"], style["directness"], style["press"], style["width"],
                [p for p in players if p.role != "SUB"], [p for p in players if p.role == "SUB"],
                base=(style["directness"], style["press"]))


def clamp(v: float, lo: float, hi: float) -> float:
    return lo if v < lo else hi if v > hi else v


def shot_quality(ax: float, ay: float, pressure: float, header: bool = False) -> float:
    """Chance a shot from (ax, ay) in the attacking frame becomes a goal (an xG estimate)."""
    dx, dy = GOAL[0] - ax, GOAL[1] - ay
    d = math.hypot(dx, dy)
    angle = math.atan2(7.32 * max(dx, 0.1), dx * dx + dy * dy - 3.66 ** 2)
    if angle < 0:
        angle += math.pi
    xg = 0.6 * angle / (angle + 0.35) * math.exp(-0.09 * d)
    xg *= 1 - 0.45 * pressure
    if header:
        xg *= 0.6
    return clamp(xg, 0.005, 0.8)


class MatchSimulator:
    """Generates one match as a list of event dicts."""

    def __init__(self, league: dict, home: str, away: str, seed: int, match_id: str) -> None:
        clubs = {c["code"]: c for c in league["clubs"]}
        self.rng = random.Random(seed)
        self.match_id = match_id
        self.teams = [build_team(clubs[home]), build_team(clubs[away])]
        self.events: list[dict] = []
        self.score = [0, 0]
        self.t = 0.0
        self.period = 1
        self.period_start_t = 0.0
        self.period_end_clock = HALF + self.rng.uniform(60, 240)
        self.poss = 0
        self.carrier: Player = self.teams[0].by_role("ST")
        self.ax, self.ay = 52.5, 34.0
        self.restart: tuple[str, int, float, float] | None = ("kickoff", 0, 52.5, 34.0)
        self.kicked_off_first = 0
        self.after_goal = False  # the next kickoff follows a goal celebration

    # ---------- clock and output ----------

    @property
    def clock(self) -> float:
        return (0.0 if self.period == 1 else HALF) + (self.t - self.period_start_t)

    def emit(self, type_: str, side: int | None = None, player: Player | None = None,
             pos: tuple[float, float] | None = None, end: tuple[float, float] | None = None,
             frame: int | None = None, **extra: object) -> dict:
        """Append one event. Positions are given in the attacking frame of `frame` (default: side)."""
        ev: dict = {
            "id": f"ev_{len(self.events) + 1:06d}",
            "match_id": self.match_id,
            "t": round(self.t, 2),
            "clock": round(self.clock, 2),
            "period": self.period,
            "type": type_,
        }
        if side is not None:
            ev["team"] = self.teams[side].code
        if player is not None:
            ev["player"] = player.id
        f = side if frame is None else frame
        if pos is not None:
            ev["x"], ev["y"] = self.to_abs(f, *pos)
        if end is not None:
            ev["end_x"], ev["end_y"] = self.to_abs(f, *end)
        for k, v in extra.items():
            if v is not None:
                ev[k] = round(v, 2) if isinstance(v, float) else v
        self.events.append(ev)
        return ev

    @staticmethod
    def to_abs(side: int | None, ax: float, ay: float) -> tuple[float, float]:
        ax, ay = clamp(ax, 0, LENGTH), clamp(ay, 0, WIDTH)
        if side == 1:
            ax, ay = LENGTH - ax, WIDTH - ay
        return round(ax, 1), round(ay, 1)

    # ---------- positions and pressure ----------

    def attacker_pos(self, p: Player) -> tuple[float, float]:
        team = self.teams[self.poss]
        hx, hy = ROLE_HOME[p.role]
        x = hx + ROLE_FOLLOW[p.role] * (self.ax - 52.5)
        y = 34 + (hy - 34) * (0.8 + 0.45 * team.width) + (self.ay - 34) * 0.3
        return clamp(x, ROLE_MIN_X[p.role], ROLE_MAX_X[p.role]), clamp(y, 1, 67)

    def defender_pos(self, p: Player) -> tuple[float, float]:
        """A defending player's position, converted into the attacking frame."""
        bx, by = LENGTH - self.ax, WIDTH - self.ay  # ball in the defenders' own frame
        hx, hy = ROLE_HOME[p.role]
        hx = hx * 0.85  # out of possession the block sits deeper
        x = hx + ROLE_FOLLOW[p.role] * 0.8 * (bx - 52.5)
        y = 34 + (hy - 34) * 0.75 + (by - 34) * 0.45
        return LENGTH - clamp(x, 2, 103), WIDTH - clamp(y, 1, 67)

    def nearest_defender(self, ax: float, ay: float) -> tuple[Player, float]:
        best, best_d = None, 1e9
        for p in self.teams[1 - self.poss].on_pitch:
            dx, dy = self.defender_pos(p)
            d = math.hypot(dx - ax, dy - ay)
            if d < best_d:
                best, best_d = p, d
        assert best is not None
        return best, best_d

    def pressure(self) -> float:
        defence = self.teams[1 - self.poss]
        _, d = self.nearest_defender(self.ax, self.ay)
        zone = 1.0 if self.ax < 40 else 0.65 if self.ax < 70 else 0.5
        p = 0.45 * (1 - d / 14) + 0.35 * defence.press * zone + self.rng.gauss(0, 0.12)
        if self.ax > 88.5 and abs(self.ay - 34) < 20.15:
            p += 0.2  # the penalty box is packed with defenders
        return round(clamp(p, 0, 1), 2)

    def fatigue(self, p: Player) -> float:
        played = self.clock - p.on_at
        return 1 - 0.07 * clamp((played - 3000) / 2400, 0, 1)

    # ---------- the main loop ----------

    def run(self) -> list[dict]:
        """Simulate the whole match and return its events."""
        self.emit("period_start", pos=None)
        while True:
            if self.clock >= self.period_end_clock and self.restart is not None:
                if self.period == 2:
                    self.emit("period_end")
                    break
                self.emit("period_end")
                self.period = 2
                self.period_start_t = self.t
                self.period_end_clock = 2 * HALF + self.rng.uniform(180, 360)
                self.emit("period_start")
                self.restart = ("kickoff", 1 - self.kicked_off_first, 52.5, 34.0)
            if self.restart is not None:
                self.take_restart()
            else:
                self.step()
            if self.clock >= self.period_end_clock and self.restart is None and self.rng.random() < 0.15:
                self.restart = ("kickoff", 0, 52.5, 34.0)  # the referee blows: next loop ends the period
            self.maybe_substitute()
        return self.events

    def advance(self, seconds: float) -> None:
        self.t += seconds

    def set_possession(self, side: int, player: Player, ax: float, ay: float, announce: bool = True) -> None:
        """Hand the ball to `side`. ax, ay are already in the new side's frame."""
        changed = side != self.poss
        self.poss, self.carrier, self.ax, self.ay = side, player, ax, ay
        if changed and announce:
            self.emit("possession_change", side, player, (ax, ay))

    def flip(self, ax: float, ay: float) -> tuple[float, float]:
        return LENGTH - ax, WIDTH - ay

    def adjust_styles(self) -> None:
        """A goal changes both clubs' approach: the trailing side goes direct and presses."""
        for side in (0, 1):
            team = self.teams[side]
            diff = self.score[side] - self.score[1 - side]
            d0, p0 = team.base
            team.directness = clamp(d0 - 0.06 * diff, 0.1, 0.95)
            team.press = clamp(p0 - 0.07 * diff, 0.1, 0.95)

    # ---------- one action by the player on the ball ----------

    def step(self) -> None:
        team = self.teams[self.poss]
        pressure = self.pressure()
        self.advance(self.rng.uniform(1.2, 3.7) * (1 - 0.35 * pressure))
        central = abs(self.ay - 34) < 20
        if self.ax < 30:
            probs = {"pass": 0.80 - 0.12 * pressure, "carry": 0.14, "clearance": 0.03 + 0.12 * pressure, "shot": 0.0}
        elif self.ax < 70:
            probs = {"pass": 0.74, "carry": 0.25, "clearance": 0.005, "shot": 0.006 if self.ax > 60 else 0.0}
        elif self.ax < 88.5:
            probs = {"pass": 0.67, "carry": 0.26, "clearance": 0.0, "shot": 0.022 if central else 0.006}
        else:
            probs = {"pass": 0.40, "carry": 0.18, "clearance": 0.0, "shot": 0.062 if central else 0.013}
        action = self.rng.choices(list(probs), weights=list(probs.values()))[0]
        if self.carrier.role == "GK" and action in ("carry", "shot"):
            action = "pass"
        getattr(self, f"do_{action}")(team, pressure)

    def pick_target(self, team: Team) -> tuple[Player, float, float, str | None]:
        """Choose a teammate to pass to, with a forward bias set by directness."""
        cands, weights = [], []
        for p in team.on_pitch:
            if p is self.carrier or (p.role == "GK" and self.ax > 35):
                continue
            tx, ty = self.attacker_pos(p)
            d = math.hypot(tx - self.ax, ty - self.ay)
            gain = tx - self.ax
            w = math.exp(-(((d - 15) / 11) ** 2)) * math.exp((0.35 + team.directness) * gain / 22)
            if gain < 0:
                w *= 1 - 0.5 * team.directness
            if self.ax > 88.5 and tx > 88.5:
                w *= 0.2  # the box is crowded: most balls go back out or wide
            cands.append((p, tx, ty))
            weights.append(max(w, 1e-4))
        p, tx, ty = self.rng.choices(cands, weights=weights)[0]
        kind = None
        if self.ax < 45 and self.rng.random() < team.directness * 0.16:
            p = team.by_role("ST")
            tx, ty = self.attacker_pos(p)
            kind = "long_ball"
        elif self.ax > 72 and abs(self.ay - 34) > 20 and self.rng.random() < 0.4:
            p = self.rng.choice([team.by_role("ST"), team.by_role("LW" if self.ay < 34 else "RW"),
                                 team.by_role("LCM" if self.ay < 34 else "RCM")])
            tx, ty = self.rng.uniform(92, 101), self.rng.uniform(26, 42)
            kind = "cross"
        return p, tx + self.rng.gauss(0, 1.5), ty + self.rng.gauss(0, 1.5), kind

    def do_pass(self, team: Team, pressure: float) -> None:
        passer = self.carrier
        target, tx, ty, kind = self.pick_target(team)
        tx, ty = clamp(tx, 1, 104), clamp(ty, 0.5, 67.5)
        d = math.hypot(tx - self.ax, ty - self.ay)
        skill = passer.passing * self.fatigue(passer)
        if kind == "cross":
            p_ok = 0.30 + 0.25 * (skill - 0.7) - 0.15 * pressure
        else:
            p_ok = 1.03 - 0.0045 * d - 0.24 * pressure + 0.25 * (skill - 0.7) - 0.002 * max(0.0, tx - 70)
            if kind == "long_ball":
                p_ok -= 0.12
            if tx > 88.5 and abs(ty - 34) < 20.15:
                p_ok -= 0.08  # passes into a packed box
        ok = self.rng.random() < clamp(p_ok, 0.05, 0.985)
        speed = clamp(6 + 0.45 * d + self.rng.gauss(0, 1.5), 5, 30)
        self.emit("pass", self.poss, passer, (self.ax, self.ay), (tx, ty), recipient=target.id,
                  outcome="complete" if ok else "incomplete", pressure=pressure,
                  speed_mps=round(speed, 1), subtype=kind)
        self.advance(d / speed)
        if ok:
            self.carrier, self.ax, self.ay = target, tx, ty
            if kind == "cross" and self.rng.random() < 0.45:
                self.do_shot(team, self.pressure(), header=True)
            return
        self.lose_pass(team, tx, ty, kind)

    def lose_pass(self, team: Team, tx: float, ty: float, kind: str | None) -> None:
        side = self.poss
        if kind == "cross":
            if self.rng.random() < 0.15:
                self.emit("out", side, self.carrier, (tx, ty), subtype="goal_line")
                self.restart = ("corner", side, 105.0, 0.0 if ty < 34 else 68.0)
                return
            if self.rng.random() < 0.5:
                d, _ = self.nearest_defender(tx, ty)
                self.emit("clearance", 1 - side, d, (tx, ty), frame=side)
                self.loose_ball(side, tx - self.rng.uniform(25, 45), self.rng.uniform(8, 60))
                return
        if self.rng.random() < 0.13:
            self.emit("out", side, self.carrier, (tx, ty), subtype="touchline")
            self.restart = ("throw_in", 1 - side, LENGTH - tx, WIDTH - (0.0 if ty < 34 else 68.0))
            return
        frac = self.rng.uniform(0.5, 1.0)
        ix, iy = self.ax + (tx - self.ax) * frac, self.ay + (ty - self.ay) * frac
        defender, _ = self.nearest_defender(ix, iy)
        self.advance(0.3)
        self.emit("interception", 1 - side, defender, (ix, iy), frame=side, outcome="won")
        nx, ny = self.flip(ix, iy)
        self.set_possession(1 - side, defender, nx, ny)

    def loose_ball(self, attacking_side: int, ax: float, ay: float) -> None:
        """A cleared ball lands at (ax, ay) in the attacking side's frame and is won by either side."""
        ax, ay = clamp(ax, 5, 100), clamp(ay, 2, 66)
        self.advance(self.rng.uniform(1.5, 3.0))
        self.ax, self.ay = ax, ay
        if self.rng.random() < 0.42:
            team = self.teams[attacking_side]
            p = min(team.on_pitch, key=lambda q: math.dist(self.attacker_pos(q), (ax, ay)) if q.role != "GK" else 1e9)
            self.carrier = p
        else:
            self.poss = attacking_side
            d, _ = self.nearest_defender(ax, ay)
            nx, ny = self.flip(ax, ay)
            self.set_possession(1 - attacking_side, d, nx, ny)

    def do_carry(self, team: Team, pressure: float) -> None:
        p = self.carrier
        pace = p.pace * self.fatigue(p)
        length = self.rng.uniform(3, 12) * (0.7 + 0.6 * pace)
        angle = self.rng.gauss(0, 0.7)
        ex = clamp(self.ax + length * math.cos(angle), 1, 104)
        ey = clamp(self.ay + length * math.sin(angle), 1, 67)
        speed = clamp(4.5 + 3.5 * pace + self.rng.gauss(0, 0.5), 3.5, 9.5)
        ok = self.rng.random() < clamp(0.92 - 0.34 * pressure + 0.12 * (pace - 0.7), 0.3, 0.98)
        self.emit("carry", self.poss, p, (self.ax, self.ay), (ex, ey), pressure=pressure,
                  speed_mps=round(speed, 1), outcome="complete" if ok else "lost")
        self.advance(length / speed)
        if ok:
            self.ax, self.ay = ex, ey
            return
        side = self.poss
        defender, _ = self.nearest_defender(ex, ey)
        if self.rng.random() < 0.15:
            self.emit("foul", 1 - side, defender, (ex, ey), frame=side)
            in_box = ex > 88.5 and abs(ey - 34) < 20.15
            if in_box and self.rng.random() < 0.3:
                self.restart = ("penalty", side, 94.0, 34.0)
            else:
                self.restart = ("free_kick", side, ex, ey)
            return
        self.emit("tackle", 1 - side, defender, (ex, ey), frame=side, outcome="won")
        nx, ny = self.flip(ex, ey)
        self.set_possession(1 - side, defender, nx, ny)

    def do_clearance(self, team: Team, pressure: float) -> None:
        side = self.poss
        self.emit("clearance", side, self.carrier, (self.ax, self.ay), pressure=pressure)
        if self.rng.random() < 0.22:
            self.advance(2.0)
            self.restart = ("throw_in", 1 - side, LENGTH - self.rng.uniform(40, 75), self.rng.choice([0.0, 68.0]))
            return
        self.loose_ball(side, self.rng.uniform(45, 75), self.rng.uniform(5, 63))

    def do_shot(self, team: Team, pressure: float, header: bool = False, penalty: bool = False,
                free_kick: bool = False) -> None:
        side, shooter = self.poss, self.carrier
        if penalty:
            xg = 0.76
        else:
            xg = shot_quality(self.ax, self.ay, pressure, header)
            if free_kick:
                xg = min(xg, 0.07)
            xg *= 1.0 + 0.45 * shooter.finishing * self.fatigue(shooter)
        speed = clamp(16 + 16 * shooter.finishing * self.rng.random() - (6 if header else 0), 10, 34)
        p_block = 0.0 if penalty or free_kick else 0.2 + 0.15 * pressure
        r = self.rng.random()
        subtype = "penalty" if penalty else "free_kick" if free_kick else "header" if header else None
        dist = math.dist((self.ax, self.ay), GOAL)
        travel = dist / speed
        if r < p_block:
            outcome = "blocked"
        elif self.rng.random() < min(0.9, xg / (1 - p_block)):
            outcome = "goal"
        elif self.rng.random() < 0.4:
            outcome = "on_target"
        else:
            outcome = "off_target"
        end = (105.0, clamp(34 + self.rng.gauss(0, 2.2 if outcome in ("goal", "on_target") else 5), 20, 48))
        self.emit("shot", side, shooter, (self.ax, self.ay), end if outcome != "blocked" else None,
                  outcome=outcome, pressure=None if penalty else pressure, speed_mps=round(speed, 1),
                  subtype=subtype)
        self.advance(travel)
        defence = self.teams[1 - side]
        gk = defence.by_role("GK")
        if outcome == "goal":
            self.emit("goal", side, shooter, end)
            self.score[side] += 1
            self.adjust_styles()
            self.after_goal = True
            self.restart = ("kickoff", 1 - side, 52.5, 34.0)
        elif outcome == "on_target":
            held = self.rng.random() < 0.55
            self.emit("save", 1 - side, gk, end, frame=side, outcome="held" if held else "parried")
            if not held and self.rng.random() < 0.5:
                self.restart = ("corner", side, 105.0, self.rng.choice([0.0, 68.0]))
            else:
                self.set_possession(1 - side, gk, 6.0, 34.0)
        elif outcome == "off_target":
            self.emit("out", side, shooter, end, subtype="goal_line")
            self.restart = ("goal_kick", 1 - side, 6.0, 34.0)
        else:
            r = self.rng.random()
            if r < 0.25:
                self.emit("out", side, shooter, (104.0, self.ay), subtype="goal_line")
                self.restart = ("corner", side, 105.0, 0.0 if self.ay < 34 else 68.0)
            elif r < 0.75:
                d, _ = self.nearest_defender(self.ax, self.ay)
                nx, ny = self.flip(self.ax + 1, self.ay)
                self.set_possession(1 - side, d, nx, ny)
            else:
                self.ax -= 6  # the shooter's side wins the rebound

    # ---------- restarts ----------

    def take_restart(self) -> None:
        assert self.restart is not None
        kind, side, ax, ay = self.restart
        self.restart = None
        team = self.teams[side]
        dead = {"kickoff": (40, 75), "throw_in": (8, 18), "corner": (18, 32), "goal_kick": (15, 28),
                "free_kick": (15, 35), "penalty": (45, 75)}[kind]
        if kind == "kickoff" and not self.after_goal:
            dead = (0, 1)  # the start of a half
        self.after_goal = False
        self.advance(self.rng.uniform(*dead))
        if kind == "kickoff":
            player = team.by_role("ST")
        elif kind == "goal_kick":
            player = team.by_role("GK")
        elif kind == "throw_in":
            role = ("RB" if ay < 34 else "LB") if ax < 60 else ("RW" if ay < 34 else "LW")
            player = team.by_role(role)
        elif kind == "corner":
            player = team.by_role("RW" if ay < 34 else "LW")
        elif kind == "penalty":
            player = max(team.on_pitch, key=lambda p: p.finishing)
        else:
            player = min((p for p in team.on_pitch if p.role != "GK"),
                         key=lambda p: math.dist(ROLE_HOME[p.role], (ax, ay)))
        self.set_possession(side, player, ax, ay, announce=kind != "kickoff")
        self.emit("set_piece", side, player, (ax, ay), subtype=kind, outcome="awarded")
        if kind == "penalty":
            self.do_shot(team, 0.0, penalty=True)
        elif kind == "corner":
            self.ax, self.ay = clamp(ax, 0, 104.5), clamp(ay, 0.5, 67.5)
            self.corner(team)
        elif kind == "free_kick" and ax > 78 and abs(ay - 34) < 18 and self.rng.random() < 0.35:
            self.do_shot(team, 0.0, free_kick=True)
        elif kind == "kickoff":
            self.do_pass(team, 0.0)

    def corner(self, team: Team) -> None:
        """Deliver a corner into the box: a cross that may become a header."""
        target = self.rng.choice([team.by_role("ST"), team.by_role("LCB"), team.by_role("RCB")])
        tx, ty = self.rng.uniform(93, 101), self.rng.uniform(27, 41)
        ok = self.rng.random() < 0.33
        self.emit("pass", self.poss, self.carrier, (self.ax, self.ay), (tx, ty), recipient=target.id,
                  outcome="complete" if ok else "incomplete", pressure=0.0, speed_mps=19.0, subtype="cross")
        self.advance(2.0)
        if ok:
            self.carrier, self.ax, self.ay = target, tx, ty
            self.do_shot(team, self.pressure(), header=True)
        else:
            self.lose_pass(team, tx, ty, "cross")

    # ---------- substitutions ----------

    def maybe_substitute(self) -> None:
        """Each side makes up to three substitutions between minutes 58 and 85, at a stoppage."""
        if self.restart is None or self.period != 2:
            return
        for side, team in enumerate(self.teams):
            if team.subs_made >= 3 or not team.bench:
                continue
            due = 3480 + team.subs_made * 420 + (side * 120)
            if self.clock < due or self.rng.random() > 0.35:
                continue
            tired = min((p for p in team.on_pitch if p.role != "GK" and p.id != self.carrier.id),
                        key=lambda p: (p.position != "FW", self.fatigue(p)))
            options = [b for b in team.bench if b.position == tired.position] or \
                      [b for b in team.bench if b.position != "GK"]
            if not options:
                continue
            sub = options[0]
            team.bench.remove(sub)
            sub.role, sub.on_at = tired.role, self.clock
            team.on_pitch[team.on_pitch.index(tired)] = sub
            team.subs_made += 1
            self.emit("substitution", side, tired, recipient=sub.id)


def simulate(league: dict, home: str, away: str, seed: int, match_id: str | None = None) -> list[dict]:
    """Simulate one match. The same seed always gives the same events."""
    mid = match_id or f"m_{home.lower()}_{away.lower()}_{seed}"
    return MatchSimulator(league, home, away, seed, mid).run()
