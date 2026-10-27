/**
 * Blind Side sound engine: the sounds of the match, placed where they happen.
 *
 * There is no continuous tone. You hear the ball the way you would from the
 * stands: the strike of a boot on the ball where the pass is played, the
 * softer touch where it is received, so a long ball travels across your
 * head from one ear to the other. Shots are struck harder and whoosh toward
 * the goal; the net swishes; tackles scuff; the referee's pea whistle
 * blows. Under it all, the crowd (crowd.ts) murmurs, builds as an attack
 * nears the box, and roars, groans and applauds.
 *
 * Every sound is synthesised here: there are no audio files.
 *
 * Placement: on headphones each sound goes through an HRTF panner (left to
 * right along the pitch, nearer or further across it); on speakers a wide
 * stereo pan; in one-ear mode no panning, and position comes from the voice.
 *
 *   one-shots -> [HRTF | stereo | mono] -> sfx -> duck -> master -> compressor -> out
 *   crowd ----------------------------------------> duck
 */

import type { AudioMode, Cue, Point } from '../match/types'
import { makeWhiteNoise } from './buffers'
import { Crowd } from './crowd'
import { danger, hrtfPosition, panFor, type Orientation } from './mapping'
import { FIRST_SAMPLES, loadSamples, pick, SAMPLE_FILES, stadiumImpulse, type SampleName, type Samples } from './samples'

const MASTER_LEVEL = 1
const DUCK_LEVEL = 0.55 // the crowd and the ball stay audible under the voice, like a broadcast
const CROWD_LEVEL = 0.75 // the crowd carries the match between strikes; a tester found everything but the ball too quiet

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

export interface EngineSettings {
  listenerClub: string
  homeClub: string
  mode: AudioMode
  /** Player whose touches get a soft personal chime. */
  follow?: string | null
  /** Kept for the setup screen; the old pressure tremolo is gone. */
  pressureLayer?: boolean
}

export class SoundEngine {
  readonly ctx: AudioContext
  private readonly master: GainNode
  private readonly duck: GainNode
  private readonly sfx: GainNode
  private readonly white: AudioBuffer
  private crowd: Crowd
  private samples: Samples = {}
  private drumsUntil = 0
  private settings: EngineSettings = { listenerClub: '', homeClub: '', mode: 'headphones' }
  private live = new Set<AudioScheduledSourceNode>()

  /** Create inside the user's tap: browsers only allow sound that starts from a gesture. */
  constructor() {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    this.ctx = new Ctor()
    const ctx = this.ctx
    const compressor = ctx.createDynamicsCompressor()
    compressor.threshold.value = -16
    compressor.knee.value = 8
    compressor.ratio.value = 5
    compressor.attack.value = 0.002
    compressor.release.value = 0.2
    compressor.connect(ctx.destination)
    this.master = this.gain(MASTER_LEVEL)
    this.master.connect(compressor)
    this.duck = this.gain(1)
    this.duck.connect(this.master)
    this.sfx = this.gain(1)
    this.sfx.connect(this.duck)
    // The stadium: every strike and whistle also rings off the stands.
    const stands = ctx.createConvolver()
    stands.buffer = stadiumImpulse(ctx)
    this.sfx.connect(this.gain(0.3)).connect(stands).connect(this.duck)
    this.white = makeWhiteNoise(ctx, 2)
    this.crowd = new Crowd(ctx, this.duck, CROWD_LEVEL)
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
    // Phones suspend audio when the screen locks, a call or notification comes in, the app is
    // switched or headphones reconnect. Everything runs on this clock, so bring it back on return.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this.wantRunning) void this.resume()
    })
  }

  /** False only while the listener has paused. When true and the context is not running, the phone stopped it. */
  wantRunning = true

  get running(): boolean {
    return (this.ctx.state as string) === 'running'
  }

  /** Restart sound the phone suspended. Some browsers only allow this inside a tap. */
  async resume(): Promise<void> {
    if (this.running) return
    await Promise.race([this.ctx.resume().catch(() => undefined), new Promise((r) => setTimeout(r, 1000))])
  }

  get now(): number {
    return this.ctx.currentTime
  }

  private get orientation(): Orientation {
    return { listenerIsHome: this.settings.listenerClub === this.settings.homeClub }
  }

  /**
   * Load the recorded sounds in web/public/sounds/. Resolves once the small
   * ones needed from kickoff are in; the big crowd reactions keep loading in
   * the background and are used from the moment they arrive. Until then, and
   * for any file that fails, the engine synthesises the sound.
   */
  async loadSamples(): Promise<void> {
    const later = (Object.keys(SAMPLE_FILES) as SampleName[]).filter((n) => !FIRST_SAMPLES.includes(n))
    void loadSamples(this.ctx, later).then((s) => Object.assign(this.samples, s))
    Object.assign(this.samples, await loadSamples(this.ctx, FIRST_SAMPLES))
  }

  configure(settings: EngineSettings): void {
    this.settings = settings
  }

  /** Bring up the stadium. */
  start(at = this.ctx.currentTime + 0.05): void {
    this.stop()
    this.crowd = new Crowd(this.ctx, this.duck, CROWD_LEVEL, this.samples)
    this.crowd.start(at)
    this.drumsUntil = 0
  }

  stop(): void {
    this.crowd.stop()
    const now = this.ctx.currentTime
    for (const s of this.live) {
      try {
        s.stop(now + 0.05)
      } catch {
        // already stopped
      }
    }
    this.live.clear()
  }

  /** Lower the match under the voice, the way a broadcast mix does. `light` dips it less, for the quick caller. */
  setDuck(on: boolean, strong = false, light = false): void {
    const now = this.ctx.currentTime
    const g = this.duck.gain
    g.cancelScheduledValues(now)
    g.setValueAtTime(g.value, now)
    const level = strong ? 0.35 : light ? 0.75 : DUCK_LEVEL
    g.linearRampToValueAtTime(on ? level : 1, now + (on ? 0.1 : 0.5))
  }

  /** A short tone in one ear, for the ear check at the start. */
  earCheck(side: 'left' | 'right', at = this.ctx.currentTime + 0.05): void {
    const pan = this.ctx.createStereoPanner()
    pan.pan.value = side === 'left' ? -1 : 1
    pan.connect(this.duck)
    this.kick(at, pan, 0.6)
    this.kick(at + 0.35, pan, 0.6)
  }

  // ---------------------------------------------------------------- cues

  /** Play one cue at audio time `at`. */
  play(cue: Cue, at: number): void {
    const from = cue.from
    const to = cue.to ?? from
    const travel = clamp(cue.duration ?? 0.4, 0.05, 4)
    const ours = cue.team === this.settings.listenerClub
    if (from) {
      const heat = danger(to ?? from)
      this.crowd.setExcitement(0.12 + 0.75 * heat)
      // The supporters' drums pick up when your side gets near goal.
      if (ours && heat > 0.55 && at > this.drumsUntil) this.drumsUntil = this.crowd.drums(at + 0.2, 4, 112, 0.35)
    }
    switch (cue.sound) {
      case 'pass': {
        if (!from || !to) break
        const long = cue.subtype === 'cross' || cue.subtype === 'long_ball' || (cue.distance_m ?? 0) > 30
        const power = clamp((cue.distance_m ?? 15) / 45, 0.15, 1)
        this.kick(at, this.place(from), long ? Math.max(power, 0.8) : power)
        if (long) this.flight(at, from, to, travel)
        if (cue.outcome === 'complete') this.touch(at + travel, this.place(to), power)
        break
      }
      case 'carry':
        if (from && to) this.dribble(at, from, to, travel)
        break
      case 'shot': {
        if (!from) break
        const power = clamp(((cue.speed_kmh ?? 80) - 40) / 80, 0.3, 1)
        this.kick(at, this.place(from), 1, true)
        this.flight(at, from, to ?? from, Math.min(travel, 0.9), power)
        this.crowd.ooh(at + 0.1, cue.xg ?? 0.3)
        if (cue.outcome === 'blocked') this.thud(at + Math.min(travel, 0.4) * 0.5, this.place(from), 0.8)
        if (cue.outcome === 'off_target') this.crowd.groan(at + Math.min(travel, 0.9) + 0.2)
        break
      }
      case 'save':
        if (from) this.gloves(at, this.place(from))
        this.crowd.clap(at + 0.4, 2.2, 0.35)
        break
      case 'goal':
        this.net(at, from ? this.place(from) : this.sfx)
        this.crowd.roar(at + 0.15, ours)
        this.whistle(at + 1.2, 'short')
        if (ours) this.drumsUntil = this.crowd.drums(at + 2.5, 12, 132, 0.6)
        break
      case 'tackle':
        if (from) this.scuffle(at, this.place(from))
        break
      case 'clearance':
        if (from) this.kick(at, this.place(from), 1)
        if (from && to) this.flight(at, from, to, travel)
        break
      case 'whistle':
        // a foul is one short blast; the start and end of a half are long
        this.whistle(at, cue.team ? 'short' : 'long')
        break
      default:
        break
    }
    const touches = cue.sound === 'pass' || cue.sound === 'carry' || cue.sound === 'shot'
    if (touches && this.settings.follow && cue.player === this.settings.follow && from) this.chime(at + 0.05, this.place(from))
  }

  // ---------------------------------------------------------------- placement

  /** An output node that places a sound at pitch position p, for the current listening mode. */
  private place(p: Point): AudioNode {
    const mode = this.settings.mode
    const o = this.orientation
    if (mode === 'headphones') {
      const pos = hrtfPosition(p, o)
      const panner = new PannerNode(this.ctx, {
        panningModel: 'HRTF',
        distanceModel: 'inverse',
        refDistance: 1,
        rolloffFactor: 0.35,
        positionX: pos.x,
        positionY: pos.y,
        positionZ: pos.z,
      })
      panner.connect(this.sfx)
      return panner
    }
    const pan = this.ctx.createStereoPanner()
    pan.pan.value = panFor(p, o, mode)
    pan.connect(this.sfx)
    return pan
  }

  /** A panner that travels from `a` to `b` over `secs`, for sounds that fly. */
  private travelling(t: number, a: Point, b: Point, secs: number): AudioNode {
    const mode = this.settings.mode
    const o = this.orientation
    if (mode === 'headphones') {
      const pa = hrtfPosition(a, o)
      const pb = hrtfPosition(b, o)
      const panner = new PannerNode(this.ctx, { panningModel: 'HRTF', distanceModel: 'inverse', refDistance: 1, rolloffFactor: 0.35 })
      panner.positionX.setValueAtTime(pa.x, t)
      panner.positionZ.setValueAtTime(pa.z, t)
      panner.positionX.linearRampToValueAtTime(pb.x, t + secs)
      panner.positionZ.linearRampToValueAtTime(pb.z, t + secs)
      panner.connect(this.sfx)
      return panner
    }
    const pan = this.ctx.createStereoPanner()
    pan.pan.setValueAtTime(panFor(a, o, mode), t)
    pan.pan.linearRampToValueAtTime(panFor(b, o, mode), t + secs)
    pan.connect(this.sfx)
    return pan
  }

  // ---------------------------------------------------------------- the sounds

  /**
   * A boot striking the ball: a sharp leather click, the slap of the panel,
   * and a low boom from the air inside. Harder strikes are louder and deeper.
   */
  private kick(t: number, out: AudioNode, power: number, shot = false): void {
    const p = clamp(power, 0, 1)
    const rec = pick(this.samples, 'kick')
    if (rec) {
      // a real strike: harder kicks louder and a shade deeper. The recordings are hot, so kept well
      // below the voice and the crowd; louder, they set off the compressor and pushed everything else down.
      this.playSample(rec, t, out, 0.25 + 0.35 * p + (shot ? 0.15 : 0), (shot ? 0.9 : 1.04 - 0.1 * p) * (0.96 + Math.random() * 0.08))
      return
    }
    // leather click
    this.noise(t, t + 0.02).connect(this.filter('highpass', 2400, 0.7)).connect(this.env(t, 0.25 + 0.35 * p, 0.0008, 0.012)).connect(out)
    // panel slap
    this.noise(t, t + 0.08).connect(this.filter('bandpass', 1100 - 300 * p, 1.1)).connect(this.env(t, 0.5 + 0.5 * p, 0.001, 0.045)).connect(out)
    // boom
    const o = this.osc('sine', 170 + 60 * p, t, t + 0.25)
    o.frequency.exponentialRampToValueAtTime(shot ? 48 : 60, t + 0.09)
    o.connect(this.env(t, 0.45 + 0.6 * p + (shot ? 0.3 : 0), 0.002, shot ? 0.14 : 0.09)).connect(out)
  }

  /** The receiver's first touch: a muffled, softer contact. */
  private touch(t: number, out: AudioNode, power: number): void {
    const p = clamp(power, 0, 1)
    const rec = pick(this.samples, 'touch')
    const kick = rec ? null : pick(this.samples, 'kick')
    if (rec || kick) {
      // a first touch is a softer, duller contact than a strike
      this.playSample((rec ?? kick) as AudioBuffer, t, out, rec ? 0.25 + 0.15 * p : 0.1 + 0.08 * p, rec ? 1 : 0.78)
      return
    }
    this.noise(t, t + 0.06).connect(this.filter('bandpass', 650, 1)).connect(this.env(t, 0.22 + 0.2 * p, 0.003, 0.04)).connect(out)
    const o = this.osc('sine', 120, t, t + 0.15)
    o.frequency.exponentialRampToValueAtTime(70, t + 0.07)
    o.connect(this.env(t, 0.22 + 0.15 * p, 0.003, 0.06)).connect(out)
  }

  /** A ball in the air: a faint rushing that travels with it. */
  private flight(t: number, a: Point, b: Point, secs: number, power = 0.5): void {
    const out = this.travelling(t, a, b, secs)
    const bp = this.filter('bandpass', 1400 + 900 * power, 0.9)
    bp.frequency.setValueAtTime(1400 + 900 * power, t)
    bp.frequency.linearRampToValueAtTime(900, t + secs)
    const g = this.gain(0)
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(0.09 + 0.12 * power, t + Math.min(0.15, secs * 0.3))
    g.gain.linearRampToValueAtTime(0, t + secs)
    this.noise(t, t + secs + 0.05).connect(bp).connect(g).connect(out)
  }

  /** Running with the ball: light touches every few strides, moving with the player. */
  private dribble(t: number, a: Point, b: Point, secs: number): void {
    const steps = clamp(Math.round(secs / 0.45), 1, 6)
    for (let i = 0; i < steps; i++) {
      const k = steps === 1 ? 0 : i / (steps - 1)
      const p: Point = [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k]
      const at = t + (secs * i) / steps
      const out = this.place(p)
      this.noise(at, at + 0.04).connect(this.filter('bandpass', 800, 1.2)).connect(this.env(at, 0.14, 0.002, 0.025)).connect(out)
    }
  }

  /** Bodies and boots meeting: two dull thuds and a scrape of studs. */
  private scuffle(t: number, out: AudioNode): void {
    this.thud(t, out, 0.7)
    this.thud(t + 0.07, out, 0.5)
    this.noise(t + 0.02, t + 0.2).connect(this.filter('bandpass', 3200, 2)).connect(this.env(t + 0.02, 0.12, 0.01, 0.12)).connect(out)
  }

  private thud(t: number, out: AudioNode, level: number): void {
    const o = this.osc('sine', 110, t, t + 0.2)
    o.frequency.exponentialRampToValueAtTime(55, t + 0.1)
    o.connect(this.env(t, level, 0.003, 0.08)).connect(out)
    this.noise(t, t + 0.06).connect(this.filter('lowpass', 600, 0.7)).connect(this.env(t, level * 0.4, 0.002, 0.03)).connect(out)
  }

  /** The keeper's gloves on the ball: a padded slap. */
  private gloves(t: number, out: AudioNode): void {
    this.noise(t, t + 0.05).connect(this.filter('bandpass', 1800, 0.8)).connect(this.env(t, 0.55, 0.001, 0.03)).connect(out)
    this.thud(t, out, 0.5)
  }

  /** The ball hitting the net: a swish with a rippling tail. */
  private net(t: number, out: AudioNode): void {
    const ripple = this.gain(0.7)
    const lfo = this.osc('sine', 16, t, t + 1.2)
    lfo.connect(this.gain(0.35)).connect(ripple.gain)
    this.noise(t, t + 1.2).connect(this.filter('bandpass', 2300, 0.7)).connect(this.env(t, 0.9, 0.015, 0.8)).connect(ripple).connect(out)
  }

  /**
   * A referee's pea whistle: a bright tone, rattled about 30 times a second
   * by the pea, with breath noise. Long for the start and end of a half.
   */
  whistle(t: number, kind: 'short' | 'long' | 'full'): void {
    const blasts = kind === 'full' ? [0.55, 0.55, 1.2] : [kind === 'long' ? 1.0 : 0.3]
    const short = pick(this.samples, 'whistle_short')
    const long = pick(this.samples, 'whistle_long') ?? short
    if (short || long) {
      let at = t
      for (const len of blasts) {
        const rec = (len >= 0.5 ? long : short) ?? long
        if (rec) this.playSample(rec, at, this.sfx, 0.4, 1)
        at += Math.max(len, rec?.duration ?? len) + 0.15
      }
      return
    }
    let at = t
    const out = this.gain(1)
    out.connect(this.sfx)
    for (const len of blasts) {
      const tone = this.osc('sine', 3150, at, at + len + 0.05)
      const harm = this.osc('sine', 6300, at, at + len + 0.05)
      const rattle = this.gain(0.6)
      const pea = this.osc('sine', 31, at, at + len + 0.05)
      pea.connect(this.gain(0.4)).connect(rattle.gain)
      tone.connect(rattle)
      harm.connect(this.gain(0.12)).connect(rattle)
      const env = this.gain(0)
      env.gain.setValueAtTime(0, at)
      env.gain.linearRampToValueAtTime(0.09, at + 0.02)
      env.gain.setValueAtTime(0.09, at + len - 0.04)
      env.gain.linearRampToValueAtTime(0, at + len)
      rattle.connect(env).connect(out)
      this.noise(at, at + len).connect(this.filter('bandpass', 3100, 3)).connect(this.env(at, 0.05, 0.02, len)).connect(out)
      at += len + 0.18
    }
  }

  /** A soft bell when the player you follow touches the ball. */
  private chime(t: number, out: AudioNode): void {
    this.osc('sine', 1568, t, t + 0.6).connect(this.env(t, 0.05, 0.003, 0.5)).connect(out)
    this.osc('sine', 2352, t, t + 0.5).connect(this.env(t, 0.025, 0.003, 0.4)).connect(out)
  }

  // ---------------------------------------------------------------- building blocks

  private playSample(buf: AudioBuffer, t: number, out: AudioNode, level: number, rate = 1): void {
    const src = this.ctx.createBufferSource()
    src.buffer = buf
    src.playbackRate.value = rate
    src.connect(this.gain(level)).connect(out)
    src.start(t)
    this.track(src)
  }

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

  /** Attack-decay envelope: rises to `peak` in `attack` s, then decays with time constant `decay`/3. */
  private env(t: number, peak: number, attack: number, decay: number): GainNode {
    const g = this.gain(0)
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(peak, t + attack)
    g.gain.setTargetAtTime(0, t + attack, decay / 3)
    return g
  }

  private track(s: AudioScheduledSourceNode): void {
    this.live.add(s)
    s.onended = () => this.live.delete(s)
  }
}
