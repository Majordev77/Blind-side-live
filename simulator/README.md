# simulator

Generates football-realistic synthetic matches for the invented league in `data/league.json`, and replays them in real time.

## How it works

A possession-chain model. The player on the ball takes one action at a time: a pass, a carry, a shot or a clearance. The choice depends on where the ball is and how much pressure the player is under; the outcome depends on the player's ratings, the distance and the pressure. Failed actions become tackles, interceptions or the ball going out, then a possession change or a restart (throw-in, corner, goal kick, free kick, penalty, kickoff). Players take positions from a 4-3-3 shape that shifts with the ball. Fatigue lowers skill late in the match, substitutions come in from minute 58, and a goal makes the trailing side more direct and more aggressive in its press.

Events follow `shared/event.schema.json`. The home side attacks toward x = 105 in both halves, so left and right never flip at half time. The same seed always produces the same match.

The averages over 200 matches land inside real-football ranges for goals, shots, passes, pass completion and possession: see `docs/results/calibration.md`.

## Commands

Run from the repository root, with the virtual environment's Python (`.venv/Scripts/python` on Windows).

```bash
python -m simulator.build_league                 # rebuild data/league.json (fixed seed)
python -m simulator.generate --home ALD --away CRV --seed 7
python -m simulator.calibrate --matches 200 --write
python -m simulator.pick_demos                   # simulate 500 seeds, keep the 3 most dramatic
python -m simulator.replay data/matches/demo_1.jsonl --pretty --speed 10 --start 74.5
python -m pytest
```

`pick_demos` writes `data/matches/demo_N.jsonl`, `demo_N.match.json` and `demos.json`, including where each match's best three minutes start. The demos are picked by a drama score (lead changes, late goals, equalisers, busy spells), not written by hand.

## Files

- `model.py`: the match simulator
- `build_league.py`: the invented league
- `generate.py`: simulate and save one match
- `calibrate.py`: compare averages with real football
- `pick_demos.py`: choose the demo matches
- `replay.py`: publish a saved match in real time
- `transport.py`: the `publish` / `subscribe` interface and its local versions
- `stats.py`: per-match summary numbers
