/**
 * Recorded sounds: real ball strikes, a real stadium crowd and a real whistle.
 *
 * Files live in web/public/sounds/ and are listed with their source and
 * licence in web/public/sounds/CREDITS.md. Only CC0 (public domain) or
 * CC BY recordings that we credit may go there, and never a recording that
 * identifies a real club, player or match. Any file that is missing is
 * simply not used: the engine falls back to its synthesised sound.
 */

export type SampleName = 'kick' | 'touch' | 'roll' | 'crowd' | 'goal' | 'cheer' | 'groan' | 'whistle_short' | 'whistle_long'

/** File names tried for each sound, in web/public/sounds/. Several files make variations. */
export const SAMPLE_FILES: Record<SampleName, string[]> = {
  kick: ['kick-1', 'kick-2', 'kick-3'],
  touch: ['touch-1', 'touch-2'],
  roll: ['roll'],
  crowd: ['crowd-loop'],
  goal: ['goal-roar', 'goal-roar-2'],
  cheer: ['cheer'],
  groan: ['groan'],
  whistle_short: ['whistle-short'],
  whistle_long: ['whistle-long'],
}

const EXTENSIONS = ['mp3', 'wav', 'ogg', 'flac']

export type Samples = Partial<Record<SampleName, AudioBuffer[]>>

async function fetchOne(ctx: BaseAudioContext, base: string, name: string): Promise<AudioBuffer | null> {
  for (const ext of EXTENSIONS) {
    try {
      const res = await fetch(`${base}${name}.${ext}`)
      if (!res.ok) continue
      const type = res.headers.get('content-type') ?? ''
      if (type.includes('text/html')) continue // a dev server's fallback page, not audio
      return await ctx.decodeAudioData(await res.arrayBuffer())
    } catch {
      // not there in this format; try the next
    }
  }
  return null
}

/** Load whichever recordings are present. Never throws: a missing file just means the synth is used. */
export async function loadSamples(ctx: BaseAudioContext, base = `${import.meta.env.BASE_URL}sounds/`): Promise<Samples> {
  const out: Samples = {}
  await Promise.all(
    (Object.keys(SAMPLE_FILES) as SampleName[]).map(async (key) => {
      const buffers = (await Promise.all(SAMPLE_FILES[key].map((n) => fetchOne(ctx, base, n)))).filter((b): b is AudioBuffer => b !== null)
      if (buffers.length) out[key] = buffers
    }),
  )
  return out
}

/** One of the variations, at random, so repeated sounds do not sound mechanical. */
export function pick(samples: Samples, name: SampleName): AudioBuffer | null {
  const list = samples[name]
  if (!list?.length) return null
  return list[Math.floor(Math.random() * list.length)] ?? null
}

/**
 * A stadium's acoustics as an impulse response: a few early reflections off
 * the stands, then a long, darkening tail. Made in code.
 */
export function stadiumImpulse(ctx: BaseAudioContext, seconds = 2.4): AudioBuffer {
  const rate = ctx.sampleRate
  const len = Math.floor(rate * seconds)
  const buf = ctx.createBuffer(2, len, rate)
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch)
    let lp = 0
    for (let i = 0; i < len; i++) {
      const t = i / rate
      // the tail gets darker as it decays: a one-pole low-pass that closes over time
      const k = 0.55 - 0.45 * Math.min(1, t / seconds)
      lp += k * ((Math.random() * 2 - 1) - lp)
      d[i] = lp * Math.exp(-t * 2.6)
    }
    // early reflections off the stands, a little different in each ear
    for (const [ms, g] of [[23, 0.5], [41, 0.35], [67, 0.3], [95, 0.22], [131, 0.16]] as const) {
      const at = Math.floor(((ms + ch * 7) / 1000) * rate)
      if (at < len) d[at] = (d[at] ?? 0) + g * (ch ? -1 : 1)
    }
  }
  return buf
}
