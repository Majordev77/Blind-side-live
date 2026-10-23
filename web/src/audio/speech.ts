/**
 * Voice via the browser's speechSynthesis. Keep these public signatures.
 *
 * - primeSpeech() inside the user's tap (iOS Safari needs a first speak()
 *   in a gesture before later, timer-driven speech is allowed).
 * - speak() never blocks: it queues and returns at once. The caller checks
 *   a line's expiry before calling it.
 */

/** Languages the voice can speak: English and Nigerian Pidgin (on a Nigerian English voice where one exists). */
export type Lang = 'en' | 'pcm'

let RATE = 1.05

/** Speech rate, 1 (normal) to 2 (double): experienced screen reader users often listen fast. */
export function setSpeechRate(rate: number): void {
  RATE = Math.min(2, Math.max(0.8, rate))
}
const NATURAL = /natural|neural|enhanced|premium|online/i

let voices: SpeechSynthesisVoice[] = []
let listening = false
/** Live utterances (Chrome can garbage-collect them and drop onend) and their finishers. */
const live = new Map<SpeechSynthesisUtterance, () => void>()

export function speechSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}

function loadVoices(): void {
  if (!speechSupported()) return
  try {
    const v = window.speechSynthesis.getVoices()
    if (v.length) voices = v
  } catch {
    // ignore
  }
  if (listening) return
  listening = true
  const onChange = () => {
    try {
      const v = window.speechSynthesis.getVoices()
      if (v.length) voices = v
    } catch {
      // ignore
    }
  }
  try {
    window.speechSynthesis.addEventListener('voiceschanged', onChange)
  } catch {
    window.speechSynthesis.onvoiceschanged = onChange
  }
}

const norm = (tag: string) => tag.replace('_', '-').toLowerCase()

/** Best voice among those whose language matches `test`: natural/enhanced first, then Google, then the default. */
function best(test: (tag: string) => boolean, order: string[] = []): SpeechSynthesisVoice | null {
  let pick: SpeechSynthesisVoice | null = null
  let top = -1
  for (const v of voices) {
    const tag = norm(v.lang)
    if (!test(tag)) continue
    const idx = order.indexOf(tag)
    const score =
      (NATURAL.test(v.name) ? 100 : 0) +
      (/google/i.test(v.name) ? 20 : 0) +
      (idx >= 0 ? (order.length - idx) * 5 : 0) +
      (v.default ? 1 : 0)
    if (score > top) {
      top = score
      pick = v
    }
  }
  return pick
}

/** Voice and utterance.lang for a language, or null if it cannot be voiced. */
export function pickVoice(lang: Lang): { voice: SpeechSynthesisVoice | null; tag: string } | null {
  if (!voices.length) loadVoices()
  const english = () => {
    const v =
      best((t) => t === 'en-gb' || t === 'en-us', ['en-gb', 'en-us']) ?? best((t) => t.startsWith('en'))
    return { voice: v, tag: v?.lang ?? 'en-GB' }
  }
  if (lang === 'en') return english()
  if (lang === 'pcm') {
    const ng = best((t) => t === 'en-ng')
    return ng ? { voice: ng, tag: ng.lang } : english()
  }
  return english()
}

/** True if speak() would voice this language right now. */
export function canSpeak(lang: Lang): boolean {
  return speechSupported() && pickVoice(lang) !== null
}

/** Call synchronously inside the user's tap so iOS allows later speech. */
export function primeSpeech(): void {
  if (!speechSupported()) return
  loadVoices()
  try {
    const u = new SpeechSynthesisUtterance(' ')
    u.volume = 0
    u.rate = RATE
    window.speechSynthesis.speak(u)
  } catch {
    // ignore
  }
}

/**
 * Speak a line. Returns false if it could not be spoken (no voice for
 * the language, no speech support), so the caller can still caption it.
 * handlers.onEnd also fires on error or cancel.
 */
export function speak(
  text: string,
  lang: Lang,
  handlers: { onStart?: () => void; onEnd?: () => void } = {},
): boolean {
  if (!speechSupported() || !text.trim()) return false
  const pick = pickVoice(lang)
  if (!pick) return false
  try {
    const u = new SpeechSynthesisUtterance(text)
    u.lang = pick.tag
    if (pick.voice) u.voice = pick.voice
    u.rate = RATE
    u.pitch = 1
    u.volume = 1
    let done = false
    const finish = () => {
      if (done) return
      done = true
      live.delete(u)
      handlers.onEnd?.()
    }
    u.onstart = () => handlers.onStart?.()
    u.onend = finish
    u.onerror = finish
    live.set(u, finish)
    const synth = window.speechSynthesis
    if (synth.paused) synth.resume()
    synth.speak(u)
    return true
  } catch {
    return false
  }
}

export function cancelSpeech(): void {
  if (!speechSupported()) return
  window.speechSynthesis.cancel()
  // Some browsers do not fire onend/onerror after cancel(); finish them so nothing stays ducked.
  for (const finish of [...live.values()]) finish()
}

export function isSpeaking(): boolean {
  return speechSupported() && window.speechSynthesis.speaking
}
