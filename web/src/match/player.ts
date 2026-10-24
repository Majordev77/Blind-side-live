/**
 * Plays one match: feeds the sound cues to the engine on the audio clock, and
 * directs two voices like a broadcast.
 *
 * The caller (play-by-play) names the player on the ball and where they are,
 * and calls shots, saves and goals the instant they happen. The analyst
 * (the agents' verified lines, or the templates when there are none) explains
 * why a moment matters, in the lulls.
 *
 * Rules:
 * - shots, saves and goals interrupt anything;
 * - a name call is spoken only while it is fresh, or dropped;
 * - the goal build-up and the analyst wait for silence, and expire;
 * - the match ducks under the analyst, not under the caller, so the roar
 *   for a goal is never pushed down.
 */

import { dueCues, MatchClock } from '../audio/clock'
import type { SoundEngine } from '../audio/engine'
import { cancelSpeech, speak, type Lang, type Role } from '../audio/speech'
import { pickLines, type Fixture } from './commentary'
import type { AgentLine } from './data'
import { buildCalls, zoneOf, zoneText, type Call, type Names } from './playbyplay'
import type { AudioMode, Cue, Detail, MatchData, Point } from './types'

const LOOKAHEAD = 2.0
const TICK_MS = 50

export interface PlayerSettings {
  listener: string
  mode: AudioMode
  detail: Detail
  follow: string | null
  lang: Lang
}

/** Something one of the two voices may say. */
export interface Spoken {
  id: string
  t: number
  expires: number
  role: Role
  /** big interrupts; call is spoken if fresh; wait waits for silence. */
  rank: 'big' | 'call' | 'wait'
  text: string
  evidence: string[]
  /** The team the line is about, for the caption colour. */
  team?: string | null
  source: 'caller' | 'agents' | 'template'
  energy?: number
}

export interface Snapshot {
  clock: number
  score: Record<string, number>
  ball: Point
  team: string | undefined
  caption: Spoken | null
  speaking: boolean
  paused: boolean
  ended: boolean
}

export class MatchPlayer {
  private clock: MatchClock
  private next = 0
  private queue: Spoken[] = []
  private qi = 0
  private waiting: Spoken[] = []
  private current: Spoken | null = null
  private lastSpoken: Spoken | null = null
  private timer: number | null = null
  private paused = false
  private ended = false
  readonly fixture: Fixture

  onCaption: ((line: Spoken) => void) | null = null

  constructor(
    private readonly engine: SoundEngine,
    private readonly data: MatchData,
    private settings: PlayerSettings,
    private readonly names: Names,
    private readonly agentLines: AgentLine[] | null,
  ) {
    this.clock = new MatchClock(() => engine.now)
    this.fixture = { club: names.club, home: data.info.home, away: data.info.away, listener: settings.listener }
    this.build()
  }

  /** Start playing from match time `fromT`, after a spoken orientation line. */
  start(fromT: number, intro?: string): void {
    this.next = Math.max(0, this.data.cues.findIndex((c) => c.t >= fromT))
    this.qi = this.queue.findIndex((s) => s.t >= fromT)
    if (this.qi < 0) this.qi = this.queue.length
    this.configureEngine()
    const lead = intro ? 5.5 : 0.5
    this.clock.anchor(fromT - lead)
    this.engine.start()
    if (intro) this.say({ id: 'intro', t: fromT - lead, expires: fromT + 5, role: 'analyst', rank: 'big', text: intro, evidence: [], source: 'caller' })
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
      this.current = null
      await this.engine.ctx.suspend()
      this.paused = true
    }
  }

  /**
   * "Where's the ball?": who has it, where, for which club, the minute and the
   * score, from the match as it stands this instant. Spoken at once.
   */
  whereIsBall(): string {
    const t = this.clock.matchTime()
    const cue = this.cueAt(t)
    const lang = this.settings.lang
    const { home, away } = this.data.info
    const score = this.scoreAt(t)
    const h = score[home] ?? 0
    const a = score[away] ?? 0
    const short = (code: string) => this.names.club(code).split(' ')[0] ?? code
    const leader = h === a ? null : h > a ? home : away
    const scoreText = lang === 'pcm'
      ? leader ? `${short(leader)} dey lead, ${Math.max(h, a)} ${Math.min(h, a)}.` : `Na draw, ${h} ${a}.`
      : leader ? `${short(leader)} lead ${Math.max(h, a)} ${Math.min(h, a)}.` : `It's level at ${h} each.`
    const minute = cue ? Math.floor((cue.clock + Math.max(0, t - cue.t)) / 60) + 1 : 1
    let text: string
    if (!cue || !cue.team || !cue.from) {
      text = lang === 'pcm' ? `Minute ${minute}. ${scoreText}` : `Minute ${minute}. ${scoreText}`
    } else {
      // the player on the ball: the receiver once a completed pass arrives, otherwise whoever played it
      const arrived = cue.sound === 'pass' && cue.outcome === 'complete' && cue.recipient && t >= cue.t + (cue.duration ?? 0)
      const holder = (arrived ? cue.recipient : cue.player) ?? ''
      const where = zoneText(zoneOf(ballAt(cue, t), cue.team, home), lang)
      const who = this.names.player(holder)
      const club = this.names.club(cue.team)
      text = lang === 'pcm'
        ? `Na ${who} get the ball, ${where}, for ${club}. Minute ${minute}. ${scoreText}`
        : `${who} has the ball, ${where}, for ${club}. Minute ${minute}. ${scoreText}`
    }
    this.say({ id: 'where', t, expires: t + 10, role: 'caller', rank: 'big', text, evidence: cue ? [cue.event] : [], source: 'caller' })
    return text
  }

  /** Say the last line again. */
  repeat(): void {
    const line = this.lastSpoken
    if (line) this.say({ ...line, expires: this.clock.matchTime() + 10 })
  }

  setDetail(detail: Detail): void {
    this.settings = { ...this.settings, detail }
    const now = this.clock.matchTime()
    this.build()
    this.qi = this.queue.findIndex((s) => s.t >= now)
    if (this.qi < 0) this.qi = this.queue.length
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
      team: cue?.team,
      caption: this.current ?? this.lastSpoken,
      speaking: this.current !== null,
      paused: this.paused,
      ended: this.ended,
    }
  }

  // ---------------------------------------------------------------- internals

  private configureEngine(): void {
    this.engine.configure({
      listenerClub: this.settings.listener,
      homeClub: this.data.info.home,
      mode: this.settings.mode,
      follow: this.settings.follow,
    })
  }

  /** Merge the caller's calls and the analyst's lines into one time-ordered queue. */
  private build(): void {
    const { lang, detail, listener } = this.settings
    const calls: Spoken[] = buildCalls(this.data.cues, this.names, lang).map((c: Call, i) => ({
      id: `call_${i}`,
      t: c.t,
      expires: c.expires,
      role: c.kind === 'buildup' ? 'analyst' : 'caller',
      rank: c.kind === 'big' ? 'big' : c.kind === 'buildup' ? 'wait' : 'call',
      text: c.text,
      evidence: c.evidence,
      source: 'caller',
      energy: c.energy ?? 0,
    }))
    // Analyst lines: the agents' verified lines for this listener's variant when they exist, else templates.
    // Goals are left to the caller, who calls them at once and then gives the build-up.
    const variant = `${lang}:${listener}:${detail}`
    let analyst: Spoken[]
    const fromAgents = this.agentLines?.filter((l) => l.variant === variant && l.type !== 'goal') ?? []
    if (fromAgents.length) {
      analyst = fromAgents.map((l) => ({
        id: `${l.moment_id}:${variant}`, t: l.t + 1.2, expires: l.expires_t + 2, role: 'analyst', rank: 'wait',
        text: l.text, evidence: l.evidence, source: 'agents',
      }))
    } else {
      analyst = pickLines(this.data.moments, detail, this.fixture)
        .filter((l) => l.moment?.type !== 'goal')
        .map((l) => ({ id: l.id, t: l.t + 1.2, expires: l.expires + 2, role: 'analyst' as Role, rank: 'wait' as const,
          text: l.text, evidence: l.evidence, team: l.moment?.team ?? null, source: 'template' as const }))
    }
    this.queue = [...calls, ...analyst].sort((a, b) => a.t - b.t)
  }

  private tick(): void {
    if (this.paused) return
    const { due, next } = dueCues(this.data.cues, this.next, this.clock, LOOKAHEAD)
    for (const cue of due) if (!this.clock.isLate(cue.t)) this.engine.play(cue, this.clock.audioTime(cue.t))
    this.next = next

    const now = this.clock.matchTime()
    while (this.qi < this.queue.length && (this.queue[this.qi] as Spoken).t <= now) {
      const s = this.queue[this.qi] as Spoken
      this.qi++
      if (now > s.expires) continue
      if (s.rank === 'big') this.say(s)
      else if (s.rank === 'call') {
        if (!this.current) this.say(s)
      } else this.waiting.push(s)
    }
    if (!this.current) {
      this.waiting = this.waiting.filter((w) => now <= w.expires)
      // the build-up first, then the oldest analyst line
      this.waiting.sort((a, b) => Number(b.source === 'caller') - Number(a.source === 'caller') || a.t - b.t)
      const w = this.waiting.shift()
      if (w) this.say(w)
    }

    const last = this.data.cues[this.data.cues.length - 1]
    if (!this.ended && last && now > last.t + 4) {
      this.ended = true
      this.engine.stop()
    }
  }

  private say(s: Spoken): void {
    if (this.current) cancelSpeech()
    this.current = s
    this.lastSpoken = s
    this.onCaption?.(s)
    const analyst = s.role === 'analyst'
    if (analyst) this.engine.setDuck(true)
    const done = () => {
      if (this.current !== s) return
      this.current = null
      if (analyst) this.engine.setDuck(false)
    }
    if (s.rank === 'big') buzz(s.text.startsWith('GOAL') ? [250, 80, 250, 80, 500] : [60])
    if (!speak(s.text, this.settings.lang, { onEnd: done }, s.role, s.energy ?? 0)) done()
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
}

/** Vibrate the phone for shots and goals, where the device allows it. */
function buzz(pattern: number[]): void {
  try {
    navigator.vibrate?.(pattern)
  } catch {
    // not supported here
  }
}

/** Where the ball is at match time t, gliding from the cue's start to its end. */
export function ballAt(cue: Cue, t: number): Point {
  if (!cue.from || !cue.to) return [52.5, 34]
  const d = cue.duration ?? 0
  const k = d > 0 ? Math.min(1, Math.max(0, (t - cue.t) / d)) : 1
  return [cue.from[0] + (cue.to[0] - cue.from[0]) * k, cue.from[1] + (cue.to[1] - cue.from[1]) * k]
}
