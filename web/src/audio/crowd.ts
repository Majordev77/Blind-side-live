/**
 * The stadium: a crowd that reacts to the match.
 *
 * With recordings in web/public/sounds/ (see samples.ts), the bed is a real
 * stadium crowd loop and goals get a real roar. Without them, the crowd is
 * synthesised: a low rumble, plus noise through vowel-like formant bands
 * whose levels wander at random, which the ear hears as many voices.
 *
 * Either way the crowd builds as an attack nears the box (excitement 0 to 1),
 * goes "ooh" on shots, groans at misses, applauds saves and roars at goals,
 * and the supporters' drum band beats when their side is on the attack and
 * goes wild after a goal.
 */

import { makeApplause, makeBrownNoise, makeWhiteNoise } from './buffers'
import { pick, type Samples } from './samples'

const FORMANTS = [420, 1050, 2400] // roughly an open "ah" from many throats
const BASE = 0.55

export class Crowd {
  private readonly out: GainNode
  private readonly bed: GainNode
  private chatterGains: GainNode[] = []
  private chatterFilters: BiquadFilterNode[] = []
  private rumble: GainNode | null = null
  private sources: AudioScheduledSourceNode[] = []
  private timer: number | null = null
  private excitement = 0.15
  private applause: AudioBuffer | null = null
  private white: AudioBuffer
  private recordedBed = false

  constructor(
    private readonly ctx: AudioContext,
    destination: AudioNode,
    level = 0.5,
    private readonly samples: Samples = {},
  ) {
    this.out = ctx.createGain()
    this.out.gain.value = level
    this.out.connect(destination)
    this.bed = ctx.createGain()
    this.bed.gain.value = 1
    this.bed.connect(this.out)
    this.white = makeWhiteNoise(ctx, 3)
  }

  start(at: number): void {
    this.stop()
    const ctx = this.ctx
    const recording = pick(this.samples, 'crowd')
    this.recordedBed = recording !== null
    this.bed.gain.setValueAtTime(0, at)
    this.bed.gain.linearRampToValueAtTime(1, at + 2.5)
    if (recording) {
      // A real crowd. The recording is short, so two copies play at different points and
      // slightly different speeds, one in each ear: the loop never sounds like a loop.
      for (const [rate, side] of [[0.985, -0.6], [1.02, 0.6]] as const) {
        const s = ctx.createBufferSource()
        s.buffer = recording
        s.loop = true
        s.playbackRate.value = rate
        const pan = ctx.createStereoPanner()
        pan.pan.value = side
        s.connect(pan).connect(this.bed)
        s.start(at, Math.random() * Math.max(0, recording.duration - 1))
        this.sources.push(s)
      }
    } else {
      this.startSynthBed(at)
    }
    this.wander()
    this.timer = window.setInterval(() => this.wander(), 220)
  }

  private startSynthBed(at: number): void {
    const ctx = this.ctx
    const brown = makeBrownNoise(ctx, 8)
    const r = ctx.createBufferSource()
    r.buffer = brown
    r.loop = true
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 380
    this.rumble = ctx.createGain()
    this.rumble.gain.value = 0.5
    r.connect(lp).connect(this.rumble).connect(this.bed)
    r.start(at)
    this.sources.push(r)
    this.chatterGains = []
    this.chatterFilters = []
    for (const [i, f] of FORMANTS.entries()) {
      const src = ctx.createBufferSource()
      src.buffer = brown
      src.loop = true
      src.playbackRate.value = 1.6 + i * 0.7
      const bp = ctx.createBiquadFilter()
      bp.type = 'bandpass'
      bp.frequency.value = f
      bp.Q.value = 2.2
      const g = ctx.createGain()
      g.gain.value = 0
      src.connect(bp).connect(g).connect(this.bed)
      src.start(at, i * 1.3)
      this.sources.push(src)
      this.chatterGains.push(g)
      this.chatterFilters.push(bp)
    }
  }

  stop(): void {
    const now = this.ctx.currentTime
    if (this.timer !== null) window.clearInterval(this.timer)
    this.timer = null
    for (const s of this.sources) {
      try {
        s.stop(now + 0.3)
      } catch {
        // already stopped
      }
    }
    this.sources = []
  }

  /** How worked up the crowd is, 0 to 1. */
  setExcitement(level: number): void {
    this.excitement = Math.min(1, Math.max(0, level))
  }

  private wander(): void {
    const now = this.ctx.currentTime
    const e = this.excitement
    if (this.recordedBed) {
      // the recording rises and falls with the attack
      this.bed.gain.setTargetAtTime(0.65 + 0.7 * e, now, 0.9)
      return
    }
    this.chatterGains.forEach((g, i) => {
      const level = BASE * (0.45 + 0.9 * e) * (0.55 + 0.9 * Math.random()) * (i === 2 ? 0.55 : 1)
      g.gain.setTargetAtTime(level, now, 0.25 + Math.random() * 0.3)
    })
    this.chatterFilters.forEach((f, i) => {
      const base = FORMANTS[i] ?? 800
      f.frequency.setTargetAtTime(base * (1 + 0.18 * e) * (0.93 + 0.14 * Math.random()), now, 0.4)
    })
  }

  /** "Ooooh": the crowd rises with a shot. Bigger for better chances. */
  ooh(at: number, size = 0.6): void {
    const cheer = pick(this.samples, 'cheer')
    if (cheer && size > 0.25) {
      this.playRecording(cheer, at, 0.35 + 0.5 * size, 2.2)
      return
    }
    this.voiceSwell(at, 1.6, 520, 900, 0.5 + 0.9 * size)
  }

  /** The roar for a goal; louder and longer when it is the listener's club. */
  roar(at: number, ours: boolean): void {
    const big = ours ? 1 : 0.5
    const rec = pick(this.samples, 'goal')
    if (rec) {
      this.playRecording(rec, at, 1.3 * big, Math.min(rec.duration, ours ? 9 : 4))
    } else {
      this.voiceSwell(at, ours ? 5.5 : 3.2, 600, 1100, 2.4 * big)
      this.voiceSwell(at + 0.05, ours ? 5 : 2.8, 1300, 2200, 1.1 * big)
    }
    const g = this.bed.gain
    g.setTargetAtTime(0.6 + 1.2 * big, at, 0.15)
    g.setTargetAtTime(0.8, at + 4, 1.5)
    this.clap(at + 0.8, ours ? 7 : 3.5, ours ? 0.9 : 0.4)
  }

  /** A falling groan when a chance goes begging. */
  groan(at: number): void {
    const rec = pick(this.samples, 'groan')
    if (rec) this.playRecording(rec, at, 0.7, 2.5)
    else this.voiceSwell(at, 1.4, 760, 430, 0.9)
  }

  /** Applause, for a good save or a goal. */
  clap(at: number, seconds = 3, level = 0.5): void {
    this.applause ??= makeApplause(this.ctx, 7.5)
    const s = this.ctx.createBufferSource()
    s.buffer = this.applause
    const bp = this.ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = 1800
    bp.Q.value = 0.6
    const g = this.ctx.createGain()
    g.gain.setValueAtTime(0, at)
    g.gain.linearRampToValueAtTime(level, at + 0.3)
    g.gain.setTargetAtTime(0, at + seconds * 0.6, seconds * 0.25)
    s.connect(bp).connect(g).connect(this.out)
    s.start(at)
    s.stop(at + Math.min(7.5, seconds + 2))
  }

  /**
   * The supporters' drum band: big bass drums and a tighter tom, from one end
   * of the ground. Returns when the drumming ends, so callers do not stack it.
   */
  drums(at: number, bars: number, bpm: number, level: number): number {
    const beat = 60 / bpm
    // a terrace rhythm over one bar of four beats: BOOM . boom-boom BOOM . boom . (in eighths)
    const pattern: [number, 'bass' | 'tom', number][] = [
      [0, 'bass', 1], [1.5, 'tom', 0.6], [1.75, 'tom', 0.7], [2, 'bass', 0.9], [3, 'tom', 0.7], [3.5, 'tom', 0.6],
    ]
    const pan = this.ctx.createStereoPanner()
    pan.pan.value = -0.55 // the band sits behind one goal
    const g = this.ctx.createGain()
    g.gain.value = level
    pan.connect(g).connect(this.out)
    for (let b = 0; b < bars; b++) {
      for (const [pos, kind, vel] of pattern) {
        const t = at + (b * 4 + pos) * beat
        const swell = 0.7 + 0.3 * Math.min(1, b / 2) // the band joins in
        this.drumHit(t, kind, vel * swell, pan)
      }
    }
    return at + bars * 4 * beat
  }

  private drumHit(t: number, kind: 'bass' | 'tom', vel: number, out: AudioNode): void {
    const ctx = this.ctx
    const o = ctx.createOscillator()
    o.type = 'sine'
    const f0 = kind === 'bass' ? 95 : 165
    o.frequency.setValueAtTime(f0, t)
    o.frequency.exponentialRampToValueAtTime(f0 * 0.55, t + 0.18)
    const og = ctx.createGain()
    og.gain.setValueAtTime(0, t)
    og.gain.linearRampToValueAtTime(vel * (kind === 'bass' ? 0.9 : 0.55), t + 0.004)
    og.gain.setTargetAtTime(0, t + 0.004, kind === 'bass' ? 0.12 : 0.07)
    o.connect(og).connect(out)
    o.start(t)
    o.stop(t + 0.6)
    // the skin: a short burst of filtered noise
    const n = ctx.createBufferSource()
    n.buffer = this.white
    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = kind === 'bass' ? 300 : 700
    bp.Q.value = 0.9
    const ng = ctx.createGain()
    ng.gain.setValueAtTime(0, t)
    ng.gain.linearRampToValueAtTime(vel * 0.25, t + 0.002)
    ng.gain.setTargetAtTime(0, t + 0.002, 0.02)
    n.connect(bp).connect(ng).connect(out)
    n.start(t, Math.random())
    n.stop(t + 0.15)
  }

  private playRecording(buf: AudioBuffer, at: number, level: number, seconds: number): void {
    const s = this.ctx.createBufferSource()
    s.buffer = buf
    const g = this.ctx.createGain()
    g.gain.setValueAtTime(level, at)
    g.gain.setTargetAtTime(0, at + Math.max(0.5, seconds - 1.2), 0.5)
    s.connect(g).connect(this.out)
    s.start(at)
    s.stop(at + seconds + 1.5)
  }

  /** Many voices together: noise through a vowel band that slides from f0 to f1. */
  private voiceSwell(at: number, seconds: number, f0: number, f1: number, level: number): void {
    const ctx = this.ctx
    for (const detune of [1, 1.5]) {
      const s = ctx.createBufferSource()
      s.buffer = this.white
      s.loop = true
      const bp = ctx.createBiquadFilter()
      bp.type = 'bandpass'
      bp.Q.value = 3
      bp.frequency.setValueAtTime(f0 * detune, at)
      bp.frequency.linearRampToValueAtTime(f1 * detune, at + seconds * 0.45)
      bp.frequency.linearRampToValueAtTime(f1 * detune * 0.85, at + seconds)
      const g = ctx.createGain()
      g.gain.setValueAtTime(0, at)
      g.gain.linearRampToValueAtTime(level * (detune === 1 ? 1 : 0.45), at + seconds * 0.3)
      g.gain.setTargetAtTime(0, at + seconds * 0.55, seconds * 0.2)
      s.connect(bp).connect(g).connect(this.out)
      s.start(at, Math.random() * 2)
      s.stop(at + seconds + 1)
    }
  }
}
