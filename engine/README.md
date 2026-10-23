# engine

Turns the raw event stream into a live picture of the match. Plain code with no AI in it, so it is fast, testable and trustworthy.

- `state.py`: `MatchState`, updated once per event. Score, clock, possession (and how many passes it has had), rolling team windows, per-player totals, and the four story signals: momentum, control versus chaos, pressing level and tempo.
- `metrics.py`: the brief's metrics. Pass distance, accuracy and a 1 to 5 difficulty rating; ball and shot speed in km/h; shot quality (xG), scaled so total xG matches goals over many matches; sprint and fast-shot thresholds.
- `moments.py`: one rule per kind of moment (goal, big chance, high turnover, hard pass, long move, momentum swing, press change, milestone, drought, sprint). Each moment carries its evidence event IDs and the exact `facts` the narrator may use. Schema: `shared/moment.schema.json`.
- `cues.py`: one sound cue per event, with start, end and duration, so the phone glides the ball itself. Schema: `shared/cue.schema.json`.
- `pipeline.py`: the `Engine` that ties them together, one event at a time.

```bash
python -m engine.pipeline data/matches/demo_1.jsonl   # writes data/derived/demo_1.moments.json and .cues.jsonl
python -m pytest tests/test_engine.py
```
