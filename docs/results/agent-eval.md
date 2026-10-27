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

## Run 2: a real model, and why the demo does not use it

We tried to have a real model write the commentary. It did not produce usable lines in time for the submission. Every failure was caught: the template aired instead, and no line reached the listener with a wrong number.

**GitHub Models (Plan B).** Every request failed. GitHub retired GitHub Models on 30 July 2026, and its endpoint now answers a bare "OK", both from this machine and from GitHub's own Actions runners (raw request checked on both).

**Foundry Local, Qwen2.5-3B-Instruct on a laptop GPU (DirectML), demo 1, best three minutes, 27 October.** The model loaded and answered: about 5.5 tokens a second on short replies and about 2.3 on long ones. The narrator asks for six variants of a line in one JSON reply, which took several minutes per call.

| Attempt | Line deadline | What happened | Lines from the model | Template fallbacks | Aired with a wrong number |
|---|---|---|---|---|---|
| 1 | 120 s | Every narrator reply was late | 0 | 40 of 40 | **0** |
| 2 | 900 s | Replies cut short by the server's default length; English and Pidgin calls at once dropped connections | 0 | 40 of 40 | **0** |
| 3 | 900 s, one request at a time, 1500-token replies | Replies still ended mid-JSON | 0 | 40 of 40 | **0** |

What this shows: the safety net works against a real, struggling model, not only against planted errors. What it does not show: the quality of model-written commentary. A model of this size on a laptop is far too slow for live use; live, the same agents would run on Microsoft Foundry (`BLINDSIDE_MODEL=foundry`), which needs the Azure subscription we could not verify in time. The saved demo commentary is therefore the offline writer's (run 1).
