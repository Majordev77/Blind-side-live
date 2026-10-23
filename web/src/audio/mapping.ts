/**
 * How the pitch maps to sound, as pure functions so they can be tested.
 *
 * Events arrive in the fixed frame (home attacks toward x = 105). The
 * listener's club always attacks toward the right ear, so for an away
 * supporter the pitch is turned round.
 */

import type { AudioMode, Point } from '../match/types'

export const LENGTH = 105
export const WIDTH = 68

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

export interface Orientation {
  /** True when the listener supports the home side, which attacks toward x = 105. */
  listenerIsHome: boolean
}

/** Position along the pitch from the listener's point of view: -1 their own goal, +1 the goal they attack. */
export function along([x]: Point, o: Orientation): number {
  const a = clamp((x / LENGTH) * 2 - 1, -1, 1)
  return o.listenerIsHome ? a : -a
}

/** Position across the pitch: 0 the near touchline, 1 the far touchline, from the listener's side. */
export function across([, y]: Point, o: Orientation): number {
  const v = clamp(y / WIDTH, 0, 1)
  return o.listenerIsHome ? v : 1 - v
}

/** Stereo pan for a position. Speakers mode uses the full width; headphones a little less. */
export function panFor(p: Point, o: Orientation, mode: AudioMode): number {
  if (mode === 'one-ear') return 0
  return along(p, o) * (mode === 'speakers' ? 1 : 0.9)
}

/**
 * Ball tone frequency. In stereo the pitch carries width (one octave,
 * 300 Hz near touchline to 600 Hz far touchline). In one-ear mode there is
 * no panning, so pitch carries length instead: low at the listener's goal,
 * high near the goal they attack.
 */
export function ballFrequency(p: Point, o: Orientation, mode: AudioMode): number {
  if (mode === 'one-ear') return 240 * 2 ** (((along(p, o) + 1) / 2) * 1.4)
  return 300 * 2 ** across(p, o)
}

/** HRTF position in metres around the listener's head: left-right by length, distance by width. */
export function hrtfPosition(p: Point, o: Orientation): { x: number; y: number; z: number } {
  return { x: along(p, o) * 4, y: 0, z: -(0.8 + across(p, o) * 1.4) }
}

/** How close the ball is to either goal, 0 in midfield to 1 on a goal line. Opens the ball tone's filter. */
export function danger(p: Point): number {
  const a = Math.abs((p[0] / LENGTH) * 2 - 1)
  return clamp((a - 0.35) / 0.65, 0, 1)
}

/** Pressure tremolo rate in pulses per second, 2 to 8. */
export function pressureRate(pressure: number): number {
  return 2 + 6 * clamp(pressure, 0, 1)
}
