import { useEffect, useRef, useState } from 'react'
import type { SoundEngine } from '../audio/engine'
import type { AgentLine } from '../match/data'
import type { Names } from '../match/playbyplay'
import { MatchPlayer, type PlayerSettings } from '../match/player'
import type { MatchData } from '../match/types'

const BEFORE = 15 // seconds of build-up before the goal
const AFTER = 14 // and of celebration after it
const LEAD = 5.5 // the player's spoken intro before the clip

interface Fan {
  label: string
  settings: PlayerSettings
  chips: string[]
  intro: string
}

/** The same goal, heard by two different fans, one after the other. */
export function TwoFans({ engine, data, names, agentLines }: { engine: SoundEngine; data: MatchData; names: Names; agentLines: AgentLine[] | null }) {
  const best = data.info.best_three_minutes.t
  const goal = data.cues.find((c) => c.sound === 'goal' && c.t >= best) ?? data.cues.find((c) => c.sound === 'goal')
  const scorerTeam = goal?.team ?? data.info.home
  const otherTeam = scorerTeam === data.info.home ? data.info.away : data.info.home
  const scorer = goal?.player ?? null
  const fans: Fan[] = [
    {
      label: 'Fan 1',
      settings: { listener: scorerTeam, lang: 'en', detail: 'analyst', mode: 'headphones', follow: scorer },
      chips: ['English', `Supports ${names.club(scorerTeam)}`, 'Analyst', 'Headphones', ...(scorer ? [`Following ${names.player(scorer)}`] : [])],
      intro: `Fan one. English, analyst detail, supporting ${names.club(scorerTeam)}${scorer ? `, following ${names.player(scorer)}` : ''}.`,
    },
    {
      label: 'Fan 2',
      settings: { listener: otherTeam, lang: 'pcm', detail: 'essentials', mode: 'one-ear', follow: null },
      chips: ['Nigerian Pidgin', `Supports ${names.club(otherTeam)}`, 'Essentials', 'One ear'],
      intro: `Fan two. Pidgin, essentials, one ear. Dem dey support ${names.club(otherTeam)}.`,
    },
  ]

  const [stage, setStage] = useState<-1 | 0 | 1 | 2>(-1)
  const [heard, setHeard] = useState<string[][]>([[], []])
  const active = useRef<MatchPlayer | null>(null)
  const timer = useRef<number | null>(null)

  const stop = () => {
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = null
    active.current?.destroy()
    active.current = null
  }
  useEffect(() => stop, [])

  const play = (i: 0 | 1, chain = true) => {
    stop()
    if (!goal) return
    const fan = fans[i] as Fan
    setStage(i)
    setHeard((h) => h.map((lines, j) => (j === i ? [] : lines)))
    const p = new MatchPlayer(engine, data, fan.settings, names, agentLines)
    p.onCaption = (line) => {
      if (line.id === 'intro') return
      setHeard((h) => h.map((lines, j) => (j === i ? [...lines, line.text] : lines)))
    }
    active.current = p
    p.start(Math.max(0, goal.t - BEFORE), fan.intro)
    timer.current = window.setTimeout(() => {
      stop()
      if (i === 0 && chain) play(1)
      else setStage(2)
    }, (BEFORE + AFTER + LEAD) * 1000)
  }

  if (!goal) return <p className="label">This match has no goal to compare.</p>

  return (
    <section className="twofans" aria-label="Two fans, one moment">
      <header className="twofans-head">
        <div>
          <p className="label">Two fans, one moment</p>
          <h2 className="twofans-title">
            {names.player(goal.player as string)}’s goal, minute {Math.floor(goal.clock / 60) + 1}
          </h2>
          <p className="twofans-sub">The same events, the same agents. Different words, a different language and a different sound mix.</p>
        </div>
        <button className="play-both" onClick={() => play(0)} disabled={stage === 0 || stage === 1}>
          {stage === -1 ? 'Play both fans' : stage === 2 ? 'Play again' : 'Playing…'}
        </button>
      </header>
      <div className="fans">
        {fans.map((fan, i) => (
          <article key={fan.label} className={`fan ${stage === i ? 'fan-live' : ''} ${i === 0 ? 'fan-a' : 'fan-b'}`}>
            <header>
              <h3 className="label">
                {fan.label}
                {stage === i ? ' · listening now' : ''}
              </h3>
              <ul className="chips">
                {fan.chips.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </header>
            <ol className="heard">
              {(heard[i] ?? []).map((t, k) => (
                <li key={k} className={t.startsWith('GOAL') ? 'goal-line' : ''}>
                  {t}
                </li>
              ))}
              {(heard[i] ?? []).length === 0 && <li className="waiting">{stage === -1 ? 'Press play to hear this fan’s match.' : 'Waiting…'}</li>}
            </ol>
            <button className="replay" onClick={() => play(i as 0 | 1, false)} disabled={stage === 0 || stage === 1}>
              Hear {fan.label.toLowerCase()} only
            </button>
          </article>
        ))}
      </div>
    </section>
  )
}
