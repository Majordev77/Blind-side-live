import { useEffect, useMemo } from 'react'
import { cancelSpeech, speak, type Lang } from '../audio/speech'
import { club, type AgentLine } from '../match/data'
import { statsTo } from '../match/stats'
import type { MatchData } from '../match/types'

/**
 * The full-time recap: the final score, who scored and when, and the story of
 * the match for this listener's club. The words are the agents' verified recap
 * for this listener (language and club); when there is none, a sentence built
 * only from the goals.
 */
export function Recap({ data, listener, lang, agentLines, onPersonalise }: {
  data: MatchData
  listener: string
  lang: Lang
  agentLines: AgentLine[] | null
  onPersonalise: () => void
}) {
  const { home, away } = data.info
  const final = data.cues.filter((c) => c.sound === 'goal').at(-1)?.score ?? { [home]: 0, [away]: 0 }
  const goals = data.moments.filter((m) => m.type === 'goal')
  const stats = useMemo(() => statsTo(data.cues, data.cues.length, home, away), [data, home, away])
  const agent = agentLines?.find((l) => l.moment_id === 'recap' && l.variant === `${lang}:${listener}:full`)
  const text = agent?.text ?? fallback(data, listener, lang, final)

  const hear = () => speak(text, lang, {}, 'analyst')
  useEffect(() => {
    hear()
    return () => cancelSpeech()
  }, [text]) // eslint-disable-line react-hooks/exhaustive-deps

  // The listener's club on the left, as on the match screen.
  const order = listener === home ? [home, away] : [away, home]

  return (
    <main className="match recap">
      <p className="label">Full time</p>
      <header className="scoreboard" aria-label={`Final score: ${order.map((c) => `${club(c).name} ${final[c] ?? 0}`).join(', ')}`}>
        {order.map((c, i) => (
          <div key={c} className={`side ${i === 0 ? 'ours' : 'theirs'}`}>
            <span className="club">{club(c).name}</span>
            <span className="goals">{final[c] ?? 0}</span>
          </div>
        ))}
      </header>

      <section className="caption caption-analyst">
        <p className="label caption-who">{agent ? 'Recap · checked by the verifier' : 'Recap'}</p>
        <p className="caption-text">{text}</p>
      </section>

      {goals.length > 0 && (
        <section aria-label="Goals">
          <h2 className="label">Goals</h2>
          <ol className="recap-goals">
            {goals.map((g) => (
              <li key={g.moment_id} className={g.team === listener ? 'ours' : 'theirs'}>
                <span className="recap-minute">{g.minute}′</span> {String(g.facts.scorer)}
                <span className="recap-club"> · {club(String(g.team)).name}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      <section aria-label="Match statistics">
        <h2 className="label">The match in numbers</h2>
        <table className="recap-stats">
          <thead>
            <tr>
              <th scope="col"><span className="visually-hidden">Statistic</span></th>
              {order.map((c) => <th key={c} scope="col">{club(c).name}</th>)}
            </tr>
          </thead>
          <tbody>
            {(['possession', 'shots', 'accuracy'] as const).map((k) => (
              <tr key={k}>
                <th scope="row">{k === 'possession' ? 'Possession' : k === 'shots' ? 'Shots' : 'Passing'}</th>
                {order.map((c) => {
                  const v = stats.find((s) => s.team === c)?.[k] ?? 0
                  return <td key={c}>{k === 'shots' ? v : `${v}%`}</td>
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <nav className="controls" aria-label="After the match">
        <button className="where" onClick={hear}>Hear the recap again</button>
        <button onClick={onPersonalise}>Another match</button>
      </nav>
    </main>
  )
}

/** A recap from the goals alone, for when the agents' recap is missing. */
function fallback(data: MatchData, listener: string, lang: Lang, final: Record<string, number>): string {
  const { home, away } = data.info
  const score = `${club(home).name} ${final[home] ?? 0}, ${club(away).name} ${final[away] ?? 0}.`
  const ours = data.moments.filter((m) => m.type === 'goal' && m.team === listener).map((m) => String(m.facts.scorer))
  if (!ours.length) return lang === 'pcm' ? `Full time. ${score}` : `Full time: ${score}`
  const who = ours.join(' and ')
  return lang === 'pcm'
    ? `Full time. ${score} For ${club(listener).name}, na ${who} score.`
    : `Full time: ${score} For ${club(listener).name}, the goals came from ${who}.`
}
