import { useState } from 'react'
import type { SoundEngine } from './audio/engine'
import { Match } from './screens/Match'
import { Setup, type Choices } from './screens/Setup'
import { Start } from './screens/Start'

/** The listener app: start (unlock sound), set up, then the match. */
export function App() {
  const [engine, setEngine] = useState<SoundEngine | null>(null)
  const [choices, setChoices] = useState<Choices | null>(null)

  if (!engine) return <Start onReady={setEngine} />
  if (!choices) return <Setup onDone={setChoices} />
  return <Match engine={engine} choices={choices} />
}
