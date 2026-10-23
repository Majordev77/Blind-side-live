/**
 * Synthesised sample buffers for the sound engine. Everything is
 * generated in code, no audio files.
 */

/** Mono white noise, looped by the engine at a random offset. */
export function makeWhiteNoise(ctx: BaseAudioContext, seconds = 2): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds)
  const buf = ctx.createBuffer(1, len, ctx.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
  return buf
}

/**
 * Stereo brown noise (independent channels, so it sounds wide), with the
 * ends matched so it loops without a click. Normalised to about 0.9 peak.
 */
export function makeBrownNoise(ctx: BaseAudioContext, seconds = 8): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds)
  const buf = ctx.createBuffer(2, len, ctx.sampleRate)
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch)
    let b = 0
    for (let i = 0; i < len; i++) {
      b = (b + 0.02 * (Math.random() * 2 - 1)) / 1.02
      d[i] = b
    }
    // Remove the drift between the first and last sample so the loop seam is smooth.
    const first = d[0] ?? 0
    const last = d[len - 1] ?? 0
    let peak = 1e-6
    for (let i = 0; i < len; i++) {
      const v = (d[i] ?? 0) - first - ((last - first) * i) / (len - 1)
      d[i] = v
      peak = Math.max(peak, Math.abs(v))
    }
    const k = 0.9 / peak
    for (let i = 0; i < len; i++) d[i] = (d[i] ?? 0) * k
  }
  return buf
}

/**
 * Stereo applause: many short decaying noise bursts (hand claps), dense
 * at first, thinning and fading out over `seconds`. Band-pass it to about
 * 1-3 kHz in the graph.
 */
export function makeApplause(ctx: BaseAudioContext, seconds = 7.5): AudioBuffer {
  const sr = ctx.sampleRate
  const len = Math.floor(sr * seconds)
  const buf = ctx.createBuffer(2, len, sr)
  const envAt = (s: number) => {
    if (s < 0.35) return s / 0.35
    if (s < 2.5) return 1
    return Math.max(0, 1 - (s - 2.5) / (seconds - 2.5)) ** 1.5
  }
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch)
    let s = Math.random() * 0.01
    while (s < seconds) {
      const e = envAt(s)
      if (Math.random() < e) {
        const amp = (0.35 + 0.65 * Math.random()) * e
        const start = Math.floor(s * sr)
        const tau = sr * 0.0022 * (0.7 + 0.6 * Math.random())
        const n = Math.min(len - start, Math.floor(tau * 6))
        for (let i = 0; i < n; i++) {
          const j = start + i
          d[j] = (d[j] ?? 0) + amp * (Math.random() * 2 - 1) * Math.exp(-i / tau)
        }
      }
      // About 55 clap attempts per second per channel, irregular.
      s += (0.3 + 1.4 * Math.random()) / 55
    }
    let peak = 1e-6
    for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(d[i] ?? 0))
    const k = 0.9 / peak
    for (let i = 0; i < len; i++) d[i] = (d[i] ?? 0) * k
  }
  return buf
}

/** A very short bright click (decaying alternating impulse), for the "crack". */
export function makeClick(ctx: BaseAudioContext): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * 0.006)
  const buf = ctx.createBuffer(1, len, ctx.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < len; i++) d[i] = (i % 2 === 0 ? 1 : -0.85) * Math.exp(-i / (len / 5))
  return buf
}
