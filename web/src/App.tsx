import { useState } from 'react'
import type { SoundEngine } from './audio/engine'
import { Companion } from './companion/Companion'
import { DEMOS } from './match/data'
import { Match } from './screens/Match'
import { Setup, type Choices } from './screens/Setup'
import { Start } from './screens/Start'

function firstVisit(): boolean {
  try {
    return localStorage.getItem('blindside.tutorial') !== 'done'
  } catch {
    return true
  }
}

/** One tap and you are in the stadium: a goal-bound passage of the first demo, with sensible defaults. */
function instantDemo(): Choices {
  return {
    lang: 'en',
    matchId: DEMOS[0]?.match_id ?? 'demo_1',
    listener: 'auto', // the side about to score, so the first thing you feel is a roar
    mode: 'headphones',
    detail: 'full',
    instant: true,
    tutorial: firstVisit(),
  }
}

/** The listener app: start (unlock sound), straight into the match, and personalise any time. */
export function App() {
  // The companion screen is its own page: the same app, opened with #companion.
  if (typeof window !== 'undefined' && window.location.hash === '#companion') return <Companion />
  return <Listener />
}

function Listener() {
  const [engine, setEngine] = useState<SoundEngine | null>(null)
  const [choices, setChoices] = useState<Choices | null>(null)
  const [personalising, setPersonalising] = useState(false)

  if (!engine) {
    return (
      <Start
        onReady={(e) => {
          setEngine(e)
          setChoices(instantDemo())
        }}
      />
    )
  }
  if (personalising || !choices) {
    return (
      <Setup
        onDone={(c) => {
          setChoices({ ...c, instant: false, tutorial: false })
          setPersonalising(false)
        }}
      />
    )
  }
  return <Match key={JSON.stringify(choices)} engine={engine} choices={choices} onPersonalise={() => setPersonalising(true)} />
}
