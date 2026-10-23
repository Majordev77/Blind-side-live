/**
 * Blind Side sound engine.
 *
 * Sound carries position. A continuous tone tracks the ball: it moves
 * between the ears along the pitch (HRTF on headphones, a hard stereo pan on
 * speakers), its pitch follows the width of the pitch, its timbre says who
 * has the ball (warm for the listener's club, hollow for the opponent), a
 * tremolo quickens under pressure, and its filter opens near either goal.
 * Short synthesised sounds mark passes, tackles, shots, saves, goals, the
 * ball going out and the whistle, over a quiet crowd bed. Everything ducks
 * while the voice speaks. No audio files: every sound is made here.
 *
 * Graph:
 *   ball tone -> level -> [HRTF panner -> hrtfMix | StereoPanner -> flatMix] -> duck
 *   event sounds -> StereoPanner -> duck          crowd bed -> duck
 *   duck -> master -> compressor -> destination
 *
 * Cues are scheduled at an audio-clock time chosen by the caller (see clock.ts).
 */

import type { AudioMode, Cue, Point } from '../match/types'
import { makeBrownNoise, makeWhiteNoise } from './buffers'
import { ballFrequency, danger, hrtfPosition, panFor, pressureRate, type Orientation } from './mapping'

const MASTER_LEVEL = 0.85
const BALL_LEVEL = 0.14
const BED_LEVEL = 0.05
const DUCK_LEVEL = 0.3

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

export interface EngineSettings {
  listenerClub: string
  homeClub: string
  mode: AudioMode
  /** Player whose touches get a personal chime. */
  follow?: string | null
  /** The pressure tremolo on the ball tone. */
  pressureLayer: boolean
}

interface Ball {
  freqs: AudioParam[]
  warm: GainNode
  hollow: GainNode
  tremoloRate: AudioParam
  tremoloDepth: AudioParam
  filter: BiquadFilterNode
  level: GainNode
  panner: PannerNode
  pan: StereoPannerNode
  stops: AudioScheduledSourceNode[]
}

export class SoundEngine {
  readonly ctx: AudioContext
  private readonly master: GainNode
  private readonly duck: GainNode
  private readonly hrtfMix: GainNode
  private readonly flatMix: GainNode
  private readonly white: AudioBuffer
  private brown: AudioBuffer | null = null
  private ball: Ball | null = null
  private bed: { level: GainNode; src: AudioBufferSourceNode } | null = null
  private settings: EngineSettings = { listenerClub: '', homeClub: '', mode: 'headphones', pressureLayer: true }
  private lastTeam: string | undefined
  private lastPos: Point = [52.5, 34]
  private live = new Set<AudioScheduledSourceNode>()

  /** Create inside the user's tap: browsers only allow sound that starts from a gesture. */
  constructor() {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    this.ctx = new Ctor()
    const ctx = this.ctx
    const compressor = ctx.createDynamicsCompressor()
    compressor.threshold.value = -14
    compressor.knee.value = 6
    compressor.ratio.value = 6
    compressor.attack.value = 0.003
    compressor.release.value = 0.25
    compressor.connect(ctx.destination)
    this.master = this.gain(MASTER_LEVEL)
    this.master.connect(compressor)
    this.duck = this.gain(1)
    this.duck.connect(this.master)
    this.hrtfMix = this.gain(1)
    this.flatMix = this.gain(0)
    this.hrtfMix.connect(this.duck)
    this.flatMix.connect(this.duck)
    this.white = makeWhiteNoise(ctx, 2)
  }

  /** Resume the context (and play one silent sample for iOS). Rejects if sound cannot start. */
  async unlock(): Promise<void> {
    const ctx = this.ctx
    try {
      const s = ctx.createBufferSource()
      s.buffer = ctx.createBuffer(1, 1, ctx.sampleRate)
      s.connect(ctx.destination)
      s.start(0)
    } catch {
      // resume() below is what matters on most browsers
    }
    await Promise.race([ctx.resume().catch(() => undefined), new Promise((r) => setTimeout(r, 1500))])
    if ((ctx.state as string) !== 'running') throw new Error('Audio is still suspended')
  }

  get now(): number {
    return this.ctx.currentTime
  }

  private get orientation(): Orientation {
    return { listenerIsHome: this.settings.listenerClub === this.settings.homeClub }
  }

  configure(settings: EngineSettings): void {
    this.settings = settings
    const now = this.ctx.currentTime
    const flat = settings.mode !== 'headphones'
    this.hrtfMix.gain.setTargetAtTime(flat ? 0 : 1, now, 0.08)
    this.flatMix.gain.setTargetAtTime(flat ? 1 : 0, now, 0.08)
    if (this.ball) {
      this.ball.tremoloDepth.setTargetAtTime(settings.pressureLayer ? 0.2 : 0, now, 0.1)
      this.placeBall(this.lastPos, now, false)
    }
  }

  // ---------------------------------------------------------------- continuous layers

  /** Start the ball tone and the crowd bed. */
  start(at = this.ctx.currentTime + 0.05): void {
    this.stop()
    const ctx = this.ctx
    const stops: AudioScheduledSourceNode[] = []
    const osc = (type: OscillatorType, f: number) => {
      const o = ctx.createOscillator()
      o.type = type
      o.frequency.value = f
      o.start(at)
      stops.push(o)
      return o
    }
    // Warm voice: sine plus a little triangle. Hollow voice: square and triangle, resonant (clarinet-like).
    const sine = osc('sine', 440)
    const tri = osc('triangle', 440)
    const sq = osc('square', 440)
    const tri2 = osc('triangle', 440)
    const warm = this.gain(0)
    const hollow = this.gain(0)
    const warmLP = this.filter('lowpass', 1400, 0.5)
    const hollowLP = this.filter('lowpass', 1700, 4)
    sine.connect(this.gain(1)).connect(warmLP)
    tri.connect(this.gain(0.25)).connect(warmLP)
    sq.connect(this.gain(0.2)).connect(hollowLP)
    tri2.connect(this.gain(0.5)).connect(hollowLP)
    warmLP.connect(warm)
    hollowLP.connect(hollow)

    // Pressure tremolo: an LFO on the tone's gain, 2 to 8 pulses per second.
    const trem = this.gain(0.8)
    warm.connect(trem)
    hollow.connect(trem)
    const lfo = osc('sine', 2)
    const depth = this.gain(this.settings.pressureLayer ? 0.2 : 0)
    lfo.connect(depth).connect(trem.gain)

    // Danger: a low-pass that opens as the ball nears a goal.
    const dangerLP = this.filter('lowpass', 900, 0.7)
    trem.connect(dangerLP)
    const level = this.gain(0)
    level.gain.setValueAtTime(0, at)
    level.gain.linearRampToValueAtTime(BALL_LEVEL, at + 0.6)
    dangerLP.connect(level)

    const panner = new PannerNode(ctx, { panningModel: 'HRTF', distanceModel: 'inverse', refDistance: 1, rolloffFactor: 0.4 })
    const pan = ctx.createStereoPanner()
    level.connect(panner).connect(this.hrtfMix)
    level.connect(pan).connect(this.flatMix)

    this.ball = {
      freqs: [sine.frequency, tri.frequency, sq.frequency, tri2.frequency],
      warm,
      hollow,
      tremoloRate: lfo.frequency,
      tremoloDepth: depth.gain,
      filter: dangerLP,
      level,
      panner,
      pan,
      stops,
    }
    this.lastTeam = undefined
    this.placeBall(this.lastPos, at, false)
    this.startBed(at)
  }

  stop(): void {
    const now = this.ctx.currentTime
    if (this.ball) {
      this.ball.level.gain.cancelScheduledValues(now)
      this.ball.level.gain.setTargetAtTime(0, now, 0.05)
      for (const s of this.ball.stops) s.stop(now + 0.3)
      this.ball = null
    }
    if (this.bed) {
      this.bed.level.gain.setTargetAtTime(0, now, 0.1)
      this.bed.src.stop(now + 0.6)
      this.bed = null
    }
    for (const s of this.live) {
      try {
        s.stop(now + 0.05)
      } catch {
        // already stopped
      }
    }
    this.live.clear()
  }

  private startBed(at: number): void {
    this.brown ??= makeBrownNoise(this.ctx, 8)
    const src = this.ctx.createBufferSource()
    src.buffer = this.brown
    src.loop = true
    src.start(at)
    const level = this.gain(0)
    level.gain.setValueAtTime(0, at)
    level.gain.linearRampToValueAtTime(BED_LEVEL, at + 1.5)
    src.connect(this.filter('bandpass', 420, 0.6)).connect(level).connect(this.duck)
    this.bed = { level, src }
  }

  /** Move the ball tone to `p` at time `at`, gliding there from where it was if `glide`. */
  private placeBall(p: Point, at: number, glide: boolean): void {
    const b = this.ball
    if (!b) return
    const o = this.orientation
    const mode = this.settings.mode
    const set = (param: AudioParam, v: number) => (glide ? param.linearRampToValueAtTime(v, at) : param.setValueAtTime(v, at))
    const hz = ballFrequency(p, o, mode)
    for (const f of b.freqs) set(f, hz)
    set(b.pan.pan, panFor(p, o, mode))
    const pos = hrtfPosition(p, o)
    set(b.panner.positionX, mode === 'one-ear' ? 0 : pos.x)
    set(b.panner.positionY, pos.y)
    set(b.panner.positionZ, pos.z)
    set(b.filter.frequency, 700 + 3200 * danger(p))
    if (this.bed) this.bed.level.gain.setTargetAtTime(BED_LEVEL * (1 + 1.6 * danger(p)), at, 0.8)
    this.lastPos = p
  }

  private anchorBall(at: number): void {
    const b = this.ball
    if (!b) return
    // Hold the current values until `at` so the next ramp starts from here.
    const p = this.lastPos
    const hz = ballFrequency(p, this.orientation, this.settings.mode)
    for (const f of b.freqs) f.setValueAtTime(hz, at)
    b.pan.pan.setValueAtTime(panFor(p, this.orientation, this.settings.mode), at)
    const pos = hrtfPosition(p, this.orientation)
    b.panner.positionX.setValueAtTime(this.settings.mode === 'one-ear' ? 0 : pos.x, at)
    b.panner.positionZ.setValueAtTime(pos.z, at)
    b.filter.frequency.setValueAtTime(700 + 3200 * danger(p), at)
  }

  // ---------------------------------------------------------------- cues

  /** Play one cue at audio time `at`. */
  play(cue: Cue, at: number): void {
    const b = this.ball
    if (cue.team && b && cue.team !== this.lastTeam && cue.sound !== 'whistle') {
      const isWarm = cue.team === this.settings.listenerClub
      b.warm.gain.setTargetAtTime(isWarm ? 1 : 0, at, 0.06)
      b.hollow.gain.setTargetAtTime(isWarm ? 0 : 0.8, at, 0.06)
      this.lastTeam = cue.team
    }
    if (b && cue.pressure !== undefined) b.tremoloRate.setTargetAtTime(pressureRate(cue.pressure), at, 0.2)
    if (cue.from && cue.to) {
      this.anchorBall(at)
      this.placeBall(cue.from, at + 0.01, true)
      this.placeBall(cue.to, at + Math.max(0.08, Math.min(cue.duration ?? 0.3, 4)), true)
    }
    const where = cue.from ?? this.lastPos
    switch (cue.sound) {
      case 'pass':
        this.passClick(at, where, cue.distance_m ?? 15, cue.subtype)
        break
      case 'shot':
        this.shotSweep(at, where, cue.to ?? where, cue.speed_kmh ?? 80, cue.outcome)
        break
      case 'save':
        this.thud(at, where, 0.6, 190)
        break
      case 'goal':
        this.goal(at, where, cue.team === this.settings.listenerClub)
        break
      case 'tackle':
        this.thud(at, where, 0.9, 80)
        break
      case 'clearance':
        this.thud(at, where, 0.45, 140)
        break
      case 'out':
        this.outNotes(at, where)
        break
      case 'whistle':
        this.whistle(at, cue.team ? 0.35 : 0.9) // a foul is short; the start and end of a half are long
        break
      default:
        break
    }
    const touches = cue.sound === 'pass' || cue.sound === 'carry' || cue.sound === 'shot' || cue.sound === 'tackle'
    if (touches && this.settings.follow && cue.player === this.settings.follow) this.chime(at + 0.02)
  }

  /** Drop everything to about 30% while the voice speaks. */
  setDuck(on: boolean): void {
    const now = this.ctx.currentTime
    const g = this.duck.gain
    g.cancelScheduledValues(now)
    g.setValueAtTime(g.value, now)
    g.linearRampToValueAtTime(on ? DUCK_LEVEL : 1, now + (on ? 0.12 : 0.4))
  }

  /** A short tone in one ear, for the ear check at the start. */
  earCheck(side: 'left' | 'right', at = this.ctx.currentTime + 0.05): void {
    const out = this.placed(side === 'left' ? -1 : 1, true)
    const o = this.osc('sine', side === 'left' ? 523 : 659, at, at + 0.5)
    o.connect(this.env(at, 0.35, 0.02, 0.4)).connect(out)
  }

  // ---------------------------------------------------------------- one-shot sounds

  /** A stereo output for a one-shot at pitch position p. `raw` takes a pan value directly. */
  private placed(p: Point | number, raw = false): AudioNode {
    const pan = this.ctx.createStereoPanner()
    pan.pan.value = raw ? (p as number) : panFor(p as Point, this.orientation, this.settings.mode)
    pan.connect(this.duck)
    return pan
  }

  /** Short filtered noise click; longer and lower for longer passes. Crosses get a swoosh. */
  private passClick(t: number, p: Point, distance: number, subtype?: string): void {
    const k = clamp(distance / 50, 0, 1)
    const out = this.placed(p)
    if (subtype === 'cross' || subtype === 'long_ball') {
      const bp = this.filter('bandpass', 700, 2)
      bp.frequency.setValueAtTime(700, t)
      bp.frequency.exponentialRampToValueAtTime(2200, t + 0.35)
      this.noise(t, t + 0.6).connect(bp).connect(this.env(t, 0.9, 0.05, 0.45)).connect(out)
      return
    }
    const dur = 0.03 + 0.09 * k
    this.noise(t, t + dur + 0.1).connect(this.filter('bandpass', 3200 - 2000 * k, 1.4)).connect(this.env(t, 1.1, 0.003, dur)).connect(out)
    const o = this.osc('sine', 1000 - 400 * k, t, t + 0.09)
    o.frequency.exponentialRampToValueAtTime(420, t + 0.06)
    o.connect(this.env(t, 0.15, 0.002, 0.05)).connect(out)
  }

  /** Rising sweep: faster and higher for harder shots. */
  private shotSweep(t: number, from: Point, to: Point, kmh: number, outcome?: string): void {
    const power = clamp((kmh - 50) / 70, 0, 1)
    const sweep = 0.55 - 0.3 * power
    const out = this.ctx.createStereoPanner()
    out.connect(this.duck)
    out.pan.setValueAtTime(panFor(from, this.orientation, this.settings.mode), t)
    out.pan.linearRampToValueAtTime(panFor(to, this.orientation, this.settings.mode), t + sweep)
    const o = this.osc('triangle', 260, t, t + sweep + 0.1)
    o.frequency.exponentialRampToValueAtTime(1100 + 700 * power, t + sweep)
    const g = this.gain(0)
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(0.3, t + sweep - 0.01)
    g.gain.linearRampToValueAtTime(0, t + sweep + 0.06)
    o.connect(g).connect(out)
    const bp = this.filter('bandpass', 800, 1.5)
    bp.frequency.setValueAtTime(800, t)
    bp.frequency.exponentialRampToValueAtTime(3600, t + sweep)
    const ng = this.gain(0)
    ng.gain.setValueAtTime(0, t)
    ng.gain.linearRampToValueAtTime(0.8, t + sweep - 0.01)
    ng.gain.linearRampToValueAtTime(0, t + sweep + 0.06)
    this.noise(t, t + sweep + 0.1).connect(bp).connect(ng).connect(out)
    if (outcome === 'blocked') this.thud(t + sweep * 0.6, from, 0.6, 110)
  }

  /** Low thud: a sine falling fast, plus a little low noise. */
  private thud(t: number, p: Point, level: number, hz: number): void {
    const out = this.placed(p)
    const o = this.osc('sine', hz * 1.6, t, t + 0.4)
    o.frequency.exponentialRampToValueAtTime(hz * 0.6, t + 0.18)
    o.connect(this.env(t, level, 0.004, 0.22)).connect(out)
    this.noise(t, t + 0.2).connect(this.filter('lowpass', 500, 0.7)).connect(this.env(t, level * 0.5, 0.002, 0.08)).connect(out)
  }

  /**
   * Goal: a bright three-note chord, a net ripple, and the crowd. For the
   * listener's club the chord rises in a major key and the crowd roars; for
   * the opponent it is lower and minor, and the crowd groans.
   */
  private goal(t: number, p: Point, ours: boolean): void {
    const notes = ours ? [523.25, 659.25, 783.99] : [440, 523.25, 659.25].map((f) => f * 0.75)
    const out = this.placed(0, true)
    notes.forEach((f, i) => {
      const at = t + 0.12 + i * 0.11
      const o = this.osc('triangle', f, at, at + 1.6)
      o.connect(this.env(at, 0.22, 0.01, 1.4)).connect(out)
    })
    const net = this.placed(p)
    const ripple = this.gain(0.6)
    const lfo = this.osc('sine', 17, t, t + 1)
    lfo.connect(this.gain(0.4)).connect(ripple.gain)
    this.noise(t, t + 1).connect(this.filter('bandpass', 2600, 0.7)).connect(this.env(t, 1.2, 0.02, 0.7)).connect(ripple).connect(net)
    if (this.bed) {
      const g = this.bed.level.gain
      g.setTargetAtTime(BED_LEVEL * (ours ? 9 : 4), t + 0.1, 0.15)
      g.setTargetAtTime(BED_LEVEL * 1.5, t + 2.5, 1.2)
    }
  }

  /** Two soft falling notes: the ball has gone out of play. */
  private outNotes(t: number, p: Point): void {
    const out = this.placed(p)
    for (const [i, f] of [660, 495].entries()) {
      const at = t + i * 0.14
      this.osc('sine', f, at, at + 0.3).connect(this.env(at, 0.12, 0.01, 0.22)).connect(out)
    }
  }

  /** Referee's whistle: a high tone with a fast trill. */
  private whistle(t: number, length: number): void {
    const out = this.placed(0, true)
    const o = this.osc('sine', 2900, t, t + length + 0.1)
    const trill = this.osc('sine', 28, t, t + length + 0.1)
    trill.connect(this.gain(90)).connect(o.frequency)
    o.connect(this.env(t, 0.07, 0.01, length)).connect(out)
  }

  /** Personal chime: the followed player has touched the ball. */
  private chime(t: number): void {
    const out = this.placed(this.lastPos)
    for (const [f, lvl] of [[1568, 0.08], [2352, 0.04]] as const) {
      this.osc('sine', f, t, t + 0.8).connect(this.env(t, lvl, 0.003, 0.7)).connect(out)
    }
  }

  // ---------------------------------------------------------------- building blocks

  private gain(v: number): GainNode {
    const g = this.ctx.createGain()
    g.gain.value = v
    return g
  }

  private filter(type: BiquadFilterType, f: number, q: number): BiquadFilterNode {
    const n = this.ctx.createBiquadFilter()
    n.type = type
    n.frequency.value = f
    n.Q.value = q
    return n
  }

  private osc(type: OscillatorType, f: number, start: number, stop: number): OscillatorNode {
    const o = this.ctx.createOscillator()
    o.type = type
    o.frequency.setValueAtTime(f, start)
    o.start(start)
    o.stop(stop)
    this.track(o)
    return o
  }

  private noise(start: number, stop: number): AudioBufferSourceNode {
    const s = this.ctx.createBufferSource()
    s.buffer = this.white
    s.loop = true
    s.start(start, Math.random() * 1.5)
    s.stop(stop)
    this.track(s)
    return s
  }

  /** Attack-decay envelope: rises to `peak` in `attack` s, falls over `decay` s. */
  private env(t: number, peak: number, attack: number, decay: number): GainNode {
    const g = this.gain(0)
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(peak, t + attack)
    g.gain.setTargetAtTime(0, t + attack, decay / 4)
    return g
  }

  private track(s: AudioScheduledSourceNode): void {
    this.live.add(s)
    s.onended = () => this.live.delete(s)
  }
}
