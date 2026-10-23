/**
 * Schedule by time, not on arrival.
 *
 * The first cue fixes the offset between match time and the audio clock;
 * every later cue plays at its own match time plus that offset plus a small
 * playout buffer. A cue that would play in the past is dropped, so the ball
 * never jumps back after a network hiccup.
 */

export const PLAYOUT_BUFFER = 0.15 // seconds

export class MatchClock {
  private anchorMatch: number | null = null
  private anchorAudio = 0

  constructor(
    private readonly now: () => number,
    public speed = 1,
    public buffer = PLAYOUT_BUFFER,
  ) {}

  /** Fix the mapping so that match time `t` plays `buffer` seconds from now. */
  anchor(t: number): void {
    this.anchorMatch = t
    this.anchorAudio = this.now() + this.buffer
  }

  get anchored(): boolean {
    return this.anchorMatch !== null
  }

  /** Audio-clock time at which match time `t` should play. */
  audioTime(t: number): number {
    if (this.anchorMatch === null) this.anchor(t)
    return this.anchorAudio + (t - (this.anchorMatch as number)) / this.speed
  }

  /** The match time playing right now. */
  matchTime(): number {
    if (this.anchorMatch === null) return 0
    return this.anchorMatch + (this.now() - this.anchorAudio) * this.speed
  }

  /** True if a cue for match time `t` arrived too late to play. */
  isLate(t: number): boolean {
    return this.audioTime(t) < this.now()
  }
}

/**
 * Feeds cues to the sound engine a little ahead of time (the Web Audio
 * look-ahead pattern): each tick schedules every cue due within `lookahead`
 * seconds. Pure over its inputs, so it is easy to test.
 */
export function dueCues<T extends { t: number }>(cues: T[], from: number, clock: MatchClock, lookahead: number): { due: T[]; next: number } {
  const horizon = clock.matchTime() + lookahead * clock.speed
  const due: T[] = []
  let i = from
  while (i < cues.length && (cues[i] as T).t <= horizon) {
    due.push(cues[i] as T)
    i++
  }
  return { due, next: i }
}
