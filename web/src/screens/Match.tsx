import { useEffect, useRef, useState } from 'react'
import type { SoundEngine } from '../audio/engine'
import { along } from '../audio/mapping'
import { club, loadAgentLines, loadMatch, SURNAMES, type AgentLine } from '../match/data'
import { MatchPlayer, type Snapshot } from '../match/player'
import { runTutorial } from '../match/tutorial'
import type { Detail, MatchData } from '../match/types'
import { Recap } from './Recap'
import type { Choices } from './Setup'

const LEVELS: Detail[] = ['essentials', 'full', 'analyst']
const LEVEL_NAME: Record<Detail, string> = { essentials: 'Essentials', full: 'Full', analyst: 'Analyst' }
const CONTEXT_BEFORE = 20 // seconds of play before the best three minutes
const BUILD_UP = 45 // the instant demo starts this long before a goal
const REDRAW_MS = 100

const clockText = (s: number) => {
  const m = Math.floor(s / 60)
  return `${String(m).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`
}

/** Where to start, and whose fan the listener is. The instant demo drops you in just before a goal. */
function plan(data: MatchData, choices: Choices): { from: number; listener: string } {
  const best = data.info.best_three_minutes.t
  if (!choices.instant) return { from: Math.max(0, best - CONTEXT_BEFORE), listener: choices.listener }
  const goal = data.cues.find((c) => c.sound === 'goal' && c.t >= best) ?? data.cues.find((c) => c.sound === 'goal')
  if (!goal?.team) return { from: Math.max(0, best - CONTEXT_BEFORE), listener: data.info.home }
  // You support the side that is about to score, so the first thing you feel is a roar.
  return { from: Math.max(0, goal.t - BUILD_UP), listener: choices.listener === 'auto' ? goal.team : choices.listener }
}

/** The match screen: a huge score, a live caption, the ear bar and five controls in a fixed order. */
export function Match({ engine, choices, onPersonalise }: { engine: SoundEngine; choices: Choices; onPersonalise: () => void }) {
  const [data, setData] = useState<MatchData | null>(null)
  const [agentLines, setAgentLines] = useState<AgentLine[] | null | undefined>(undefined)
  const [snap, setSnap] = useState<Snapshot | null>(null)
  const [detail, setDetail] = useState<Detail>(choices.detail)
  const [announce, setAnnounce] = useState('')
  const [phase, setPhase] = useState<'loading' | 'tutorial' | 'playing'>('loading')
  const [listener, setListener] = useState(choices.listener)
  const player = useRef<MatchPlayer | null>(null)
  const skip = useRef<AbortController | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let alive = true
    setLoadFailed(false)
    // On a weak connection the match data can fail to download: say so and offer a retry, never hang.
    loadMatch(choices.matchId)
      .then((d) => alive && setData(d))
      .catch(() => alive && setLoadFailed(true))
    loadAgentLines(choices.matchId)
      .then((a) => alive && setAgentLines(a?.lines ?? null))
      .catch(() => alive && setAgentLines(null))
    return () => {
      alive = false
    }
  }, [choices.matchId, attempt])

  // Any tap brings back sound the phone suspended; some browsers only allow it inside a gesture.
  useEffect(() => {
    const wake = () => {
      if (engine.wantRunning && !engine.running) void engine.resume()
    }
    window.addEventListener('pointerdown', wake, true)
    window.addEventListener('keydown', wake, true)
    return () => {
      window.removeEventListener('pointerdown', wake, true)
      window.removeEventListener('keydown', wake, true)
    }
  }, [engine])

  useEffect(() => {
    if (!data || agentLines === undefined) return
    let alive = true
    let raf = 0
    const name = (code: string) => club(code).name
    const names = { home: data.info.home, away: data.info.away, club: name, player: (id: string) => SURNAMES.get(id) ?? id }
    const { from, listener: fan } = plan(data, choices)
    setListener(fan)
    const p = new MatchPlayer(engine, data, { listener: fan, mode: choices.mode, detail: choices.detail, follow: null, lang: choices.lang }, names, agentLines)
    p.onCaption = (line) => setAnnounce(line.text)
    player.current = p

    const startCue = data.cues.find((c) => c.t >= from)
    const minute = startCue ? Math.floor(startCue.clock / 60) + 1 : 1
    const goals = data.cues.filter((c) => c.sound === 'goal' && c.t < from).at(-1)?.score ?? { [data.info.home]: 0, [data.info.away]: 0 }
    const score = `${name(data.info.home)} ${goals[data.info.home] ?? 0}, ${name(data.info.away)} ${goals[data.info.away] ?? 0}`
    const intro =
      choices.lang === 'pcm'
        ? `Welcome to the stadium. You dey support ${name(fan)}, dem dey attack go your right ear. Na ${score}, minute ${minute}.`
        : `Welcome to the stadium. You support ${name(fan)}, attacking toward your right ear. It's ${score}, in minute ${minute}.`

    const kickoff = () => {
      if (!alive) return
      setPhase('playing')
      p.start(from, intro)
      // Ten redraws a second is enough for the score, clock and ear bar (which glides between them in CSS),
      // and leaves a phone's main thread free for the sound scheduler and the voice.
      let last = 0
      const frame = (now: number) => {
        if (now - last >= REDRAW_MS) {
          last = now
          setSnap(p.snapshot())
        }
        raf = requestAnimationFrame(frame)
      }
      raf = requestAnimationFrame(frame)
    }

    if (choices.tutorial) {
      setPhase('tutorial')
      const ctrl = new AbortController()
      skip.current = ctrl
      runTutorial(engine, choices.lang, choices.mode, ctrl.signal).then(() => {
        try {
          localStorage.setItem('blindside.tutorial', 'done')
        } catch {
          // private mode: the tutorial will simply play again next time
        }
        kickoff()
      })
    } else {
      kickoff()
    }
    return () => {
      alive = false
      skip.current?.abort()
      cancelAnimationFrame(raf)
      p.destroy()
      player.current = null
    }
  }, [data, agentLines, engine, choices])

  const cycleDetail = () => {
    const next = LEVELS[(LEVELS.indexOf(detail) + 1) % LEVELS.length] as Detail
    setDetail(next)
    player.current?.setDetail(next)
    setAnnounce(`${LEVEL_NAME[next]} description.`)
  }

  const where = () => {
    const text = player.current?.whereIsBall()
    if (text) setAnnounce(text)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && e.target.tagName === 'BUTTON' && (e.key === ' ' || e.key === 'Enter')) return
      const k = e.key.toLowerCase()
      if (phase === 'tutorial' && (k === 'escape' || k === 's')) skip.current?.abort()
      else if (k === 'w' || k === 'b') where()
      else if (k === 'r') player.current?.repeat()
      else if (k === 'd') cycleDetail()
      else if (k === 'f') player.current?.skipToFullTime()
      else if (k === ' ' || k === 'p') {
        e.preventDefault()
        void player.current?.togglePause()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (phase === 'tutorial') {
    return (
      <main className="match tutorial">
        <p className="label">Before kickoff</p>
        <h1 className="tutorial-title">Learn the sounds</h1>
        <ol className="tutorial-steps">
          <li>A pass travels from your left ear to your right.</li>
          <li>The crowd builds as an attack nears goal.</li>
          <li>A shot, then a goal.</li>
          <li>Tap “Where’s the ball?” any time.</li>
        </ol>
        <button className="skip" onClick={() => skip.current?.abort()} aria-keyshortcuts="S">
          Skip to the match
        </button>
      </main>
    )
  }

  if (loadFailed) {
    return (
      <main className="match loading">
        <p className="label" role="alert">The match did not load. Check your connection.</p>
        <button className="skip" onClick={() => setAttempt((n) => n + 1)}>
          Try again
        </button>
      </main>
    )
  }

  if (!data || !snap) {
    return (
      <main className="match loading" aria-busy="true">
        <p className="label">Loading the match</p>
      </main>
    )
  }

  if (snap.ended) {
    return <Recap data={data} listener={listener} lang={choices.lang} agentLines={agentLines ?? null} onPersonalise={onPersonalise} />
  }

  const home = data.info.home
  const away = data.info.away
  const listenerIsHome = listener === home
  // Show the listener's club on the left, the way they hear it: attacking toward the right.
  const left = listenerIsHome ? home : away
  const right = listenerIsHome ? away : home
  const pos = (along(snap.ball, { listenerIsHome }) + 1) / 2
  const ours = snap.team === listener
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

      <section className={`caption caption-${caption?.role ?? 'caller'} ${caption?.rank === 'big' ? 'caption-big' : ''} ${ours ? 'caption-ours' : 'caption-theirs'}`}>
        <p className="label caption-who">{caption?.role === 'analyst' ? (caption.source === 'agents' ? 'Analyst · checked by the verifier' : 'Analyst') : 'Commentary'}</p>
        <p className="caption-text">{caption ? caption.text : 'Listening…'}</p>
        {caption && caption.evidence.length > 0 && (
          <p className="evidence">
            {caption.evidence.length} {caption.evidence.length === 1 ? 'event' : 'events'} · {caption.evidence.slice(0, 6).join(' ')}
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
        <button className="where" onClick={where} aria-keyshortcuts="W">
          Where’s the ball?
        </button>
        <button onClick={() => player.current?.repeat()} aria-keyshortcuts="R">
          Repeat
        </button>
        <button onClick={cycleDetail} aria-keyshortcuts="D" aria-label={`Detail: ${LEVEL_NAME[detail]}. Change`}>
          {LEVEL_NAME[detail]}
        </button>
        <button onClick={() => void player.current?.togglePause()} aria-keyshortcuts="Space" aria-pressed={snap.paused}>
          {snap.paused ? 'Play' : 'Pause'}
        </button>
        <button onClick={onPersonalise}>Personalise</button>
      </nav>
      <button className="to-full-time" onClick={() => player.current?.skipToFullTime()} aria-keyshortcuts="F">
        Skip to full time
      </button>

      {snap.stalled && (
        <button className="stalled" onClick={() => void engine.resume()} role="alert">
          Sound stopped. Tap to carry on.
        </button>
      )}

      <p className="visually-hidden" aria-live="polite" role="log">
        {announce}
      </p>
    </main>
  )
}
