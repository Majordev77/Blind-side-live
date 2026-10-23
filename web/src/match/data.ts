/**
 * Local-mode match data: the demo matches, read from data/ at the repository
 * root and bundled into the app, so the demo needs no network on its critical
 * path. Azure mode will stream the same cue format from Web PubSub instead.
 */

import demos from '../../../data/matches/demos.json'
import league from '../../../data/league.json'
import type { Club, Cue, DemoInfo, MatchData, Moment } from './types'

const cueFiles = import.meta.glob('../../../data/derived/*.cues.jsonl', { query: '?raw', import: 'default' })
const momentFiles = import.meta.glob('../../../data/derived/*.moments.json', { import: 'default' })

export const DEMOS: DemoInfo[] = demos as DemoInfo[]
const CLUBS = new Map<string, Club>((league.clubs as Club[]).map((c) => [c.code, c]))

export function club(code: string): Club {
  const c = CLUBS.get(code)
  if (!c) throw new Error(`Unknown club ${code}`)
  return c
}

/** Player ID to display name, across the whole league. */
export const PLAYER_NAMES = new Map<string, string>(
  (league.clubs as Club[]).flatMap((c) => c.players.map((p) => [p.id, p.name] as const)),
)

export function parseCues(text: string): Cue[] {
  return text
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as Cue)
}

export async function loadMatch(matchId: string): Promise<MatchData> {
  const info = DEMOS.find((d) => d.match_id === matchId)
  const cueLoader = cueFiles[`../../../data/derived/${matchId}.cues.jsonl`]
  const momentLoader = momentFiles[`../../../data/derived/${matchId}.moments.json`]
  if (!info || !cueLoader || !momentLoader) throw new Error(`No data for match ${matchId}`)
  const [cueText, moments] = await Promise.all([cueLoader() as Promise<string>, momentLoader() as Promise<Moment[]>])
  return { info, home: club(info.home), away: club(info.away), cues: parseCues(cueText), moments }
}
