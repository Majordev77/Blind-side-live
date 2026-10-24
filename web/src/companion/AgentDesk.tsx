import { useEffect, useRef } from 'react'
import type { AgentStep } from '../match/data'

interface Props {
  steps: AgentStep[]
  /** The listener variant to follow (e.g. "en:OST:full"); rejections from every variant are always shown. */
  focus: string
  provider: string
  model: string
}

const AGENT: Record<AgentStep['agent'], string> = { editor: 'EDITOR', narrator: 'NARRATOR', verifier: 'VERIFIER', publisher: 'PUBLISH' }
const MAX = 14

const mmss = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`

/** Which steps are worth a line on the desk. */
export function deskSteps(steps: AgentStep[], focus: string): AgentStep[] {
  return steps.filter((s) => {
    if (s.agent === 'editor') return s.action === 'assigned' || s.action === 'storyline' || s.action === 'model_pick'
    if (s.agent === 'publisher') return true
    if (s.agent === 'verifier' && s.action === 'fail') return true // every rejection, from every variant
    if (s.agent === 'narrator' && s.action === 'failed') return true
    return s.variant === focus
  })
}

function describe(s: AgentStep): { body: string; quote?: string; verdict?: 'pass' | 'fail' } {
  switch (`${s.agent}:${s.action}`) {
    case 'editor:assigned':
      return { body: `picked ${s.moment_id} ${s.type?.replace('_', ' ')}${s.levels ? ` for ${s.levels.join(', ')}` : ''}${s.angle ? `. Angle: ${s.angle}` : ''}` }
    case 'editor:storyline':
      return { body: `storyline: ${s.text}` }
    case 'editor:model_pick':
      return { body: 'the model chose between candidate moments' }
    case 'narrator:draft':
      return { body: `${s.variant}${s.attempt === 2 ? ' · retry' : ''}`, quote: s.text }
    case 'narrator:failed':
      return { body: `${s.reason === 'late' ? 'too slow' : 'failed'}; the template will air` }
    case 'verifier:pass':
      return { body: `${s.variant}`, verdict: 'pass' }
    case 'verifier:fail':
      return { body: `${s.variant}: ${(s.reasons ?? []).join('; ')}`, quote: s.text, verdict: 'fail' }
    case 'verifier:template':
      return { body: `${s.variant}: template aired instead` }
    case 'publisher:published':
      return { body: `${s.lines} checked lines to their listener groups` }
    default:
      return { body: s.action }
  }
}

/** The agent desk: the editor, narrator, verifier and publisher at work, in step with the match. */
export function AgentDesk({ steps, focus, provider, model }: Props) {
  const shown = deskSteps(steps, focus).slice(-MAX)
  const end = useRef<HTMLLIElement>(null)
  useEffect(() => end.current?.scrollIntoView({ block: 'nearest' }), [shown.length])
  const writer = provider === 'offline' ? 'offline writer (planted errors, to show the verifier)' : `${provider} · ${model}`
  const rejected = steps.filter((s) => s.agent === 'verifier' && s.action === 'fail').length
  return (
    <section className="desk" aria-label="Agent desk">
      <header className="desk-head">
        <h2 className="label">Agent desk · live</h2>
        <p className="desk-meta">
          Narrator: {writer} · {rejected} {rejected === 1 ? 'line' : 'lines'} rejected so far
        </p>
      </header>
      <ol className="desk-log" aria-live="off">
        {shown.map((s, i) => {
          const d = describe(s)
          return (
            <li key={`${s.t}-${i}-${s.agent}-${s.action}`} className={`step ${s.agent} ${d.verdict ?? ''}`} ref={i === shown.length - 1 ? end : undefined}>
              <span className="when">{mmss(s.clock)}</span>
              <span className="who">{AGENT[s.agent]}</span>
              {d.verdict && <span className={`verdict ${d.verdict}`}>{d.verdict === 'pass' ? 'PASS' : 'FAIL'}</span>}
              <span className="what">
                {d.body}
                {d.quote && <q>{d.quote}</q>}
              </span>
            </li>
          )
        })}
        {shown.length === 0 && <li className="step empty">Waiting for the first moment worth words…</li>}
      </ol>
    </section>
  )
}
