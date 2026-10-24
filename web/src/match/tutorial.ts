/**
 * A 20-second guide to the sounds, before kickoff.
 *
 * It plays the real sounds through the real engine, each one named by the
 * caller: a pass travelling from one ear to the other, the crowd building
 * as an attack nears goal, a shot, and a goal. Then it tells the listener
 * about the "Where's the ball?" button. It can be skipped at any moment.
 */

import type { SoundEngine } from '../audio/engine'
import { cancelSpeech, speak, type Lang } from '../audio/speech'
import type { Cue, Point } from './types'

const TEAM = 'YOU'
const OTHER = 'OPP'

const LINES: Record<Lang, string[]> = {
  en: [
    'Before kickoff: twenty seconds to learn the sounds.',
    'This is a pass. Hear the ball travel from your left ear to your right.',
    'Your team always attacks toward your right ear. As an attack gets close to goal, the crowd builds.',
    'A shot.',
    'And a goal!',
    'The commentator names who has the ball and where. Tap Where is the ball at any time. Here we go!',
  ],
  pcm: [
    'Before the match start: make we learn the sounds for twenty seconds.',
    'This one na pass. Hear as the ball dey move from your left ear go your right.',
    'Your team dey always attack go your right ear. When dem near the goal, the crowd go dey shout.',
    'Shot.',
    'Goal!',
    'The commentator go dey tell you who get the ball and where e dey. Press Where the ball dey any time. Make we go!',
  ],
}

function cue(t: number, sound: Cue['sound'], from: Point, to: Point, extra: Partial<Cue> = {}): Cue {
  return { t, clock: t, type: 'sound', sound, event: 'ev_000000', team: TEAM, from, to, ...extra }
}

/** Say a line and wait for it to finish (or a few seconds at most). */
function sayAndWait(text: string, lang: Lang, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve()
    const done = () => {
      clearTimeout(timer)
      resolve()
    }
    const timer = window.setTimeout(done, 1500 + text.split(' ').length * 450)
    signal.addEventListener('abort', done, { once: true })
    if (!speak(text, lang, { onEnd: done }, 'caller', 0.3)) done()
  })
}

const pause = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = window.setTimeout(resolve, ms)
    signal.addEventListener('abort', () => {
      clearTimeout(timer)
      resolve()
    }, { once: true })
  })

/** Run the tutorial. Resolves when it finishes or is skipped. */
export async function runTutorial(engine: SoundEngine, lang: Lang, mode: Parameters<SoundEngine['configure']>[0]['mode'], signal: AbortSignal): Promise<void> {
  const say = LINES[lang]
  engine.configure({ listenerClub: TEAM, homeClub: TEAM, mode })
  engine.start()
  const at = () => engine.now + 0.1
  const play = (c: Cue, delay = 0) => !signal.aborted && engine.play(c, at() + delay)

  await sayAndWait(say[0] as string, lang, signal)
  await sayAndWait(say[1] as string, lang, signal)
  play(cue(0, 'pass', [18, 34], [88, 30], { outcome: 'complete', distance_m: 70, subtype: 'long_ball', duration: 1.6 }))
  await pause(2200, signal)

  await sayAndWait(say[2] as string, lang, signal)
  // a short attack: three passes getting closer to the goal on your right
  const attack: [Point, Point, number][] = [[[55, 30], [72, 40], 0], [[72, 40], [86, 24], 1.2], [[86, 24], [95, 36], 2.4]]
  for (const [a, b, d] of attack) play(cue(0, 'pass', a, b, { outcome: 'complete', distance_m: 18, duration: 0.8 }), d)
  await pause(3600, signal)

  await sayAndWait(say[3] as string, lang, signal)
  play(cue(0, 'shot', [95, 36], [105, 35], { outcome: 'on_target', speed_kmh: 95, xg: 0.5, duration: 0.45 }))
  play(cue(0, 'save', [104, 35], [104, 35], { team: OTHER }), 0.5)
  await pause(2200, signal)

  await sayAndWait(say[4] as string, lang, signal)
  play(cue(0, 'shot', [96, 33], [105, 34], { outcome: 'goal', speed_kmh: 105, xg: 0.6, duration: 0.4 }))
  play(cue(0, 'goal', [105, 34], [105, 34]), 0.45)
  await pause(3200, signal)

  await sayAndWait(say[5] as string, lang, signal)
  if (signal.aborted) cancelSpeech()
  engine.stop()
}
