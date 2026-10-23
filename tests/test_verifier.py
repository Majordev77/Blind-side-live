"""The verifier's code checks: the trust layer, so they get the most tests."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from agents.templates import template
from agents.verifier import check_line, name_sets, numbers_in

ROOT = Path(__file__).resolve().parent.parent
LEAGUE = json.loads((ROOT / "data" / "league.json").read_text(encoding="utf-8"))
NAMES = {p["id"]: p["name"] for c in LEAGUE["clubs"] for p in c["players"]}
CLUBS = {c["code"]: c["name"] for c in LEAGUE["clubs"]}

TURNOVER = {
    "type": "high_turnover", "team": "CRV", "minute": 77,
    "facts": {"player": "Kelechi Akande", "team": "CRV", "won_by": "interception", "metres_from_goal": 8,
              "turnovers_in_final_third_last_5min": 3},
}


def check(text: str, lang: str = "en", facts: dict | None = None, evidence: set[str] | None = None, limit: int = 30):
    facts = facts or TURNOVER["facts"]
    allowed, every = name_sets(NAMES, CLUBS, facts, evidence or set(), {"Corran Vale", "Ostbury Town"})
    return check_line(text, facts=facts, minute=77, lang=lang, word_limit=limit, allowed_names=allowed, all_names=every)


def test_a_true_line_passes() -> None:
    assert check("Akande wins it back high up. That is the third time in five minutes.").ok


def test_a_wrong_number_fails() -> None:
    c = check("Akande wins it back again. That is the fourth turnover in five minutes.")
    assert not c.ok and "number 4 is not in the facts" in c.reasons


def test_numbers_in_digits_words_and_ordinals() -> None:
    assert sorted(numbers_in("3 shots, two saves and the fourth corner")) == [2, 3, 4]
    assert numbers_in("early in the second half") == []


def test_a_player_not_in_the_evidence_fails() -> None:
    c = check("Akande wins it back, and Tariq Lunde is caught out.")
    assert not c.ok and any("Tariq Lunde" in r for r in c.reasons)


def test_a_player_in_the_evidence_passes() -> None:
    assert check("Akande wins it back from Tariq Lunde.", evidence={"Tariq Lunde"}).ok


def test_a_club_outside_the_match_fails() -> None:
    c = check("Akande wins it back, like Kestrel Wharf did last week.")
    assert not c.ok and any("Kestrel Wharf" in r for r in c.reasons)


def test_word_limit() -> None:
    c = check("Akande wins it back high up for Corran Vale", limit=5)
    assert not c.ok and any("over the limit" in r for r in c.reasons)


def test_language_checks() -> None:
    assert check("Akande don collect the ball back for their half.", lang="pcm").ok
    assert not check("Akande wins it back high up.", lang="pcm").ok
    assert not check("Akande don collect am again.", lang="en").ok


def test_markup_fails() -> None:
    assert not check("**Akande** wins it back.").ok


@pytest.mark.parametrize("match_id", ["demo_1", "demo_2", "demo_3"])
@pytest.mark.parametrize("lang", ["en", "pcm"])
@pytest.mark.parametrize("level", ["essentials", "full", "analyst"])
def test_every_demo_template_passes_its_own_checks(match_id: str, lang: str, level: str) -> None:
    """The safety net must never be rejected."""
    meta = json.loads((ROOT / "data" / "matches" / f"{match_id}.match.json").read_text(encoding="utf-8"))
    moments = json.loads((ROOT / "data" / "derived" / f"{match_id}.moments.json").read_text(encoding="utf-8"))
    home, away = meta["home"]["code"], meta["away"]["code"]
    for m in moments:
        text = template(m, lang, level, lambda c: CLUBS.get(c, c), home, away, home)
        if not text:
            continue
        allowed, every = name_sets(NAMES, CLUBS, m["facts"], set(), {CLUBS[home], CLUBS[away]})
        c = check_line(text, facts=m["facts"], minute=m["minute"], lang=lang, word_limit=40,
                       allowed_names=allowed, all_names=every)
        assert c.ok, f"{m['type']} {lang}/{level}: {text!r} -> {c.reasons}"
