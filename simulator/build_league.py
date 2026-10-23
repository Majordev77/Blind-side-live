"""Build the invented league in data/league.json.

Four fictional clubs with 18 players each. Names are drawn from fixed pools
with a fixed seed, so the file is reproducible. Surnames of well-known real
footballers are blocked; every name still needs the product manager's check
against real clubs and players before the demo.

Run: python -m simulator.build_league
"""

from __future__ import annotations

import json
import random
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "league.json"

CLUBS = [
    # code, name, directness, press, width, quality
    ("ALD", "Aldmere Rovers", 0.35, 0.70, 0.60, 0.80),
    ("CRV", "Corran Vale", 0.70, 0.45, 0.50, 0.72),
    ("OST", "Ostbury Town", 0.50, 0.55, 0.45, 0.76),
    ("KES", "Kestrel Wharf", 0.62, 0.30, 0.70, 0.70),
]

FIRST = [
    "Dayo", "Linus", "Emeka", "Rowan", "Ifeanyi", "Bram", "Segun", "Callum",
    "Kelechi", "Tunde", "Mateo", "Obinna", "Jonas", "Chidi", "Remi", "Ade",
    "Luca", "Somto", "Kwabena", "Femi", "Nils", "Tobi", "Arlo", "Uche",
    "Idris", "Soren", "Kunle", "Elio", "Nnamdi", "Ruben", "Wale", "Kofi",
    "Matthias", "Ebuka", "Teodor", "Yemi", "Hugo", "Ikenna", "Anders", "Sola",
    "Dario", "Chuka", "Felix", "Lanre", "Oskar", "Bayo", "Tariq", "Jide",
]

LAST = [
    "Fashola", "Varga", "Nwosu", "Castell", "Uzor", "Lindqvist", "Adebanjo",
    "Reyne", "Okoro", "Akande", "Ferrand", "Ibekwe", "Halloran", "Ezenwa",
    "Okwu", "Ogunleye", "Brannick", "Nnadi", "Amadi", "Kessler", "Oduya",
    "Marlow", "Ugwu", "Tessaro", "Olaniyan", "Brekke", "Ilori", "Mbah",
    "Okeke", "Strand", "Anozie", "Delacroix", "Ekwueme", "Rask", "Babatunde",
    "Corvin", "Adewale", "Quist", "Onwuka", "Obiora", "Sandeman", "Ajala",
    "Verhoef", "Chukwu", "Morrow", "Ogbu", "Falk", "Igwe", "Prentiss", "Odum",
    "Haldane", "Adeleke", "Ekpo", "Lunde", "Aniebo", "Carrow", "Oyelaran",
    "Tamsett", "Ezeh", "Vossberg", "Ikpeba", "Dunmore", "Olatunji", "Hesketh",
    "Nwankwo", "Arbery", "Oguike", "Saltire", "Edoho", "Kerrigan", "Abiola",
    "Wendel",
]

# Surnames of well-known real footballers that must never appear.
BLOCKED = {
    "Osimhen", "Iheanacho", "Okocha", "Kanu", "Lookman", "Ndidi", "Iwobi",
    "Chukwueze", "Aribo", "Onuachu", "Awoniyi", "Bassey", "Ighalo", "Yobo",
    "Enyeama", "Eze", "Okafor", "Danjuma", "Adeyemi", "Mikel", "Obi", "Musa",
    "Ronaldo", "Messi", "Salah", "Kane", "Saka", "Haaland", "Rice", "Foden",
}

# 18-man squad: shirt number, position, role in a 4-3-3 starting eleven.
SQUAD = [
    (1, "GK", "GK"), (2, "DF", "RB"), (5, "DF", "RCB"), (4, "DF", "LCB"),
    (3, "DF", "LB"), (6, "MF", "DM"), (8, "MF", "RCM"), (10, "MF", "LCM"),
    (7, "FW", "RW"), (9, "FW", "ST"), (11, "FW", "LW"),
    (13, "GK", "SUB"), (14, "DF", "SUB"), (15, "DF", "SUB"), (16, "MF", "SUB"),
    (18, "MF", "SUB"), (19, "FW", "SUB"), (20, "FW", "SUB"),
]

# Base ratings (passing, pace, finishing) by position, 0 to 100.
BASE = {"GK": (55, 45, 15), "DF": (68, 70, 35), "MF": (80, 68, 55), "FW": (70, 82, 80)}


def build(seed: int = 2026) -> dict:
    """Return the league as a dict ready to write to JSON."""
    rng = random.Random(seed)
    assert not BLOCKED & set(LAST), "a blocked surname is in the pool"
    firsts, lasts = FIRST[:], LAST[:]
    rng.shuffle(firsts)
    rng.shuffle(lasts)
    used: set[str] = set()
    clubs = []
    pid = 100
    for ci, (code, name, directness, press, width, quality) in enumerate(CLUBS):
        players = []
        for shirt, pos, role in SQUAD:
            pid += 1
            while True:
                first = firsts[rng.randrange(len(firsts))]
                last = lasts.pop()
                full = f"{first} {last}"
                if full not in used:
                    used.add(full)
                    break
            spread = (quality - 0.75) * 40
            sub_penalty = -6 if role == "SUB" else 0
            passing, pace, finishing = (
                max(20, min(95, round(b + spread + sub_penalty + rng.gauss(0, 5))))
                for b in BASE[pos]
            )
            players.append({
                "id": f"p_{pid:03d}",
                "name": full,
                "short_name": last,
                "shirt": shirt,
                "position": pos,
                "role": role,
                "passing": passing,
                "pace": pace,
                "finishing": finishing,
            })
        clubs.append({
            "code": code,
            "name": name,
            "formation": "4-3-3",
            "style": {"directness": directness, "press": press, "width": width},
            "players": players,
        })
    return {
        "league": "Blind Side Invented League",
        "note": "All clubs and players are fictional. Any resemblance to real clubs or people is unintended.",
        "clubs": clubs,
    }


if __name__ == "__main__":
    OUT.write_text(json.dumps(build(), indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {OUT}")
