import { useRef, useState } from 'react'
import { SoundEngine } from '../audio/engine'
import { primeSpeech, speak } from '../audio/speech'

interface Props {
  onReady: (engine: SoundEngine) => void
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * The whole screen is one button. Sound has to start inside the tap, so the
 * AudioContext is created and speech is primed synchronously in the click
 * handler, before anything is awaited. Then an ear check plays a tone in the
 * left ear and one in the right.
 */
export function Start({ onReady }: Props) {
  const [status, setStatus] = useState<'idle' | 'checking' | 'failed'>('idle')
  const engineRef = useRef<SoundEngine | null>(null)

  const begin = async () => {
    if (status === 'checking') return // a second tap must not start a second stream
    setStatus('checking')
    let engine = engineRef.current
    try {
      engine ??= new SoundEngine()
      engineRef.current = engine
      primeSpeech()
      await engine.unlock()
    } catch {
      setStatus('failed')
      return
    }
    await engine.loadSamples() // the recorded kicks, crowd and whistle; missing files fall back to synthesis
    speak('Left ear.', 'en')
    engine.earCheck('left')
    await wait(1200)
    speak('Right ear.', 'en')
    engine.earCheck('right')
    await wait(1200)
    onReady(engine)
  }

  return (
    <main className="start">
      <button className="start-button" onClick={begin} aria-describedby="start-help">
        <span className="start-ears" aria-hidden="true">
          <span className="ear ear-left">Left</span>
          <span className="label">Ear check</span>
          <span className="ear ear-right">Right</span>
        </span>
        <span className="start-title">
          {status === 'checking' ? 'Listen: left ear, then right' : 'Put on your headphones'}
        </span>
        <span className="start-sub" id="start-help">
          {status === 'failed'
            ? 'No sound yet. Turn off silent mode, turn the volume up, then tap again.'
            : 'Tap anywhere to start. You will hear a tone in your left ear, then your right.'}
        </span>
      </button>
      <p className="start-note">
        All clubs, players and matches are invented.{' '}
        {!navigator.userAgent.includes('Edg/') && 'For the most natural voices, open this page in Microsoft Edge. '}
        <a href="#companion" onClick={() => setTimeout(() => window.location.reload(), 0)}>
          Watching with someone? Open the companion screen
        </a>
      </p>
      <p className="visually-hidden" role="status" aria-live="assertive">
        {status === 'failed' ? 'Sound could not start. Turn off silent mode, turn the volume up, then tap again.' : ''}
      </p>
    </main>
  )
}
