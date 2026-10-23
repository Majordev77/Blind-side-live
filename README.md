# Blind Side

Blind Side lets a blind or low-vision fan follow a live football match through headphones, on any phone, in their own language. Sound carries position, speech carries meaning: a 3D tone tracks the ball, and a team of AI agents decides what is worth saying, writes it for each listener, and checks every word against the match data.

Built for the Microsoft Premier League Hackathon (October 2026). All clubs, players and matches are synthetic.

> Work in progress. Demo link, video link and results are added as they exist. The plan is in [docs/MVP.md](docs/MVP.md).

## Try it in two minutes

Coming soon.

## How it meets the brief

| Stage | Component |
|---|---|
| Ingest | `simulator/`: a seeded match simulator for an invented league, replayed in real time |
| Interpret | `engine/`: match state, pass and speed metrics, story signals, moment detection with evidence |
| Explain | `agents/`: Editor, Narrator, Verifier and Match guide agents sharing one MCP server |
| Render | Timed, machine-readable sound and speech cues, played on the phone and drawn on the companion screen |
| Personalize | Listener profiles (language, club, player, detail level, one-ear mode) that change the words and the sound mix |

## Repository layout

```
shared/         JSON schemas: event, cue, moment, profile
simulator/      Match generator, calibration and real-time replayer
engine/         State engine, metrics, moments, sound cues
agents/         Editor, narrator, verifier, match guide, MCP server
gateway/        API: connection tokens, match start, cue feed
web/            Listener app and companion screen
data/matches/   Saved synthetic matches
infra/          Infrastructure as code
tests/          Unit and regression tests
docs/           Plan, design, results
```

## Privacy

Blind Side collects no names, emails or other personal data. A listener profile is a random ID stored in the browser.

## Licence

MIT. See [LICENSE](LICENSE).
