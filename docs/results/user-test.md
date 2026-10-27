# Comprehension test with blind and low-vision listeners

A 30-minute session per tester, run in person or on a call. It checks the one claim Blind Side rests on: that a blind or low-vision fan can follow a match by ear. Record what happened, including what went wrong. Only what is written here may be quoted in the README, pitch or video.

## Before the session

- Phone with the demo link open in Edge or Chrome, headphones (stereo), volume checked. A screen reader on, if the tester uses one.
- You check answers on the phone screen: the score, the caption and the ear bar (the dot shows where the ball is between the goals).
- Ask for consent to take notes and to quote them without a name ("Tester A, totally blind, uses TalkBack"). No names, photos or recordings of the tester unless they say yes to each.

## The session

Read the prompts as written. Do not explain the sounds before task 2.

| # | Task | Prompt | What to note |
|---|---|---|---|
| 1 | Start alone | "Open the app and start a match. I'll only help if you're stuck." | Time to sound, any help needed, screen reader problems |
| 2 | Learn the sounds | Let the tutorial play (or skip it if they want). | Did they skip? Was anything unclear? |
| 3 | Follow by ear | Play 60 seconds. Pause (Space or Pause). "Which side has the ball, and roughly where on the pitch?" | Answer vs the phone screen (ear bar, caption) |
| 4 | Catch a goal | Keep playing until the next goal. "What just happened? Who scored? What's the score?" | Right or wrong on each |
| 5 | Ask for help | "Find out where the ball is right now." | Did they find "Where's the ball?" without help? |
| 6 | More or less talk | "Change how much the commentator says." | Did they find the detail button? Which level did they keep? |
| 7 | Their language | If they speak Pidgin: Personalise, pick Nigerian Pidgin, play 60 seconds. | Natural? Any wrong words? |
| 8 | Full time | Tap "Skip to full time" (or press F) to jump to full time and let the recap play. "Tell me how the match went." | What they remember |

## Questions at the end

1. On a scale of 1 to 5, how well could you follow the match? Why?
2. What sound told you the most? What was confusing or annoying?
3. Was there too much talk, too little, or about right?
4. Would you use this for a real match? What would stop you?
5. One thing to change first.

## Results

Fill in one block per tester.

### Tester A (26 October 2026, remote session)

- Problems found:
  1. Could not keep up with the commentator: too many calls, too fast.
  2. The voice was not loud enough.
  3. The match was quiet apart from the whistle and the ball.
  4. Heard passes only in the right ear.
  5. Did not know how to use the app.
- What we changed (commit 0482dc0):
  1. The caller now speaks at most every 6 seconds on Essentials, 4 on Full and 2.5 on Analyst (it was every 1.4 seconds), and speech is back to normal speed. Setup now asks how fast the commentator should speak.
  2. and 3. The recorded kicks and whistle are much quieter, the crowd is louder, and the match dips under both voices except on shots, saves and goals.
  4. In the opening demo the listener's side is attacking, so the ball really is mostly on the right. The tutorial now also plays a pass back toward the left and explains it.
  5. The tutorial now ends by describing the "Where's the ball?" button and the four controls below it.
- To fill in: sight and screen reader, phone and browser, task results, follow score, quotes (with consent).

## Summary

To be written after the sessions: how many testers, how many of the comprehension questions (tasks 3, 4 and 8) they got right, the main problems, and what was fixed.
