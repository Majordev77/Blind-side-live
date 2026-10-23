/**
 * The stadium: a synthesised crowd that reacts to the match.
 *
 * Three layers, all made in code:
 * - rumble: low brown noise, the weight of a full stadium;
 * - chatter: noise through vowel-like formant bands whose levels wander at
 *   random, which the ear hears as thousands of voices;
 * - reactions: an "ooh" (formants sweeping up) on shots, a roar on goals,
 *   a groan on misses, and applause made of thousands of tiny claps.
 * Excitement (0 to 1) rises as an attack nears the box and falls back in
 * midfield; it lifts the chatter and brightens it.
 */

import { makeApplause, makeBrownNoise, makeWhiteNoise } from './buffers'

const FORMANTS = [420, 1050, 2400] // roughly an open "ah" from many throats
const BASE = 0.55

export class Crowd {
  private readonly out: GainNode
  private chatterGains: GainNode[] = []
  private chatterFilters: BiquadFilterNode[] = []
  private rumble: GainNode | null = null
  private sources: AudioScheduledSourceNode[] = []
  private timer: number | null = null
  private excitement = 0.15
  private applause: AudioBuffer | null = null
  private white: AudioBuffer

  constructor(private readonly ctx: AudioContext, destination: AudioNode, level = 0.5) {
    this.out = ctx.createGain()
    this.out.gain.value = level
    this.out.connect(destination)
    this.white = makeWhiteNoise(ctx, 3)
  }

  start(at: number): void {
    this.stop()
    const ctx = this.ctx
    const brown = makeBrownNoise(ctx, 8)

    // Rumble: wide, low, steady.
    const r = ctx.createBufferSource()
    r.buffer = brown
    r.loop = true
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 380
    this.rumble = ctx.createGain()
    this.rumble.gain.setValueAtTime(0, at)
    this.rumble.gain.linearRampToValueAtTime(0.5, at + 2)
    r.connect(lp).connect(this.rumble).connect(this.out)
    r.start(at)
    this.sources.push(r)

    // Chatter: stereo noise through three formant bands, each wandering on its own.
    this.chatterGains = []
    this.chatterFilters = []
    for (const [i, f] of FORMANTS.entries()) {
      const src = ctx.createBufferSource()
      src.buffer = brown
      src.loop = true
      src.playbackRate.value = 1.6 + i * 0.7 // brighter noise for the higher bands
      const bp = ctx.createBiquadFilter()
      bp.type = 'bandpass'
      bp.frequency.value = f
      bp.Q.value = 2.2
      const g = ctx.createGain()
      g.gain.value = 0
      src.connect(bp).connect(g).connect(this.out)
      src.start(at, i * 1.3)
      this.sources.push(src)
      this.chatterGains.push(g)
      this.chatterFilters.push(bp)
    }
    this.wander()
    this.timer = window.setInterval(() => this.wander(), 220)
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

  /** How worked up the crowd is, 0 to 1. Changes glide over a second or two. */
  setExcitement(level: number): void {
    this.excitement = Math.min(1, Math.max(0, level))
  }

  /** Random wandering of each voice band: this is what makes noise sound like people. */
  private wander(): void {
    const now = this.ctx.currentTime
    const e = this.excitement
    this.chatterGains.forEach((g, i) => {
      const level = (BASE * (0.45 + 0.9 * e)) * (0.55 + 0.9 * Math.random()) * (i === 2 ? 0.55 : 1)
      g.gain.setTargetAtTime(level, now, 0.25 + Math.random() * 0.3)
    })
    this.chatterFilters.forEach((f, i) => {
      const base = FORMANTS[i] ?? 800
      f.frequency.setTargetAtTime(base * (1 + 0.18 * e) * (0.93 + 0.14 * Math.random()), now, 0.4)
    })
  }

  /** "Ooooh": the crowd rises with a shot. Bigger for better chances. */
  ooh(at: number, size = 0.6): void {
    this.voiceSwell(at, 1.6, 520, 900, 0.5 + 0.9 * size)
  }

  /** The roar for a goal; louder and longer when it is the listener's club. */
  roar(at: number, ours: boolean): void {
    const big = ours ? 1 : 0.55
    this.voiceSwell(at, ours ? 5.5 : 3.2, 600, 1100, 2.4 * big)
    this.voiceSwell(at + 0.05, ours ? 5 : 2.8, 1300, 2200, 1.1 * big)
    if (this.rumble) {
      const g = this.rumble.gain
      g.setTargetAtTime(0.5 + 1.2 * big, at, 0.15)
      g.setTargetAtTime(0.5, at + 3, 1.5)
    }
    this.clap(at + 0.8, ours ? 7 : 3.5, ours ? 0.9 : 0.4)
  }

  /** A falling groan when a chance goes begging. */
  groan(at: number): void {
    this.voiceSwell(at, 1.4, 760, 430, 0.9)
  }

  /** Polite applause, for a good save or a substitution. */
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
