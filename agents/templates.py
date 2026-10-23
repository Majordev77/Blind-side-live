"""Template lines: the safety net under the narrator.

One plain sentence per moment type and language, built only from the
moment's facts, so a template can never say something the data does not
support. A template airs when the narrator is late, fails verification
twice, or the model is switched off (the failure drill).

The Nigerian Pidgin lines need a native speaker's check before the demo.
"""

from __future__ import annotations

from typing import Callable

Club = Callable[[str], str]


def _n(v: object) -> str:
    """Numbers as a listener hears them: whole numbers without a decimal point."""
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return str(v)


def template(moment: dict, lang: str, level: str, club: Club, home: str, away: str, listener: str) -> str | None:
    """One sentence for a moment in `lang` ("en" or "pcm") at a detail level, or None if nothing safe applies."""
    f = moment["facts"]
    team = club(f["team"]) if isinstance(f.get("team"), str) else ""
    ours = moment.get("team") == listener
    t = moment["type"]
    pcm = lang == "pcm"
    score = (f"{club(home)} {_n(f.get('score_home'))}, {club(away)} {_n(f.get('score_away'))}."
             if "score_home" in f else "")

    if t == "goal":
        if pcm:
            head = f"Goal! {f['scorer']} don score for {team}!" if ours else f"{team} don score. Na {f['scorer']}."
            assist = f" Na {f['assist']} set am up." if level != "essentials" and f.get("assist") else ""
            how = f" From {_n(f['shot_distance_m'])} metres." if level == "analyst" else ""
        else:
            head = f"Goal! {f['scorer']} scores for {team}!" if ours else f"Goal for {team}. {f['scorer']} scores."
            assist = f" Set up by {f['assist']}." if level != "essentials" and f.get("assist") else ""
            how = (f" From {_n(f['shot_distance_m'])} metres, at {_n(f['shot_speed_kmh'])} kilometres an hour."
                   if level == "analyst" else "")
        return f"{head}{assist}{how} {score}"

    if t == "big_chance":
        what = {"on_target": ("saved", "Goalkeeper save am"), "blocked": ("blocked", "Dem block am"),
                "off_target": ("wide", "E no enter")}.get(str(f.get("outcome")), ("missed", "E no enter"))
        if pcm:
            extra = f" That chance na {_n(f['chance_quality_pct'])} percent." if level == "analyst" else ""
            return f"Chance for {f['shooter']}! {what[1]}!{extra}"
        extra = f" That was a {_n(f['chance_quality_pct'])} percent chance." if level == "analyst" else ""
        return f"Big chance for {f['shooter']}, {what[0]}!{extra}"

    if t == "high_turnover":
        n = int(f["turnovers_in_final_third_last_5min"])
        if pcm:
            base = f"{f['player']} don collect the ball back for their half."
            return base if level == "essentials" or n < 3 else f"{base} Na {n} times be this for five minutes."
        base = f"{f['player']} wins it back high up for {team}."
        return base if level == "essentials" or n < 3 else f"{base} That is {n} times in the last five minutes."

    if t == "momentum_swing":
        s, o = _n(f["shots_last_5min"]), _n(f["opponent_shots_last_5min"])
        if pcm:
            return f"{team} dey on top now." if level == "essentials" else \
                f"{team} dey control the game now. Dem get {s} shots, the other side get {o}, for last five minutes."
        return f"{team} on top now." if level == "essentials" else \
            f"{team} have taken control. {s} shots to {o} in the last five minutes."

    if t == "hard_pass":
        if pcm:
            extra = f" Na {_n(f['completion_chance_pct'])} percent pass be that." if level == "analyst" else ""
            return f"Na correct pass be that, from {f['passer']} to {f['receiver']}!{extra}"
        extra = f" Only a {_n(f['completion_chance_pct'])} percent pass." if level == "analyst" else ""
        return f"Superb pass from {f['passer']} to {f['receiver']}.{extra}"

    if t == "long_move":
        n = _n(f["passes_in_move"])
        return f"{team} still dey hold the ball. {n} passes for this move." if pcm else \
            f"{team} keep the ball: {n} passes in this move."

    if t == "press_change":
        up = f.get("direction") == "up"
        if pcm:
            return f"{team} don begin press dem well well." if up else f"{team} don relax small. Pressure no too dey again."
        return f"{team} are pressing much higher now." if up else f"{team} have dropped off. Less pressure on the ball."

    if t == "milestone":
        if f.get("completed_passes"):
            n = _n(f["completed_passes"])
            return f"{f['player']} don complete {n} passes." if pcm else f"{f['player']} has completed {n} passes."
        if f.get("team_shots"):
            n = _n(f["team_shots"])
            return f"That one na shot number {n} for {team}." if pcm else f"That is shot number {n} for {team}."
        if f.get("first_shot_on_target_of_match"):
            return f"First shot on target for this match, na {f['player']}." if pcm else \
                f"The first shot on target of the match, from {f['player']}."
        return None

    if t == "drought":
        n = _n(f["minutes_without_a_shot"])
        return f"E don reach {n} minutes wey {team} never shoot." if pcm else f"{team} have not had a shot for {n} minutes."

    if t == "sprint":
        if level == "essentials":
            return None
        n = _n(f["speed_kmh"])
        return f"{f['player']} dey run like breeze, {n} kilometres per hour!" if pcm else \
            f"{f['player']} flies forward at {n} kilometres an hour."

    return None


def recap_template(facts: dict, lang: str, club: Club, home: str, away: str, listener: str) -> str:
    """A short full-time recap from the recap facts."""
    h, a = _n(facts["score_home"]), _n(facts["score_away"])
    scorers = facts.get("home_scorers" if listener == home else "away_scorers", "")
    ours = club(listener)
    if lang == "pcm":
        line = f"Full time. {club(home)} {h}, {club(away)} {a}."
        if scorers:
            line += f" For {ours}, na {scorers} score."
        return line
    line = f"Full time: {club(home)} {h}, {club(away)} {a}."
    if scorers:
        line += f" For {ours}, the goals came from {scorers}."
    return line
