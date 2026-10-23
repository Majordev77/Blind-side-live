import { describe, expect, it } from 'vitest'
import { dueCues, MatchClock } from './clock'
import { along, ballFrequency, danger, panFor, pressureRate } from './mapping'

const home = { listenerIsHome: true }
const away = { listenerIsHome: false }

describe('mapping', () => {
  it("puts the goal the listener attacks in the right ear, whichever side they support", () => {
    expect(along([105, 34], home)).toBe(1)
    expect(along([0, 34], home)).toBe(-1)
    expect(along([0, 34], away)).toBe(1)
    expect(panFor([105, 34], home, 'speakers')).toBe(1)
    expect(panFor([0, 34], away, 'speakers')).toBe(1)
  })

  it('drops panning in one-ear mode and carries length in pitch instead', () => {
    expect(panFor([100, 10], home, 'one-ear')).toBe(0)
    const near = ballFrequency([5, 34], home, 'one-ear')
    const far = ballFrequency([100, 34], home, 'one-ear')
    expect(far).toBeGreaterThan(near * 2)
  })

  it('raises pitch toward the far touchline in stereo, over one octave', () => {
    expect(ballFrequency([50, 0], home, 'headphones')).toBeCloseTo(300)
    expect(ballFrequency([50, 68], home, 'headphones')).toBeCloseTo(600)
  })

  it('opens the danger filter near either goal only', () => {
    expect(danger([52.5, 34])).toBe(0)
    expect(danger([104, 34])).toBeGreaterThan(0.9)
    expect(danger([1, 34])).toBeGreaterThan(0.9)
  })

  it('maps pressure to 2 to 8 pulses a second', () => {
    expect(pressureRate(0)).toBe(2)
    expect(pressureRate(1)).toBe(8)
    expect(pressureRate(5)).toBe(8)
  })
})

describe('clock', () => {
  it('schedules by match time plus a playout buffer, not on arrival', () => {
    let now = 10
    const clock = new MatchClock(() => now)
    clock.anchor(100)
    expect(clock.audioTime(100)).toBeCloseTo(10.15)
    expect(clock.audioTime(103)).toBeCloseTo(13.15)
    now = 12
    expect(clock.matchTime()).toBeCloseTo(101.85)
  })

  it('drops cues that arrive after their play time', () => {
    let now = 0
    const clock = new MatchClock(() => now)
    clock.anchor(0)
    now = 5
    expect(clock.isLate(2)).toBe(true)
    expect(clock.isLate(6)).toBe(false)
  })

  it('hands over only the cues inside the look-ahead window', () => {
    const now = 0
    const clock = new MatchClock(() => now)
    clock.anchor(10)
    const cues = [{ t: 9 }, { t: 10 }, { t: 11 }, { t: 13 }]
    const first = dueCues(cues, 0, clock, 2)
    expect(first.due.map((c) => c.t)).toEqual([9, 10, 11])
    expect(first.next).toBe(3)
  })

  it('runs faster when sped up', () => {
    let now = 0
    const clock = new MatchClock(() => now, 4)
    clock.anchor(0)
    now = 1.15
    expect(clock.matchTime()).toBeCloseTo(4)
  })
})
