import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { pickLines, speakingTime, templateLine, BUDGET, type Fixture } from './commentary'
import type { Detail, Moment } from './types'

const moments = JSON.parse(readFileSync(new URL('../../../data/derived/demo_1.moments.json', import.meta.url), 'utf8')) as Moment[]
const NAMES: Record<string, string> = { CRV: 'Corran Vale', OST: 'Ostbury Town' }
const fx: Fixture = { club: (c) => NAMES[c] ?? c, home: 'CRV', away: 'OST', listener: 'CRV' }

describe('template lines', () => {
  it('only uses numbers that are in the moment facts', () => {
    for (const m of moments) {
      for (const level of ['essentials', 'full', 'analyst'] as Detail[]) {
        const text = templateLine(m, level, fx)
        if (!text) continue
        const allowed = new Set(Object.values(m.facts).map(String))
        for (const n of text.match(/\d+(\.\d+)?/g) ?? []) expect(allowed, `${m.type}: "${text}"`).toContain(n)
      }
    }
  })

  it('announces every goal with both clubs in the score', () => {
    const goals = moments.filter((m) => m.type === 'goal')
    for (const g of goals) {
      const text = templateLine(g, 'essentials', fx) ?? ''
      expect(text).toMatch(/Corran Vale \d+, Ostbury Town \d+\./)
      expect(text).toContain(String(g.facts.scorer))
    }
  })
})

describe('speaking budget', () => {
  it('always airs every goal at every level', () => {
    for (const level of ['essentials', 'full', 'analyst'] as Detail[]) {
      const lines = pickLines(moments, level, fx)
      expect(lines.filter((l) => l.moment?.type === 'goal')).toHaveLength(moments.filter((m) => m.type === 'goal').length)
    }
  })

  it('says more at higher detail levels', () => {
    const n = (level: Detail) => pickLines(moments, level, fx).length
    expect(n('essentials')).toBeLessThan(n('full'))
    expect(n('full')).toBeLessThanOrEqual(n('analyst'))
  })

  it('keeps essentials free of class 3 colour', () => {
    expect(pickLines(moments, 'essentials', fx).every((l) => l.priority <= 2)).toBe(true)
  })

  it('never goes far over the per-minute budget', () => {
    for (const level of ['essentials', 'full', 'analyst'] as Detail[]) {
      const lines = pickLines(moments, level, fx)
      for (const l of lines) {
        const minute = lines.filter((x) => x.moment && l.moment && x.moment.t > l.moment.t - 60 && x.moment.t <= l.moment.t)
        const secs = minute.filter((x) => x.priority > 1).reduce((a, x) => a + speakingTime(x.text), 0)
        expect(secs).toBeLessThanOrEqual(BUDGET[level] + 1)
      }
    }
  })
})
