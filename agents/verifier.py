"""The verifier's first layer: plain code checks that take milliseconds.

A line passes only if every number in it appears in the moment's facts,
every player or club it names is in the facts or the evidence events, it
fits the word limit, and it is in the right language. The model check (a
separate agent) runs only on lines that pass these.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

NUMBER_WORDS = {
    "zero": 0, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8,
    "nine": 9, "ten": 10, "eleven": 11, "twelve": 12, "thirteen": 13, "fourteen": 14, "fifteen": 15,
    "sixteen": 16, "seventeen": 17, "eighteen": 18, "nineteen": 19, "twenty": 20, "thirty": 30,
    "first": 1, "second": 2, "third": 3, "fourth": 4, "fifth": 5, "sixth": 6, "seventh": 7, "eighth": 8,
    "ninth": 9, "tenth": 10, "once": 1, "twice": 2,
}
# Words that mark a line as Nigerian Pidgin rather than English.
PIDGIN_MARKERS = {"don", "dey", "na", "wey", "dem", "una", "abeg", "sef", "oya", "wahala", "e no", "no be", "make", "am"}
# Phrases that are context, not claims: "in the last five minutes" is the window every fact uses.
WINDOW_PHRASES = [r"\bfor last five minutes\b", r"\blast five minutes\b", r"\bfor five minutes\b", r"\bin five minutes\b"]
WINDOW_NUMBERS = {5}


@dataclass
class Check:
    """Result of the code checks for one line."""

    ok: bool
    reasons: list[str] = field(default_factory=list)


def numbers_in(text: str) -> list[float]:
    """Every number a listener would hear: digits, number words and ordinals."""
    low = text.lower()
    found = [float(n) for n in re.findall(r"\d+(?:\.\d+)?", low)]
    for word, value in NUMBER_WORDS.items():
        if re.search(rf"\b{word}\b", low):
            # "second half" and "one-two" are football words, not claims.
            if word == "second" and re.search(r"\bsecond half\b", low):
                continue
            if word == "one" and re.search(r"\b(one-two|this one|that one|one more)\b", low):
                continue
            found.append(float(value))
    return found


def allowed_numbers(facts: dict, minute: int | None = None) -> set[float]:
    """Numbers a line may state: the facts (and their roundings), the minute and the score."""
    out: set[float] = set()
    for k, v in facts.items():
        if isinstance(v, bool):
            if v and k.startswith("first"):
                out.add(1.0)  # "the first shot on target" states the fact first_shot_on_target_of_match
            continue
        if isinstance(v, (int, float)):
            out |= {float(v), float(round(v)), float(int(v))}
    if minute is not None:
        out.add(float(minute))
    return out


def check_line(text: str, *, facts: dict, minute: int | None, lang: str, word_limit: int,
               allowed_names: set[str], all_names: set[str]) -> Check:
    """Run every code check on one line."""
    reasons: list[str] = []
    stripped = text.strip()
    if not stripped:
        return Check(False, ["empty line"])

    windowless = stripped
    for p in WINDOW_PHRASES:
        windowless = re.sub(p, " ", windowless, flags=re.IGNORECASE)
    allowed = allowed_numbers(facts, minute)
    for n in numbers_in(windowless):
        if n not in allowed:
            shown = int(n) if n.is_integer() else n
            reasons.append(f"number {shown} is not in the facts")

    low = stripped.lower()
    allowed_low = {a.lower() for a in allowed_names}
    for name in sorted(all_names, key=len, reverse=True):
        if re.search(rf"\b{re.escape(name.lower())}\b", low):
            if not any(name.lower() == a or name.lower() in a.split() or name.lower() in a for a in allowed_low):
                reasons.append(f"{name} is not in the facts or the evidence")
            low = low.replace(name.lower(), " ")

    words = len(re.findall(r"\b[\w'-]+\b", stripped))
    if words > word_limit:
        reasons.append(f"{words} words is over the limit of {word_limit}")

    tokens = set(re.findall(r"\b[\w']+\b", stripped.lower()))
    pidgin = any((m in tokens) if " " not in m else (m in stripped.lower()) for m in PIDGIN_MARKERS)
    if lang == "pcm" and not pidgin:
        reasons.append("not in Nigerian Pidgin")
    if lang == "en" and len(tokens & {"don", "dey", "wey", "una", "abeg", "dem"}) >= 1:
        reasons.append("not in English")

    if re.search(r"[*#`{}<>]|\bas an ai\b", stripped, flags=re.IGNORECASE):
        reasons.append("contains markup or meta text")
    return Check(not reasons, reasons)


def name_sets(names: dict[str, str], clubs: dict[str, str], facts: dict, evidence_players: set[str],
              match_clubs: set[str]) -> tuple[set[str], set[str]]:
    """(names this line may use, every name we should look for).

    Allowed: strings in the facts, players in the evidence events, and the
    two clubs in the match. Looked for: every player's full name and surname
    and every club in the league, so a line naming anyone else fails.
    """
    allowed = {v for v in facts.values() if isinstance(v, str)} | evidence_players | match_clubs
    for full in list(allowed):
        parts = full.split()
        if len(parts) > 1:
            allowed.add(parts[-1])
    every: set[str] = set(clubs.values())
    for full in names.values():
        every.add(full)
        every.add(full.split()[-1])
    return allowed, every
