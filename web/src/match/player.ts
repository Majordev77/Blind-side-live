/**
 * Plays one match: feeds sound cues to the engine on the audio clock and
 * voices commentary lines, with the priority rules from the build guide:
 * a class 1 line replaces whatever is speaking, class 2 waits for the
 * current line, class 3 is dropped if anything is speaking, and no line
 * starts after its expiry.
 */

import { dueCues, MatchClock } from '../audio/clock'
import type { SoundEngine } from '../audio/engine'
import { cancelSpeech, speak, type Lang } from '../audio/speech'
import { pickLines, type Fixture, type Line } from './commentary'
import type { AudioMode, Cue, Detail, MatchData, Point } from './types'

const LOOKAHEAD = 2.0 // seconds of cues handed to the engine ahead of time
const TICK_MS = 100

export interface PlayerSettings {
  listener: string
  mode: AudioMode
  detail: Detail
  follow: string | null
  lang: Lang
}

export interface Snapshot {
  clock: number
  score: Record<string, number>
  ball: Point
  team: string | undefined
  caption: Line | null
  speaking: boolean
  paused: boolean
  ended: boolean
}

export class MatchPlayer {
  private clock: MatchClock
  private next = 0
  private lines: Line[] = []
  private lineIdx = 0
  private waiting: Line | null = null
  private current: Line | null = null
  private lastSpoken: Line | null = null
  private timer: number | null = null
  private paused = false
  private ended = false
  private speakingNow = false
  private startT = 0
  readonly fixture: Fixture

  onCaption: ((line: Line) => void) | null = null

  constructor(
    private readonly engine: SoundEngine,
    private readonly data: MatchData,
    private settings: PlayerSettings,
    clubName: (code: string) => string,
  ) {
    this.clock = new MatchClock(() => engine.now)
    this.fixture = { club: clubName, home: data.info.home, away: data.info.away, listener: settings.listener }
    this.relines()
  }

  /** Start playing from match time `fromT` (seconds of play), after a spoken orientation line. */
  start(fromT: number, intro?: string): void {
    this.startT = fromT
    this.next = this.data.cues.findIndex((c) => c.t >= fromT)
    if (this.next < 0) this.next = this.data.cues.length
    this.lineIdx = this.lines.findIndex((l) => l.t >= fromT)
    if (this.lineIdx < 0) this.lineIdx = this.lines.length
    this.engine.configure({
      listenerClub: this.settings.listener,
      homeClub: this.data.info.home,
      mode: this.settings.mode,
      follow: this.settings.follow,
      pressureLayer: this.settings.detail !== 'essentials',
    })
    const lead = intro ? 4.5 : 0.5
    this.clock.anchor(fromT - lead)
    this.engine.start()
    if (intro) this.say({ id: 'intro', t: fromT - lead, expires: fromT + 5, priority: 1, text: intro, evidence: [], moment: null })
    this.timer = window.setInterval(() => this.tick(), TICK_MS)
    this.tick()
  }

  destroy(): void {
    if (this.timer !== null) window.clearInterval(this.timer)
    this.timer = null
    cancelSpeech()
    this.engine.stop()
  }

  async togglePause(): Promise<void> {
    if (this.paused) {
      await this.engine.ctx.resume()
      this.paused = false
    } else {
      cancelSpeech()
      await this.engine.ctx.suspend()
      this.paused = true
    }
  }

  /** Say the last line again. */
  repeat(): void {
    const line = this.lastSpoken
    if (!line) return
    this.say({ ...line, expires: this.clock.matchTime() + 10, priority: 1 })
  }

  setDetail(detail: Detail): void {
    this.settings = { ...this.settings, detail }
    this.relines()
    const now = this.clock.matchTime()
    this.lineIdx = this.lines.findIndex((l) => l.t >= now)
    if (this.lineIdx < 0) this.lineIdx = this.lines.length
    this.engine.configure({
      listenerClub: this.settings.listener,
      homeClub: this.data.info.home,
      mode: this.settings.mode,
      follow: this.settings.follow,
      pressureLayer: detail !== 'essentials',
    })
  }

  get detail(): Detail {
    return this.settings.detail
  }

  snapshot(): Snapshot {
    const t = this.clock.matchTime()
    const cue = this.cueAt(t)
    return {
      clock: cue ? cue.clock + Math.max(0, t - cue.t) : 0,
      score: this.scoreAt(t),
      ball: cue ? ballAt(cue, t) : [52.5, 34],
      team: this.teamAt(t),
      caption: this.current ?? this.lastSpoken,
      speaking: this.speakingNow,
      paused: this.paused,
      ended: this.ended,
    }
  }

  // ---------------------------------------------------------------- internals

  private relines(): void {
    this.lines = pickLines(this.data.moments, this.settings.detail, this.fixture)
  }

  private tick(): void {
    if (this.paused) return
    const { due, next } = dueCues(this.data.cues, this.next, this.clock, LOOKAHEAD)
    for (const cue of due) {
      if (!this.clock.isLate(cue.t)) this.engine.play(cue, this.clock.audioTime(cue.t))
    }
    this.next = next
    const now = this.clock.matchTime()
    while (this.lineIdx < this.lines.length && (this.lines[this.lineIdx] as Line).t <= now) {
      this.offer(this.lines[this.lineIdx] as Line, now)
      this.lineIdx++
    }
    if (this.waiting && !this.speakingNow) {
      const w = this.waiting
      this.waiting = null
      if (now <= w.expires) this.say(w)
    }
    const last = this.data.cues[this.data.cues.length - 1]
    if (!this.ended && last && now > last.t + 3) {
      this.ended = true
      this.engine.stop()
    }
  }

  private offer(line: Line, now: number): void {
    if (now > line.expires) return
    if (!this.speakingNow) return this.say(line)
    if (line.priority === 1) return this.say(line)
    if (line.priority === 2) {
      if (!this.waiting || this.waiting.priority > 2) this.waiting = line
      return
    }
    // class 3: dropped while anything is speaking
  }

  private say(line: Line): void {
    if (this.speakingNow) cancelSpeech()
    this.current = line
    this.lastSpoken = line
    this.onCaption?.(line)
    this.speakingNow = true
    this.engine.setDuck(true)
    const ok = speak(line.text, this.settings.lang, {
      onEnd: () => {
        if (this.current !== line) return
        this.speakingNow = false
        this.current = null
        this.engine.setDuck(false)
      },
    })
    if (!ok) {
      // No voice available: the caption still shows, and the sound comes back up.
      this.speakingNow = false
      this.current = null
      this.engine.setDuck(false)
    }
  }

  private cueAt(t: number): Cue | undefined {
    const cues = this.data.cues
    let lo = 0
    let hi = cues.length - 1
    let ans = -1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if ((cues[mid] as Cue).t <= t) {
        ans = mid
        lo = mid + 1
      } else hi = mid - 1
    }
    for (let i = ans; i >= 0; i--) {
      const c = cues[i] as Cue
      if (c.from) return c
    }
    return cues[0]
  }

  private scoreAt(t: number): Record<string, number> {
    let score: Record<string, number> = { [this.data.info.home]: 0, [this.data.info.away]: 0 }
    for (const c of this.data.cues) {
      if (c.t > t) break
      if (c.sound === 'goal' && c.score) score = c.score
    }
    return score
  }

  private teamAt(t: number): string | undefined {
    const c = this.cueAt(t)
    return c?.team
  }

  get startedAt(): number {
    return this.startT
  }
}

/** Where the ball is at match time t, gliding from the cue's start to its end. */
export function ballAt(cue: Cue, t: number): Point {
  if (!cue.from || !cue.to) return [52.5, 34]
  const d = cue.duration ?? 0
  const k = d > 0 ? Math.min(1, Math.max(0, (t - cue.t) / d)) : 1
  return [cue.from[0] + (cue.to[0] - cue.from[0]) * k, cue.from[1] + (cue.to[1] - cue.from[1]) * k]
}
