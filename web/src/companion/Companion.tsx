import { useEffect, useMemo, useRef, useState } from 'react'
import { SoundEngine } from '../audio/engine'
import { primeSpeech } from '../audio/speech'
import { club, DEMOS, loadAgentLines, loadAgentLog, loadMatch, SURNAMES, type AgentLine, type AgentStep } from '../match/data'
import type { Names } from '../match/playbyplay'
import { MatchPlayer, type Snapshot } from '../match/player'
import type { Cue, MatchData, Point } from '../match/types'
import { AgentDesk } from './AgentDesk'
import { Pitch } from './Pitch'
import { TwoFans } from './TwoFans'
import './companion.css'

const TRAIL = 9
const BUILD_UP = 45

const mmss = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`

function shirtOf(id: string, data: MatchData): number | undefined {
  return [...data.home.players, ...data.away.players].find((p) => p.id === id)?.shirt
}

/** Possession (share of passes), shots and pass accuracy so far, from the cues. */
function statsTo(cues: Cue[], upto: number, home: string, away: string) {
  const s = { [home]: { passes: 0, done: 0, shots: 0 }, [away]: { passes: 0, done: 0, shots: 0 } } as Record<string, { passes: number; done: number; shots: number }>
  for (let i = 0; i < upto; i++) {
    const c = cues[i] as Cue
    const row = c.team ? s[c.team] : undefined
    if (!row) continue
    if (c.sound === 'pass') {
      row.passes++
      if (c.outcome === 'complete') row.done++
    } else if (c.sound === 'shot') row.shots++
  }
  const total = (s[home]?.passes ?? 0) + (s[away]?.passes ?? 0) || 1
  return [home, away].map((t) => ({
    team: t,
    possession: Math.round(((s[t]?.passes ?? 0) / total) * 100),
    shots: s[t]?.shots ?? 0,
    accuracy: s[t]?.passes ? Math.round(((s[t]?.done ?? 0) / (s[t]?.passes ?? 1)) * 100) : 0,
  }))
}

/**
 * The companion screen, for a sighted friend, a broadcaster or a judge: the
 * same match the listener hears, as a live 2D pitch, commentary cards with
 * their evidence, and the agents at work.
 */
export function Companion() {
  const [matchId, setMatchId] = useState(DEMOS[0]?.match_id ?? 'demo_1')
  const [data, setData] = useState<MatchData | null>(null)
  const [lines, setLines] = useState<{ provider: string; model: string; lines: AgentLine[] } | null | undefined>(undefined)
  const [log, setLog] = useState<AgentStep[]>([])
  const [engine, setEngine] = useState<SoundEngine | null>(null)
  const [view, setView] = useState<'live' | 'twofans'>('live')
  const [snap, setSnap] = useState<Snapshot | null>(null)
  const [now, setNow] = useState(0)
  const [showEvidence, setShowEvidence] = useState(false)
  const player = useRef<MatchPlayer | null>(null)

  useEffect(() => {
    let alive = true
    setData(null)
    setLines(undefined)
    loadMatch(matchId).then((d) => alive && setData(d))
    loadAgentLines(matchId).then((l) => alive && setLines(l)).catch(() => alive && setLines(null))
    loadAgentLog(matchId).then((l) => alive && setLog(l ?? [])).catch(() => alive && setLog([]))
    return () => {
      alive = false
    }
  }, [matchId])

  const names: Names | null = useMemo(
    () => (data ? { home: data.info.home, away: data.info.away, club: (c: string) => club(c).name, player: (id: string) => SURNAMES.get(id) ?? id } : null),
    [data],
  )
  const goal = data?.cues.find((c) => c.sound === 'goal' && c.t >= data.info.best_three_minutes.t)
  const fan = goal?.team ?? data?.info.home ?? ''

  // The live match: the same player the phone uses, in speakers mode for a laptop.
  useEffect(() => {
    if (!engine || !data || !names || lines === undefined || view !== 'live') return
    const p = new MatchPlayer(engine, data, { listener: fan, mode: 'speakers', detail: 'full', follow: null, lang: 'en' }, names, lines?.lines ?? null)
    player.current = p
    const from = goal ? Math.max(0, goal.t - BUILD_UP) : Math.max(0, data.info.best_three_minutes.t - 20)
    p.start(from, `Welcome to the stadium. ${names.club(data.info.home)} against ${names.club(data.info.away)}.`)
    let raf = 0
    const frame = () => {
      setSnap(p.snapshot())
      setNow(p.now)
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(raf)
      p.destroy()
      player.current = null
    }
  }, [engine, data, names, lines, view, fan, goal])

  const begin = async () => {
    const e = engine ?? new SoundEngine()
    primeSpeech()
    try {
      await e.unlock()
    } catch {
      return
    }
    await e.loadSamples()
    setEngine(e)
  }

  const idx = useMemo(() => {
    if (!data) return 0
    let i = 0
    while (i < data.cues.length && (data.cues[i] as Cue).t <= now) i++
    return i
  }, [data, now])
  const secondKey = Math.floor(now)
  const stats = useMemo(() => (data ? statsTo(data.cues, idx, data.info.home, data.info.away) : []), [data, secondKey]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!data || !names) {
    return (
      <main className="companion loading">
        <p className="label">Loading the match</p>
      </main>
    )
  }

  const trail = data.cues.slice(0, idx).filter((c) => c.from && c.team).slice(-TRAIL)
  const holder = player.current?.onBall(now) ?? null
  const holderCue = holder?.cue
  const badge = holderCue?.sound === 'shot' && holderCue.speed_kmh
    ? `${Math.round(holderCue.speed_kmh)} KM/H`
    : holderCue?.sound === 'carry' && (holderCue.speed_kmh ?? 0) >= 25
      ? `${Math.round(holderCue.speed_kmh ?? 0)} KM/H`
      : holderCue?.sound === 'pass' && (holderCue.difficulty ?? 0) >= 4
        ? `DIFFICULTY ${holderCue.difficulty}`
        : undefined
  const tag = holder ? { name: names.player(holder.player), shirt: shirtOf(holder.player, data), team: holder.team, badge } : null
  const caption = snap?.caption ?? null
  const evidenceIds = new Set(showEvidence && caption ? caption.evidence : [])
  const evidence: Point[] = data.cues.filter((c) => evidenceIds.has(c.event) && c.from).map((c) => c.from as Point)
  const steps = log.filter((s) => s.t <= now)
  const score = snap?.score ?? {}

  return (
    <main className="companion">
      <header className="c-top">
        <div className="c-score" aria-label="Score">
          <span className="home">{names.club(data.info.home)}</span>
          <span className="digits">
            {score[data.info.home] ?? 0} – {score[data.info.away] ?? 0}
          </span>
          <span className="away">{names.club(data.info.away)}</span>
          <span className="c-clock">{mmss(snap?.clock ?? 0)}</span>
        </div>
        <nav className="c-tabs" aria-label="View">
          <button aria-pressed={view === 'live'} onClick={() => setView('live')}>
            Live match
          </button>
          <button aria-pressed={view === 'twofans'} onClick={() => setView('twofans')}>
            Two fans, one moment
          </button>
        </nav>
        <label className="c-match">
          <span className="label">Match</span>
          <select value={matchId} onChange={(e) => setMatchId(e.target.value)}>
            {DEMOS.map((d) => (
              <option key={d.match_id} value={d.match_id}>
                {club(d.home).name} v {club(d.away).name}
              </option>
            ))}
          </select>
        </label>
      </header>

      {!engine ? (
        <section className="c-start">
          <p className="label">Companion screen</p>
          <h1>See what a blind fan hears</h1>
          <p>The pitch, the commentary and the agents, in step with the sound. Turn your sound on.</p>
          <button onClick={begin}>Start the match</button>
        </section>
      ) : view === 'twofans' ? (
        <TwoFans engine={engine} data={data} names={names} agentLines={lines?.lines ?? null} />
      ) : (
        <div className="c-grid">
          <div className="c-main">
            <Pitch ball={snap?.ball ?? [52.5, 34]} trail={trail} home={data.info.home} tag={tag} evidence={evidence} homeName={names.club(data.info.home)} awayName={names.club(data.info.away)} />
            <button
              className={`lower-third ${caption?.role ?? ''} ${caption?.rank === 'big' ? 'big' : ''}`}
              onClick={() => setShowEvidence((v) => !v)}
              aria-pressed={showEvidence}
              aria-label={caption ? `${caption.text}. Show the events behind this line.` : 'Commentary'}
            >
              <span className="lt-who">
                {caption?.role === 'analyst' ? (caption.source === 'agents' ? 'Analyst · verified' : 'Analyst') : 'Commentary'}
                {caption && caption.evidence.length > 0 && <span className="lt-ev"> · {caption.evidence.length} events {showEvidence ? '(shown on the pitch)' : '(tap to show)'}</span>}
              </span>
              <span className="lt-text">{caption?.text ?? 'Listening…'}</span>
            </button>
            <dl className="c-stats">
              {stats.map((s) => (
                <div key={s.team} className={s.team === data.info.home ? 'home' : 'away'}>
                  <dt>{names.club(s.team)}</dt>
                  <dd>
                    <b>{s.possession}%</b> possession · <b>{s.shots}</b> shots · <b>{s.accuracy}%</b> passing
                  </dd>
                </div>
              ))}
            </dl>
          </div>
          <AgentDesk steps={steps} focus={`en:${fan}:full`} provider={lines?.provider ?? 'none'} model={lines?.model ?? ''} />
        </div>
      )}
    </main>
  )
}
