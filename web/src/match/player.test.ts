import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { SoundEngine } from '../audio/engine'
import { parseCues } from './data'
import { MatchPlayer } from './player'
import type { MatchData, Moment } from './types'

const root = new URL('../../../', import.meta.url)
const read = (p: string) => readFileSync(new URL(p, root), 'utf8')
const league = JSON.parse(read('data/league.json')) as { clubs: { code: string; name: string; players: { id: string; short_name: string }[] }[] }
const surname = new Map(league.clubs.flatMap((c) => c.players.map((p) => [p.id, p.short_name] as const)))
const clubName = new Map(league.clubs.map((c) => [c.code, c.name] as const))
const meta = JSON.parse(read('data/matches/demo_1.match.json')) as { home: { code: string }; away: { code: string }; demo: { best_three_minutes: { t: number; clock: number } } }

const data: MatchData = {
  info: { match_id: 'demo_1', home: meta.home.code, away: meta.away.code, goals: 0, best_three_minutes: meta.demo.best_three_minutes },
  home: { code: meta.home.code, name: clubName.get(meta.home.code) ?? '', players: [] },
  away: { code: meta.away.code, name: clubName.get(meta.away.code) ?? '', players: [] },
  cues: parseCues(read('data/derived/demo_1.cues.jsonl')),
  moments: JSON.parse(read('data/derived/demo_1.moments.json')) as Moment[],
}

/** A sound engine that makes no sound, so the player can run under test. */
const silent = { now: 0, ctx: {}, configure() {}, start() {}, stop() {}, play() {}, setDuck() {} } as unknown as SoundEngine

function playerAt(t: number, lang: 'en' | 'pcm' = 'en') {
  const names = { home: data.info.home, away: data.info.away, club: (c: string) => clubName.get(c) ?? c, player: (id: string) => surname.get(id) ?? id }
  const p = new MatchPlayer(silent, data, { listener: data.info.home, mode: 'headphones', detail: 'full', follow: null, lang }, names, null)
  ;(p as unknown as { clock: { anchor: (t: number) => void; buffer: number } }).clock.buffer = 0
  ;(p as unknown as { clock: { anchor: (t: number) => void } }).clock.anchor(t)
  return p
}

describe("where's the ball", () => {
  it('names the player on the ball, where, the club, the minute and the score', () => {
    // just after a completed pass has arrived: the receiver has the ball
    const pass = data.cues.find((c) => c.sound === 'pass' && c.outcome === 'complete' && c.recipient && c.t > data.info.best_three_minutes.t)
    expect(pass).toBeDefined()
    const t = (pass?.t ?? 0) + (pass?.duration ?? 0) + 0.05
    const text = playerAt(t).whereIsBall()
    expect(text).toContain(`${surname.get(pass?.recipient as string)} has the ball`)
    expect(text).toContain(`for ${clubName.get(pass?.team as string)}`)
    expect(text).toMatch(/Minute \d+\./)
    expect(text).toMatch(/(lead \d+ \d+|level at \d+ each)\.$/)
  })

  it('reports the score correctly after every goal', () => {
    const goals = data.cues.filter((c) => c.sound === 'goal')
    const last = goals.at(-1)
    const s = last?.score ?? {}
    const text = playerAt((last?.t ?? 0) + 1).whereIsBall()
    const h = s[data.info.home] ?? 0
    const a = s[data.info.away] ?? 0
    expect(text).toContain(h === a ? `level at ${h} each` : `${Math.max(h, a)} ${Math.min(h, a)}`)
  })

  it('answers in Pidgin', () => {
    expect(playerAt(data.info.best_three_minutes.t + 30, 'pcm').whereIsBall()).toMatch(/^(Na .+ get the ball|Minute)/)
  })
})

describe('skip to full time', () => {
  it('jumps to the last thirty seconds and never goes backwards', () => {
    const last = data.cues.at(-1)?.t ?? 0
    const p = playerAt(data.info.best_three_minutes.t)
    p.skipToFullTime()
    expect(p.now).toBeCloseTo(last - 30, 1)
    const late = playerAt(last - 5)
    late.skipToFullTime()
    expect(late.now).toBeCloseTo(last - 5, 1)
  })
})
