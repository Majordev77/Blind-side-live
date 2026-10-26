# Blind Side MVP

The agreed scope for the Microsoft Premier League Hackathon entry. Visual version with screen mockups: https://claude.ai/artifact/JRmusQEnRP6USPVDUeWCDR

Deadline: 27 October 2026, 11:59 pm Pacific (07:59 WAT, 28 October). We submit on 26 October. Feature freeze end of 24 October. Primary category: Best Multi-Agent System.

## The three demo moments

1. **Close your eyes.** Twenty seconds of an attack in 3D sound only, ending in a goal; then the same attack with the pitch visible.
2. **Two fans, one moment.** The same high turnover for two listeners: Nigerian Pidgin, essentials, one ear; English, analyst, stereo, following one player. Different words and a different mix.
3. **Watch the verifier say no.** On the agent desk the narrator writes a wrong number, the verifier rejects it against the facts, the retry passes and airs with its event IDs.

## Screens

- **Listener app (phone):** full-screen Start with an ear check; four-step setup (language, club, player, detail level); match screen with a huge score, a live caption, the ear bar and at most five controls; full-time recap.
- **Companion screen (laptop):** 2D pitch with 22 players, lower-third cards, the agent desk log, a sound picture panel, and a two-fans view.

## Scope

**P0, needed to submit**
- Simulator, calibration table, three demo matches, invented league
- State engine, the brief's metrics, moment rules with evidence
- Editor, Narrator and Verifier as an Agent Framework workflow, MCP server, template fallback, rejection log
- Speech in English and Nigerian Pidgin, cached
- Listener app with three sound layers and ducking
- Companion screen with pitch, lower thirds, agent desk and two-fans view
- Full-time recap per profile
- Comprehension test with two or three blind or low-vision testers
- Deployed demo link, README, pitch, video under two minutes

**P1, only after every P0 works end to end**
- Agent evaluation on 50 saved moments, with tracing
- Event Hubs between simulator and engine; Cosmos DB audit log
- End-to-end latency figure

**Cut (solo build; first back in if a teammate joins)**
- Hold to ask (spoken questions); tap to repeat stays
- Third language and analyst charts
- Auto-eventing from video, voice onboarding, load test, hosted agents, haptics

## Microsoft platform: two plans

Azure access is pending because card verification failed.

| Part | Plan A: Azure | Plan B: no Azure subscription |
|---|---|---|
| Agent models | Microsoft Foundry | GitHub Models |
| Orchestration | Microsoft Agent Framework | Microsoft Agent Framework |
| Voice | Azure AI Speech | Microsoft neural voices in the browser, browser voice as fallback |
| Live pipeline | Container Apps, Web PubSub | Agent workflow in GitHub Actions over each demo match; live locally |
| Hosting | Static Web Apps | GitHub Pages |

The code is the same in both: the model client and the transport sit behind interfaces. If Azure is not working by Saturday 24 October at noon WAT, we commit to Plan B and the README says so.

## Five days

| Day | Work | Gate |
|---|---|---|
| Thu 22 | Plan signed off, repo, team agents, Azure attempts, tester messages | Plan agreed |
| Fri 23 | Simulator, calibration, engine, moments; design system; start and match screens; audio engine | A match plays by ear locally |
| Sat 24 | Agent workflow, verifier, templates, speech; live delivery; companion and agent desk | Feature freeze |
| Sun 25 | User test, failure drill, P1 if gates passed, design polish | Results written in docs/ |
| Mon 26 | Video, README, pitch, deploy, submit | Submitted, links checked |
| Tue 27 | Buffer; fix only what a stranger hits | Deadline 23:59 PT |

## Rules we hold to

Synthetic data only: invented clubs, players and matches. No real club names, crests, kits, players, footage, broadcast audio or copyrighted music, in the app, repo or video. Every sound is synthesised in code or is a CC0 recording credited in `web/public/sounds/CREDITS.md`, with a synthesised fallback. No secrets in the repo. No claimed figure we have not measured.
