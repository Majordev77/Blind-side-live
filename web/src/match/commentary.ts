/**
 * Template commentary: the safety net under the agents.
 *
 * Each moment type has a plain sentence built only from the moment's facts,
 * so it can never state anything the data does not support. The agent
 * pipeline (agents/) writes richer, verified lines; when a line is missing,
 * late or rejected, these templates are what the listener hears.
 *
 * pickLines() applies a speaking budget per detail level, like the editor:
 * class 1 (goals) always airs, class 2 when the budget allows, class 3 only
 * in quiet spells.
 */

import type { Detail, Moment } from './types'

export interface Line {
  id: string
  t: number
  /** Latest match time at which the line may still start. */
  expires: number
  priority: 1 | 2 | 3
  text: string
  evidence: string[]
  /** The moment the line is about; null for lines like the kickoff orientation. */
  moment: Moment | null
}

type Names = (code: string) => string

/** Who is playing and who the listener supports. */
export interface Fixture {
  club: Names
  home: string
  away: string
  listener: string
}

const num = (v: unknown) => (typeof v === 'number' ? v : Number(v))

/** One sentence for a moment, from its facts only. Returns null if there is nothing safe to say. */
export function templateLine(m: Moment, level: Detail, fx: Fixture): string | null {
  const { club, listener } = fx
  const f = m.facts
  const team = typeof f.team === 'string' ? club(f.team) : ''
  const ours = m.team === listener
  switch (m.type) {
    case 'goal': {
      const lead = ours ? 'Goal! ' : 'Goal for ' + team + '. '
      const who = ours ? `${f.scorer} scores for ${team}.` : `${f.scorer} scores.`
      const assist = level !== 'essentials' && f.assist ? ` Set up by ${f.assist}.` : ''
      const finish = level === 'analyst' ? ` From ${num(f.shot_distance_m)} metres, at ${num(f.shot_speed_kmh)} kilometres an hour.` : ''
      return `${lead}${who}${assist}${finish} ${scoreline(m, fx)}`
    }
    case 'big_chance': {
      const what = f.outcome === 'on_target' ? 'saved' : f.outcome === 'blocked' ? 'blocked' : 'wide'
      const extra = level === 'analyst' ? ` That was a ${num(f.chance_quality_pct)} percent chance.` : ''
      return `Big chance for ${f.shooter}, ${what}!${extra}`
    }
    case 'high_turnover': {
      const n = num(f.turnovers_in_final_third_last_5min)
      const base = `${f.player} wins it back high up for ${team}.`
      if (level === 'essentials' || n < 3) return base
      return `${base} That is ${n} times in the last five minutes.`
    }
    case 'momentum_swing':
      return level === 'essentials'
        ? `${team} on top now.`
        : `${team} have taken control. ${num(f.shots_last_5min)} shots to ${num(f.opponent_shots_last_5min)} in the last five minutes.`
    case 'hard_pass':
      return level === 'analyst'
        ? `Superb pass from ${f.passer} to ${f.receiver}. Only a ${num(f.completion_chance_pct)} percent pass.`
        : `Superb pass from ${f.passer} to ${f.receiver}.`
    case 'long_move':
      return `${team} keep the ball: ${num(f.passes_in_move)} passes in this move.`
    case 'press_change':
      return f.direction === 'up' ? `${team} are pressing much higher now.` : `${team} have dropped off. Less pressure on the ball.`
    case 'milestone':
      if (f.completed_passes) return `${f.player} has completed ${num(f.completed_passes)} passes.`
      if (f.team_shots) return `That is shot number ${num(f.team_shots)} for ${team}.`
      if (f.first_shot_on_target_of_match) return `The first shot on target of the match, from ${f.player}.`
      return null
    case 'drought':
      return `${team} have not had a shot for ${num(f.minutes_without_a_shot)} minutes.`
    case 'sprint':
      return level === 'essentials' ? null : `${f.player} flies forward at ${num(f.speed_kmh)} kilometres an hour.`
    default:
      return null
  }
}

function scoreline(m: Moment, fx: Fixture): string {
  return `${fx.club(fx.home)} ${num(m.facts.score_home)}, ${fx.club(fx.away)} ${num(m.facts.score_away)}.`
}

/** Seconds of speech per minute allowed at each detail level (the editor's budget). */
export const BUDGET: Record<Detail, number> = { essentials: 12, full: 25, analyst: 35 }
const MAX_CLASS: Record<Detail, number> = { essentials: 2, full: 3, analyst: 3 }

/** Rough speaking time of a line, in seconds. */
export const speakingTime = (text: string) => 0.4 + text.split(/\s+/).length / 2.6

/** Choose which moments get words, in time order, within the speaking budget. */
export function pickLines(moments: Moment[], level: Detail, fx: Fixture): Line[] {
  const out: Line[] = []
  const spoken: { t: number; secs: number }[] = []
  let lastEnd = -1e9
  for (const m of moments) {
    if (m.class > MAX_CLASS[level]) continue
    const text = templateLine(m, level, fx)
    if (!text) continue
    const secs = speakingTime(text)
    const used = spoken.filter((s) => s.t > m.t - 60).reduce((a, s) => a + s.secs, 0)
    const quiet = m.t - lastEnd
    if (m.class === 2 && (used + secs > BUDGET[level] || quiet < 4)) continue
    if (m.class === 3 && (used + secs > BUDGET[level] * 0.7 || quiet < 20)) continue
    out.push({
      id: m.moment_id,
      t: m.t + 0.6,
      expires: m.t + (m.class === 1 ? 20 : 6),
      priority: m.class,
      text,
      evidence: m.evidence,
      moment: m,
    })
    spoken.push({ t: m.t, secs })
    lastEnd = Math.max(lastEnd, m.t) + secs
  }
  return out
}
