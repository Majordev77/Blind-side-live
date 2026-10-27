# Blind Side

Blind Side lets a blind or low-vision fan follow a football match through headphones, on any phone, in their own language. Sound carries position, speech carries meaning: the ball moves between your ears, the crowd rises as an attack nears goal, and a team of AI agents decides what is worth saying, writes it for each listener, and checks every number against the match data before it is spoken.

Built for the Microsoft Premier League Hackathon (October 2026), entered for **Best Multi-Agent System**. All clubs, players and matches are invented.

- **Live demo:** https://majordev77.github.io/Blind-side-live/ (phone, headphones, Edge or Chrome)
- **Companion screen:** https://majordev77.github.io/Blind-side-live/#companion (laptop)
- **Video:** https://youtu.be/IrY3Gcx--oc (under two minutes; wear headphones)

## Try it in two minutes

1. Open the demo on your phone and put on headphones. Microsoft Edge has the most natural voices.
2. Tap Start. You are dropped into an attack about to end in a goal, supporting the side that scores. Your club always attacks toward your right ear.
3. Close your eyes. Follow the ball by ear, then tap **Where's the ball?** at any moment.
4. Tap **Personalise** to choose English or Nigerian Pidgin, your club and how much description you want.
5. Tap **Skip to full time** (or press F) for the recap.

On a laptop, open the companion screen: the same match on a 2D pitch, every spoken line with the events that prove it, the agent desk with each verifier rejection, and **Two fans, one moment**.

| Key | Action |
|---|---|
| W or B | Where's the ball? |
| R | Repeat the last line |
| D | Change the detail level |
| Space or P | Pause |
| F | Skip to full time |

## How it works

```
simulator ──events──> state engine ──moments + sound cues──> agents ──verified lines──> listener app
 (invented league)    (metrics, story     (with evidence      Editor → Narrator →       (3D sound, two voices,
                       signals, moments)   event IDs)          Verifier → Publisher      ducking, recap)
```

| Stage | Component |
|---|---|
| Ingest | `simulator/`: a seeded match simulator for an invented league, calibrated against typical match figures ([calibration](docs/results/calibration.md)) |
| Interpret | `engine/`: match state, pass difficulty and speed metrics, storylines, and moment detection; every moment carries the event IDs that prove it |
| Explain | `agents/`: Editor, Narrator, Verifier and Publisher as a Microsoft Agent Framework workflow, reading the match through one set of tools also served over MCP |
| Render | `web/`: timed sound cues played on the audio clock, a play-by-play caller and an analyst voice, captions, and vibration on shots and goals |
| Personalise | Language (English, Nigerian Pidgin), club, detail level (essentials, full, analyst) and listening mode (headphones, speakers, one ear) change both the words and the sound mix |

### The agents

| Agent | Job |
|---|---|
| Editor | Decides what is worth saying, within a speaking budget per detail level, and keeps running storylines |
| Narrator | Writes one line per listener variant (language × club × detail level), each language written directly, not translated |
| Verifier | Checks every number and name against the moment's facts, then a separate model check per claim. A failed line goes back once with the reason; if it fails again, or time runs out, a template built only from the facts airs instead |
| Publisher | Airs each line to its listeners and records it with its evidence |

A writer never grades its own work, and a wrong number never reaches the listener. See [agents/README.md](agents/README.md).

## Results

- **Verifier against planted errors:** a stand-in writer put a wrong number into a quarter of first drafts across all three demo matches. The verifier caught every one, the retry fixed it, and no line aired with a number outside its facts ([agent evaluation, run 1](docs/results/agent-eval.md)).
- **Simulator calibration:** goals, shots and other per-match figures over 200 simulated matches fall within typical ranges ([calibration](docs/results/calibration.md)).
- **A real model:** GitHub Models was retired in July 2026, and Qwen2.5-3B on Foundry Local ran on a laptop GPU but was too slow to finish a line. Across three attempts every line fell back to its template and none aired with a wrong number ([agent evaluation, run 2](docs/results/agent-eval.md)). The demo's commentary comes from the offline writer.
- **Listener test:** a blind tester used the app in a remote session on 26 October and found five problems: the commentary was too fast and too busy, the voice too quiet, the match quiet apart from the ball and whistle, passes heard only on the right, and the controls unclear. All five were changed the same day; the changes have not yet been re-tested with a listener ([session guide and results](docs/results/user-test.md)).

## Microsoft technology

- **Microsoft Agent Framework** for the agent workflow (Editor, Narrator, Verifier, Publisher, with a retry loop)
- The model client sits behind one setting, `BLINDSIDE_MODEL`: **Microsoft Foundry** (`foundry`), **Foundry Local** (`foundry-local`) or no model (`offline`). The demo's saved commentary was written by the offline writer, which puts planted errors in front of the verifier; see [Results](#results).
- **MCP** server exposing the match tools the agents use
- **Microsoft neural voices** in Edge for speech
- **GitHub Actions** and **GitHub Pages** for build, tests and hosting

Azure was planned for live delivery (Container Apps, Web PubSub) and Azure AI Speech, but the subscription could not be verified in time, so the demo runs in local mode as set out in Plan B of [docs/MVP.md](docs/MVP.md). The model client and transport sit behind interfaces, so moving to Azure is configuration, not a rewrite.

## Run it locally

```bash
# the listener app and companion screen
cd web
npm install
npm run dev            # http://localhost:5173 (companion: /#companion)

# the pipeline and agents (Python 3.11+)
pip install -e ".[dev]"
python -m agents.run demo_1 --full                          # offline: templates only
BLINDSIDE_MODEL=foundry-local python -m agents.run demo_1   # a Foundry Local model writes
python -m pytest
```

Copy `.env.example` to `.env` for the settings. Everything runs with `BLINDSIDE_MODE=local` and no cloud account.

## Repository layout

```
shared/         JSON schemas: event, cue, moment
simulator/      Match generator, calibration and replayer
engine/         State engine, metrics, moments, sound cues
agents/         Editor, narrator, verifier, publisher, MCP server
web/            Listener app and companion screen
data/           The invented league, demo matches and derived cues, moments and commentary
gateway/, infra/  Placeholders for the Azure deployment (not built)
tests/          Unit and regression tests
docs/           Plan and results
```

## Sounds

Kicks, crowd, goal roars and the whistle are CC0 recordings from Freesound, credited in [web/public/sounds/CREDITS.md](web/public/sounds/CREDITS.md). Everything else is synthesised in the browser, and any missing recording falls back to synthesis.

## Privacy

Blind Side collects no names, emails or other personal data and has no accounts. The only thing it stores, in your browser, is whether you have heard the sound tutorial.

## Licence

MIT. See [LICENSE](LICENSE).
