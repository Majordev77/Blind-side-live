import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseCues } from './data'
import { buildCalls, buildUp, zoneOf, type Names } from './playbyplay'

const root = new URL('../../../', import.meta.url)
const read = (path: string) => readFileSync(new URL(path, root), 'utf8')
const league = JSON.parse(read('data/league.json')) as {
  clubs: { code: string; name: string; players: { id: string; short_name: string }[] }[]
}
const surname = new Map(league.clubs.flatMap((c) => c.players.map((p) => [p.id, p.short_name] as const)))
const clubName = new Map(league.clubs.map((c) => [c.code, c.name] as const))

function demo(id: string) {
  const meta = JSON.parse(read(`data/matches/${id}.match.json`)) as {
    home: { code: string }
    away: { code: string }
    demo: { best_three_minutes: { t: number } }
  }
  const cues = parseCues(read(`data/derived/${id}.cues.jsonl`))
  const names: Names = {
    home: meta.home.code,
    away: meta.away.code,
    club: (c) => clubName.get(c) ?? c,
    player: (p) => surname.get(p) ?? p,
  }
  return { meta, cues, names }
}

describe('zones', () => {
  it('describes the pitch from the point of view of the team on the ball', () => {
    expect(zoneOf([98, 34], 'CRV', 'CRV')).toBe('box')
    expect(zoneOf([7, 34], 'OST', 'CRV')).toBe('box') // the away side attacks toward x = 0
    expect(zoneOf([8, 34], 'CRV', 'CRV')).toBe('own_box')
    expect(zoneOf([80, 60], 'CRV', 'CRV')).toBe('left')
    expect(zoneOf([80, 8], 'CRV', 'CRV')).toBe('right')
    expect(zoneOf([60, 34], 'CRV', 'CRV')).toBe('opp_half')
  })
})

describe.each(['demo_1', 'demo_2', 'demo_3'])('calls for %s', (id) => {
  const { meta, cues, names } = demo(id)
  const calls = buildCalls(cues, names, 'en')

  it('only names players who were in the cue the call is built from', () => {
    const byEvent = new Map(cues.map((c) => [c.event, c]))
    const allSurnames = new Set(surname.values())
    for (const call of calls.filter((c) => c.kind !== 'buildup')) {
      const cue = byEvent.get(call.evidence[0] as string)
      expect(cue).toBeDefined()
      const allowed = new Set([cue?.player, cue?.recipient].filter(Boolean).map((p) => surname.get(p as string)))
      for (const word of call.text.replace(/[.,!?]/g, '').split(' ')) {
        if (allSurnames.has(word)) expect(allowed, call.text).toContain(word)
      }
    }
  })

  it('never crowds name calls closer than the minimum gap', () => {
    const touches = calls.filter((c) => c.kind === 'touch')
    for (let i = 1; i < touches.length; i++) {
      expect((touches[i] as { t: number }).t - (touches[i - 1] as { t: number }).t).toBeGreaterThanOrEqual(1.39)
    }
  })

  it('never says the same name twice in a row', () => {
    const named = calls.filter((c) => c.kind === 'touch').map((c) => c.text.split(/[ ,.]/)[0])
    for (let i = 1; i < named.length; i++) {
      if (named[i] === 'Driving') continue
      if (named[i] === named[i - 1]) {
        const a = calls.filter((c) => c.kind === 'touch')[i - 1] as { t: number }
        const b = calls.filter((c) => c.kind === 'touch')[i] as { t: number }
        // a one-two can bring the ball straight back, but never a name on top of itself
        expect(b.t - a.t, `${named[i]} repeated`).toBeGreaterThan(4)
      }
    }
  })

  it('calls every goal with the final score so far, then the build-up', () => {
    const goalCues = cues.filter((c) => c.sound === 'goal')
    const goals = calls.filter((c) => c.text.startsWith('GOAL'))
    expect(goals).toHaveLength(goalCues.length)
    goalCues.forEach((g, i) => {
      const s = g.score ?? {}
      const score = `${names.club(names.home)} ${s[names.home]}, ${names.club(names.away)} ${s[names.away]}.`
      expect(goals[i]?.text).toContain(score)
      expect(goals[i]?.text).toContain(names.player(g.player as string))
    })
    expect(calls.filter((c) => c.kind === 'buildup').length).toBe(goalCues.length)
  })

  it('gives every goal a build-up that ends with the scorer', () => {
    cues.forEach((c, i) => {
      if (c.sound !== 'goal') return
      const b = buildUp(cues, i, names, 'en')
      const scorer = names.player(c.player as string)
      expect(b?.text.endsWith('.')).toBe(true)
      expect(b?.text.includes(`${scorer} finished`) || b?.text.includes('and scored')).toBe(true)
      expect(b?.text.split(scorer).length).toBeLessThanOrEqual(2) // the scorer is named once
    })
  })

  it('keeps the caller busy through the best three minutes', () => {
    const start = meta.demo.best_three_minutes.t
    const window = calls.filter((c) => c.t >= start && c.t < start + 180)
    expect(window.length).toBeGreaterThan(25)
    if (id === 'demo_1') {
      const mmss = (t: number) => {
        const s = cues.find((c) => c.t >= t)?.clock ?? 0
        return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`
      }
      console.log(window.slice(0, 45).map((c) => `${mmss(c.t)} [${c.kind}] ${c.text}`).join('\n'))
    }
  })
})

describe('pidgin', () => {
  it('calls in Pidgin', () => {
    const { cues, names } = demo('demo_1')
    const calls = buildCalls(cues, names, 'pcm')
    expect(calls.some((c) => c.text.includes('don score'))).toBe(true)
    expect(calls.some((c) => c.text.includes('How the goal take happen'))).toBe(true)
  })
})
