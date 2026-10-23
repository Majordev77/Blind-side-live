import { useEffect, useRef, useState } from 'react'
import { speak } from '../audio/speech'
import { club, DEMOS } from '../match/data'
import type { Lang } from '../audio/speech'
import type { AudioMode, Detail } from '../match/types'

export interface Choices {
  lang: Lang
  matchId: string
  listener: string
  mode: AudioMode
  detail: Detail
}

interface Option {
  value: string
  label: string
  hint?: string
}

interface Step {
  key: keyof Choices
  question: string
  options: (c: Partial<Choices>) => Option[]
}

const STEPS: Step[] = [
  {
    key: 'lang',
    question: 'Which language?',
    options: () => [
      { value: 'en', label: 'English' },
      { value: 'pcm', label: 'Nigerian Pidgin', hint: 'Commentary in Pidgin' },
    ],
  },
  {
    key: 'matchId',
    question: 'Which match?',
    options: () =>
      DEMOS.map((d, i) => ({
        value: d.match_id,
        label: `${club(d.home).name} v ${club(d.away).name}`,
        hint: `Match ${i + 1}. Starts at its best three minutes.`,
      })),
  },
  {
    key: 'listener',
    question: 'Which club do you support?',
    options: (c) => {
      const d = DEMOS.find((x) => x.match_id === c.matchId) ?? DEMOS[0]
      if (!d) return []
      return [d.home, d.away].map((code) => ({ value: code, label: club(code).name, hint: 'Attacks toward your right ear' }))
    },
  },
  {
    key: 'mode',
    question: 'How are you listening?',
    options: () => [
      { value: 'headphones', label: 'Headphones', hint: 'The ball moves around your head' },
      { value: 'speakers', label: 'Speakers', hint: 'Left and right, made wider' },
      { value: 'one-ear', label: 'One ear', hint: 'No panning. Higher pitch means nearer the goal you attack' },
    ],
  },
  {
    key: 'detail',
    question: 'How much description?',
    options: () => [
      { value: 'essentials', label: 'Essentials', hint: 'Goals and the biggest moments' },
      { value: 'full', label: 'Full', hint: 'What happened and why' },
      { value: 'analyst', label: 'Analyst', hint: 'What, why and the numbers' },
    ],
  },
]

/** Four questions, one per screen, each answered with large real buttons. Each question is also spoken. */
export function Setup({ onDone }: { onDone: (c: Choices) => void }) {
  const [step, setStep] = useState(0)
  const [choices, setChoices] = useState<Partial<Choices>>({})
  const heading = useRef<HTMLHeadingElement>(null)
  const current = STEPS[step] as Step

  useEffect(() => {
    heading.current?.focus()
    const opts = current.options(choices)
    speak(`${current.question} ${opts.map((o) => o.label).join(', or ')}.`, 'en')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step])

  const pick = (value: string) => {
    const next = { ...choices, [current.key]: value }
    setChoices(next)
    if (step + 1 < STEPS.length) setStep(step + 1)
    else onDone(next as Choices)
  }

  return (
    <main className="setup">
      <p className="label">
        Step {step + 1} of {STEPS.length}
      </p>
      <h1 className="setup-question" tabIndex={-1} ref={heading}>
        {current.question}
      </h1>
      <div className="setup-options">
        {current.options(choices).map((o) => (
          <button key={o.value} className="choice" onClick={() => pick(o.value)}>
            <span className="choice-label">{o.label}</span>
            {o.hint && <span className="choice-hint">{o.hint}</span>}
          </button>
        ))}
      </div>
      {step > 0 && (
        <button className="setup-back" onClick={() => setStep(step - 1)}>
          Back
        </button>
      )}
    </main>
  )
}
