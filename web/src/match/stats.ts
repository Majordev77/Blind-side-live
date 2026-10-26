import type { Cue } from './types'

export interface TeamStats {
  team: string
  possession: number
  shots: number
  accuracy: number
}

/** Possession (share of passes), shots and pass accuracy over the first `upto` cues. */
export function statsTo(cues: Cue[], upto: number, home: string, away: string): TeamStats[] {
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
