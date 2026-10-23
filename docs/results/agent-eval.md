# Agent evaluation

## Run 1: the verifier against planted errors (no model)

No model was available for this run, so the narrator is the offline writer (`agents/models.py`): it drafts the template sentence and, at a 25% rate, deliberately changes one number, the error a language model makes most often. This measures the **verifier and the retry loop**, not the quality of model-written commentary. Each demo match was run in full (`BLINDSIDE_FAULT_RATE=0.25 python -m agents.run demo_N --full`), for 12 listener variants (English and Nigerian Pidgin, either club, three detail levels).

| Match | Assignments | Lines aired | Drafts rejected | Passed first time | Template fallbacks | Aired with a wrong number |
|---|---|---|---|---|---|---|
| demo_1 | 89 | 880 | 186 | 78.9% | 0 | **0** |
| demo_2 | 82 | 836 | 167 | 80.0% | 0 | **0** |
| demo_3 | 79 | 808 | 169 | 79.1% | 0 | **0** |

Every planted error was caught by the code checks, sent back to the narrator once with the reason, and the corrected line aired. No line aired with a number that is not in its moment's facts.

Failure drills (`tests/test_agents.py`): with the model endpoint off, every goal is still announced and every line falls back to its template; with a model too slow for its deadline, templates air within the deadline.

## Run 2: a model writes (to do)

To be run with Microsoft Foundry (or Foundry Local) as the narrator, editor and checker: first-attempt pass rate, rejections by reason, template fallback rate, lines aired with a wrong number, and median and slowest time to a line.
