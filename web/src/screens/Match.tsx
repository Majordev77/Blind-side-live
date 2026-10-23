import { useEffect, useRef, useState } from 'react'
import type { SoundEngine } from '../audio/engine'
import { along } from '../audio/mapping'
import { club, loadMatch } from '../match/data'
import { MatchPlayer, type Snapshot } from '../match/player'
import type { Detail, MatchData } from '../match/types'
import type { Choices } from './Setup'

const LEVELS: Detail[] = ['essentials', 'full', 'analyst']
const LEVEL_NAME: Record<Detail, string> = { essentials: 'Essentials', full: 'Full', analyst: 'Analyst' }
const CONTEXT_BEFORE = 20 // seconds of play before the best three minutes

const clockText = (s: number) => {
  const m = Math.floor(s / 60)
  return `${String(m).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`
}

/** The match screen: a huge score, a live caption, the ear bar and five controls in a fixed order. */
export function Match({ engine, choices }: { engine: SoundEngine; choices: Choices }) {
  const [data, setData] = useState<MatchData | null>(null)
  const [snap, setSnap] = useState<Snapshot | null>(null)
  const [detail, setDetail] = useState<Detail>(choices.detail)
  const [announce, setAnnounce] = useState('')
  const player = useRef<MatchPlayer | null>(null)

  useEffect(() => {
    let alive = true
    loadMatch(choices.matchId).then((d) => alive && setData(d))
    return () => {
      alive = false
    }
  }, [choices.matchId])

  useEffect(() => {
    if (!data) return
    const name = (code: string) => club(code).name
    const p = new MatchPlayer(engine, data, { listener: choices.listener, mode: choices.mode, detail: choices.detail, follow: null, lang: 'en' }, name)
    p.onCaption = (line) => setAnnounce(line.text)
    player.current = p
    const from = Math.max(0, data.info.best_three_minutes.t - CONTEXT_BEFORE)
    const startCue = data.cues.find((c) => c.t >= from)
    const minute = startCue ? Math.floor(startCue.clock / 60) + 1 : 1
    const goals = data.cues.filter((c) => c.sound === 'goal' && c.t < from).at(-1)?.score ?? { [data.info.home]: 0, [data.info.away]: 0 }
    const intro =
      `You support ${name(choices.listener)}, attacking toward your right ear. ` +
      `${name(data.info.home)} ${goals[data.info.home] ?? 0}, ${name(data.info.away)} ${goals[data.info.away] ?? 0}, minute ${minute}.`
    p.start(from, intro)
    let raf = 0
    const frame = () => {
      setSnap(p.snapshot())
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(raf)
      p.destroy()
      player.current = null
    }
  }, [data, engine, choices])

  const changeDetail = (dir: -1 | 1) => {
    const i = Math.min(LEVELS.length - 1, Math.max(0, LEVELS.indexOf(detail) + dir))
    const next = LEVELS[i] as Detail
    setDetail(next)
    player.current?.setDetail(next)
    setAnnounce(`${LEVEL_NAME[next]} description.`)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && e.target.tagName === 'BUTTON' && (e.key === ' ' || e.key === 'Enter')) return
      if (e.key === 'r' || e.key === 'R') player.current?.repeat()
      else if (e.key === '-' || e.key === 'ArrowDown') changeDetail(-1)
      else if (e.key === '+' || e.key === '=' || e.key === 'ArrowUp') changeDetail(1)
      else if (e.key === ' ' || e.key === 'p' || e.key === 'P') {
        e.preventDefault()
        void player.current?.togglePause()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (!data || !snap) {
    return (
      <main className="match loading" aria-busy="true">
        <p className="label">Loading the match</p>
      </main>
    )
  }

  const home = data.info.home
  const away = data.info.away
  const listenerIsHome = choices.listener === home
  // Show the listener's club on the left, the way they hear it: attacking toward the right.
  const left = listenerIsHome ? home : away
  const right = listenerIsHome ? away : home
  const pos = (along(snap.ball, { listenerIsHome }) + 1) / 2
  const ours = snap.team === choices.listener
  const caption = snap.caption

  return (
    <main className="match">
      <header className="scoreboard" aria-label="Score">
        <div className="side ours">
          <span className="club">{club(left).name}</span>
          <span className="goals">{snap.score[left] ?? 0}</span>
        </div>
        <div className="clock" aria-label={`Minute ${Math.floor(snap.clock / 60) + 1}`}>
          {clockText(snap.clock)}
        </div>
        <div className="side theirs">
          <span className="club">{club(right).name}</span>
          <span className="goals">{snap.score[right] ?? 0}</span>
        </div>
      </header>

      <section className={`caption ${caption?.priority === 1 ? 'caption-big' : ''} ${caption?.moment?.team === choices.listener ? 'caption-ours' : 'caption-theirs'}`}>
        <p className="caption-text">{caption ? caption.text : 'Listening…'}</p>
        {caption && caption.evidence.length > 0 && (
          <p className="evidence">
            {caption.evidence.length} {caption.evidence.length === 1 ? 'event' : 'events'} · {caption.evidence.join(' ')}
          </p>
        )}
      </section>

      <section className="earbar" aria-hidden="true">
        <div className="track">
          <span className={`ball ${ours ? 'ball-ours' : 'ball-theirs'}`} style={{ left: `${pos * 100}%` }} />
        </div>
        <div className="ends">
          <span>Left ear · your goal</span>
          <span>Right ear · you attack</span>
        </div>
      </section>

      <nav className="controls" aria-label="Match controls">
        <button onClick={() => player.current?.repeat()} aria-keyshortcuts="R">
          Repeat
        </button>
        <button onClick={() => changeDetail(-1)} disabled={detail === 'essentials'} aria-keyshortcuts="-">
          Less
        </button>
        <button onClick={() => changeDetail(1)} disabled={detail === 'analyst'} aria-keyshortcuts="+">
          More
        </button>
        <button onClick={() => void player.current?.togglePause()} aria-keyshortcuts="Space" aria-pressed={snap.paused}>
          {snap.paused ? 'Play' : 'Pause'}
        </button>
        <p className="detail-now label">{LEVEL_NAME[detail]}</p>
      </nav>

      <p className="visually-hidden" aria-live="polite" role="log">
        {announce}
      </p>
      {snap.ended && <p className="ended label">Full time for this clip</p>}
    </main>
  )
}
