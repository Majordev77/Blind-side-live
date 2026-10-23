/** Types for the data the engine produces. They mirror the schemas in shared/. */

export type Point = [number, number]

/** One timed sound for the phone (shared/cue.schema.json). */
export interface Cue {
  t: number
  clock: number
  type: 'sound'
  sound: 'pass' | 'carry' | 'shot' | 'save' | 'goal' | 'tackle' | 'clearance' | 'out' | 'whistle' | 'restart'
  event: string
  team?: string
  player?: string
  outcome?: string
  subtype?: string
  pressure?: number
  from?: Point
  to?: Point
  duration?: number
  speed_kmh?: number
  distance_m?: number
  difficulty?: number
  xg?: number
  score?: Record<string, number>
}

/** Something worth words (shared/moment.schema.json). */
export interface Moment {
  moment_id: string
  t: number
  clock: number
  minute: number
  type:
    | 'goal'
    | 'big_chance'
    | 'high_turnover'
    | 'hard_pass'
    | 'long_move'
    | 'momentum_swing'
    | 'press_change'
    | 'milestone'
    | 'drought'
    | 'sprint'
  class: 1 | 2 | 3
  score: number
  team: string | null
  players: string[]
  evidence: string[]
  facts: Record<string, string | number | boolean>
}

export interface Club {
  code: string
  name: string
  players: { id: string; name: string; short_name: string; shirt: number; position: string; role: string }[]
}

export interface DemoInfo {
  match_id: string
  home: string
  away: string
  goals: number
  best_three_minutes: { t: number; clock: number }
}

export interface MatchData {
  info: DemoInfo
  home: Club
  away: Club
  cues: Cue[]
  moments: Moment[]
}

export type AudioMode = 'headphones' | 'speakers' | 'one-ear'
export type Detail = 'essentials' | 'full' | 'analyst'
