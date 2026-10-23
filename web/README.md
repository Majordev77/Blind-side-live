# web

The listener app: React, TypeScript and the browser's Web Audio API. Every sound is synthesised in code; there are no audio files.

## Run it

```bash
cd web
npm install
npm run dev      # http://localhost:5173
npm test         # unit tests (vitest)
npm run build    # production build in web/dist
```

Put on headphones, tap anywhere, then choose a match, your club, how you are listening and how much description you want. Each match starts 20 seconds before its best three minutes.

## How it works

- `src/audio/engine.ts`: the sound engine. A continuous ball tone moves between the ears (HRTF on headphones, a wider stereo pan on speakers, pitch only in one-ear mode). Its pitch follows the width of the pitch, its timbre who has the ball (warm for your club, hollow for the opponent), a tremolo quickens under pressure, and its filter opens near either goal. Short sounds mark passes, crosses, tackles, shots, saves, goals, the ball going out and the whistle, over a quiet crowd bed. Everything ducks under the voice.
- `src/audio/mapping.ts`: how the pitch maps to sound. Your club always attacks toward your right ear.
- `src/audio/clock.ts`: cues are scheduled by match time on the audio clock, with a 150 ms playout buffer; late cues are dropped.
- `src/match/player.ts`: feeds cues to the engine ahead of time and voices commentary by priority (goals interrupt, others wait or are dropped, nothing plays after its expiry).
- `src/match/commentary.ts`: template lines built only from each moment's facts, with a speaking budget per detail level. They are the safety net under the agents, which write the verified lines.
- `src/design/tokens.css`: the design tokens (designer).

In local mode the app reads the demo matches from `data/` at the repository root. Azure mode will stream the same cue format.
