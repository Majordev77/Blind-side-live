# agents

The commentary agents, on Microsoft Agent Framework. Moments from the state engine go in; checked lines for every listener variant come out, each carrying the event IDs that prove it.

```
moments -> Editor -> Narrator (one call per language, in parallel) -> Verifier -> Publisher
                         ^                                             |
                         +-------- one retry, with the reasons --------+
```

| Agent | Job | Why it is separate |
|---|---|---|
| Editor | Decides what is worth saying and to which detail levels, within a speaking budget (12, 25 or 35 seconds a minute). Goals go straight through by code. Keeps storylines such as "Corran Vale pressing high since minute 60". With a model, chooses between candidates and picks the angle. | Restraint is a different skill from writing |
| Narrator | Writes one line per variant (language x club x detail level), each language written directly, never translated. | One moment becomes many different sentences |
| Verifier | Code checks first: every number in the facts, every name in the facts or the evidence, word limit, language. Then a separate model check per claim. A failed line goes back once; if it fails again or time is up, the template airs. | A writer should not grade its own work |
| Publisher | Publishes each line to its variant's group and records it in the said log. | |

All four read the match through the same tools (`match_tools.py`), which the MCP server (`mcp_server.py`) also serves to any MCP client. Shared state: the storylines, the said log, and the agent log the companion screen shows.

## Models

`BLINDSIDE_MODEL` picks the chat client (`models.py`): `foundry` (Microsoft Foundry on Azure), `foundry-local` (Foundry Local on this machine) or `offline` (no model; the stand-in writer drafts the template and can plant errors with `BLINDSIDE_FAULT_RATE`). Every line records which produced it.

## Commands

```bash
python -m agents.run demo_1                               # best three minutes
python -m agents.run demo_1 --full                        # whole match, with the full-time recap
BLINDSIDE_FAULT_RATE=0.25 python -m agents.run demo_1     # watch the verifier reject planted errors
python -m agents.mcp_server --match demo_1                # the match tools over MCP (stdio)
python -m pytest tests/test_verifier.py tests/test_agents.py
```

Outputs: `data/derived/<match>.commentary.json` (aired lines, stats) and `<match>.agentlog.json` (every agent step). Results: `docs/results/agent-eval.md`.

The Nigerian Pidgin templates in `templates.py` need a native speaker's check.
