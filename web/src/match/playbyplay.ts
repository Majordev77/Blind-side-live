/**
 * Play-by-play: the caller who tells a blind fan who has the ball and where.
 *
 * Like a video-game commentator, the caller names each player as the ball
 * reaches them, says where on the pitch they are when that changes, names
 * the club whenever possession changes, and calls shots, saves, misses, set
 * pieces and goals. After a goal it describes the build-up: who won the
 * ball, who carried it on, and who finished.
 *
 * Every call is built from the cue stream itself (player IDs, positions,
 * outcomes), so it cannot say anything the match data does not contain.
 */

import type { Cue, Point } from './types'

export type Lang = 'en' | 'pcm'

export interface Call {
  t: number
  /** Latest time the call may start. Calls go stale fast: a late name is worse than none. */
  expires: number
  /** touch: a name as the ball arrives; event: wins, crosses, set pieces; big: shots, saves, goals; buildup: after a goal. */
  kind: 'touch' | 'event' | 'big' | 'buildup'
  text: string
  /** How excited the caller sounds, 0 to 1. */
  energy?: number
  evidence: string[]
}

export interface Names {
  home: string
  away: string
  /** Club name, e.g. "Corran Vale". */
  club: (code: string) => string
  /** A player's surname, as a commentator says it. */
  player: (id: string) => string
}

const LENGTH = 105
const WIDTH = 68

/** A position in the attacking frame of `team`: 0 is their own goal line, 105 the goal they attack. */
function attacking([x, y]: Point, team: string, home: string): Point {
  return team === home ? [x, y] : [LENGTH - x, WIDTH - y]
}

export type Zone = 'own_box' | 'deep' | 'own_half' | 'opp_half' | 'left' | 'right' | 'edge' | 'box'

/** Where the ball is, in words a fan uses, from the point of view of the team on the ball. */
export function zoneOf(p: Point, team: string, home: string): Zone {
  const [ax, ay] = attacking(p, team, home)
  const central = Math.abs(ay - 34) <= 20.15
  if (ax >= 88.5 && central) return 'box'
  if (ax >= 72) return ay > 46 ? 'left' : ay < 22 ? 'right' : 'edge'
  if (ax >= 52.5) return 'opp_half'
  if (ax <= 16.5 && central) return 'own_box'
  if (ax < 30) return 'deep'
  return 'own_half'
}

const ZONE_TEXT: Record<Lang, Record<Zone, string>> = {
  en: {
    own_box: 'in their own box',
    deep: 'deep in their own half',
    own_half: 'in their own half',
    opp_half: 'into their half',
    left: 'down the left',
    right: 'down the right',
    edge: 'at the edge of the box',
    box: 'in the box',
  },
  pcm: {
    own_box: 'for inside their own box',
    deep: 'for their back',
    own_half: 'for their own side',
    opp_half: 'for the other side',
    left: 'for left side',
    right: 'for right side',
    edge: 'for edge of the box',
    box: 'inside the box',
  },
}

export function zoneText(z: Zone, lang: Lang): string {
  return ZONE_TEXT[lang][z]
}

const short = (club: string) => club.split(' ')[0] ?? club

const SAY = {
  en: {
    touch: (n: string) => `${n}.`,
    touchWhere: (n: string, where: string) => `${n}, ${where}.`,
    newTeam: (club: string, n: string, where: string) => `${club} ball. ${n}, ${where}.`,
    won: (n: string, club: string) => `Won back by ${n}! ${club} have it.`,
    cross: (n: string) => `${n} crosses it in...`,
    longBall: (n: string) => `${n}, long ball forward...`,
    shoots: (n: string, where: string) => `${n} shoots, ${where}!`,
    saved: (gk: string) => `Saved by ${gk}!`,
    wide: 'Wide! Just off target.',
    blocked: 'Blocked!',
    goal: (n: string, club: string, score: string) => `GOAL! GOAL for ${club}! ${n} scores! ${score}`,
    corner: (club: string) => `Corner to ${club}.`,
    freeKick: (club: string) => `Free kick to ${club}.`,
    penalty: (club: string) => `Penalty to ${club}!`,
    kickoff: 'And we are under way.',
    restart: (club: string) => `${club} kick off again.`,
    halfTime: 'Half time.',
    secondHalf: 'The second half is under way.',
    fullTime: 'Full time!',
    cleared: 'Cleared!',
    carry: (n: string, where: string) => `${n} drives forward, ${where}...`,
    carryOn: (where: string) => `Driving forward, ${where}...`,
    throwIn: (club: string) => `Throw-in, ${club}.`,
  },
  pcm: {
    touch: (n: string) => `${n}.`,
    touchWhere: (n: string, where: string) => `${n}, ${where}.`,
    newTeam: (club: string, n: string, where: string) => `${club} get the ball. ${n}, ${where}.`,
    won: (n: string, club: string) => `${n} don collect am! Na ${club} get am now.`,
    cross: (n: string) => `${n} cross am...`,
    longBall: (n: string) => `${n}, long ball...`,
    shoots: (n: string, where: string) => `${n} shoot, ${where}!`,
    saved: (gk: string) => `${gk} hold am! Goalkeeper save am!`,
    wide: 'E no enter! E pass outside.',
    blocked: 'Dem block am!',
    goal: (n: string, club: string, score: string) => `GOAL! E don enter! ${n} don score for ${club}! ${score}`,
    corner: (club: string) => `Corner kick for ${club}.`,
    freeKick: (club: string) => `Free kick for ${club}.`,
    penalty: (club: string) => `Penalty for ${club}!`,
    kickoff: 'Match don start.',
    restart: (club: string) => `${club} don restart the match.`,
    halfTime: 'Na half time be this.',
    secondHalf: 'Second half don start.',
    fullTime: 'Final whistle! Match don end!',
    cleared: 'Dem clear am!',
    carry: (n: string, where: string) => `${n} dey run with the ball, ${where}...`,
    carryOn: (where: string) => `E dey run with am, ${where}...`,
    throwIn: (club: string) => `Throw-in for ${club}.`,
  },
}

const MIN_GAP = 1.4 // seconds between name calls, so the caller never gabbles

/** Every call for a stream of cues, in time order. */
export function buildCalls(cues: Cue[], names: Names, lang: Lang): Call[] {
  const say = SAY[lang]
  const calls: Call[] = []
  let team: string | undefined
  let lastZone: Zone | null = null
  let lastCall = -1e9
  let touchesSinceZone = 0
  let whistles = 0
  let lastNamed: { player?: string; t: number } = { t: -1e9 }
  let lastCarry: { player?: string; t: number } = { t: -1e9 }

  const push = (c: Call) => {
    calls.push(c)
    lastCall = c.t
  }

  for (let i = 0; i < cues.length; i++) {
    const c = cues[i] as Cue
    const club = c.team ? short(names.club(c.team)) : ''
    switch (c.sound) {
      case 'pass': {
        if (!c.player || !c.from || !c.to || !c.team) break
        if (c.team !== team) {
          // possession changed hands on this touch (after a restart, or a loose ball)
          const z = zoneOf(c.from, c.team, names.home)
          push({ t: c.t, expires: c.t + 1.5, kind: 'event', text: say.newTeam(club, names.player(c.player), zoneText(z, lang)), evidence: [c.event] })
          team = c.team
          lastZone = z
          touchesSinceZone = 0
        }
        if (c.subtype === 'cross') {
          push({ t: c.t, expires: c.t + 1, kind: 'event', text: say.cross(names.player(c.player)), evidence: [c.event] })
          break
        }
        if (c.subtype === 'long_ball' && c.t - lastCall >= MIN_GAP) {
          push({ t: c.t, expires: c.t + 1, kind: 'event', text: say.longBall(names.player(c.player)), evidence: [c.event] })
          break
        }
        if (c.outcome !== 'complete' || !c.recipient) break
        const at = c.t + (c.duration ?? 0)
        if (at - lastCall < MIN_GAP) break
        const z = zoneOf(c.to, c.team, names.home)
        const who = names.player(c.recipient)
        lastNamed = { player: c.recipient, t: at }
        touchesSinceZone++
        const sayWhere = z !== lastZone || touchesSinceZone >= 3 || z === 'box' || z === 'edge'
        push({ t: at, expires: at + 1.1, kind: 'touch', text: sayWhere ? say.touchWhere(who, zoneText(z, lang)) : say.touch(who), evidence: [c.event], energy: z === 'box' ? 0.6 : z === 'edge' || z === 'left' || z === 'right' ? 0.35 : 0 })
        if (sayWhere) {
          lastZone = z
          touchesSinceZone = 0
        }
        break
      }
      case 'carry': {
        // A real run with the ball, not a nudge: say who is running and where to.
        if (!c.player || !c.from || !c.to || !c.team || c.team !== team) break
        const run = Math.hypot(c.to[0] - c.from[0], c.to[1] - c.from[1])
        if (run < 7 || c.t - lastCall < MIN_GAP) break
        if (lastCarry.player === c.player && c.t - lastCarry.t < 8) break // one call per run
        const z = zoneOf(c.to, c.team, names.home)
        // If the caller has just named this player, do not say the name again.
        const text = lastNamed.player === c.player && c.t - lastNamed.t < 6
          ? say.carryOn(zoneText(z, lang))
          : say.carry(names.player(c.player), zoneText(z, lang))
        push({ t: c.t, expires: c.t + 1.2, kind: 'touch', text, evidence: [c.event] })
        lastCarry = { player: c.player, t: c.t }
        lastZone = z
        touchesSinceZone = 0
        break
      }
      case 'tackle': {
        if (!c.player || !c.team || c.team === team) break
        team = c.team
        lastZone = c.from ? zoneOf(c.from, c.team, names.home) : null
        push({ t: c.t, expires: c.t + 1.5, kind: 'event', text: say.won(names.player(c.player), club), evidence: [c.event] })
        break
      }
      case 'shot': {
        if (!c.player || !c.from || !c.team) break
        team = c.team
        const z = zoneOf(c.from, c.team, names.home)
        push({ t: c.t, expires: c.t + 0.8, kind: 'big', text: say.shoots(names.player(c.player), zoneText(z, lang)), evidence: [c.event], energy: 0.85 })
        const land = c.t + Math.min(c.duration ?? 0.6, 1.2) + 0.15
        if (c.outcome === 'off_target') push({ t: land, expires: land + 1.5, kind: 'big', text: say.wide, evidence: [c.event] })
        if (c.outcome === 'blocked') push({ t: land, expires: land + 1.5, kind: 'big', text: say.blocked, evidence: [c.event] })
        break
      }
      case 'save':
        if (c.player) push({ t: c.t + 0.1, expires: c.t + 2, kind: 'big', text: say.saved(names.player(c.player)), evidence: [c.event] })
        break
      case 'goal': {
        if (!c.player || !c.team) break
        const s = c.score ?? {}
        const score = `${names.club(names.home)} ${s[names.home] ?? 0}, ${names.club(names.away)} ${s[names.away] ?? 0}.`
        push({ t: c.t + 0.1, expires: c.t + 3, kind: 'big', text: say.goal(names.player(c.player), names.club(c.team), score), evidence: [c.event], energy: 1 })
        const b = buildUp(cues, i, names, lang)
        if (b) push({ t: c.t + 4, expires: c.t + 20, kind: 'buildup', text: b.text, evidence: b.evidence })
        team = undefined
        break
      }
      case 'restart': {
        if (!c.team) break
        const kind = c.subtype
        const text =
          kind === 'corner' ? say.corner(club)
            : kind === 'free_kick' ? say.freeKick(club)
              : kind === 'penalty' ? say.penalty(club)
                : kind === 'throw_in' && c.t - lastCall >= 3 ? say.throwIn(club)
                  : null
        if (text) push({ t: c.t, expires: c.t + 3, kind: kind === 'penalty' ? 'big' : 'event', text, evidence: [c.event] })
        if (kind === 'kickoff' && calls.some((x) => x.kind === 'big' && x.text.startsWith('GOAL'))) {
          push({ t: c.t, expires: c.t + 2, kind: 'event', text: say.restart(club), evidence: [c.event] })
        }
        team = c.team
        break
      }
      case 'clearance':
        if (c.from && c.team && zoneOf(c.from, c.team, names.home) === 'own_box' && c.t - lastCall >= MIN_GAP) {
          push({ t: c.t, expires: c.t + 1.2, kind: 'event', text: say.cleared, evidence: [c.event] })
        }
        break
      case 'whistle': {
        if (c.team) break // a foul: the free kick call follows
        whistles++
        const text = [say.kickoff, say.halfTime, say.secondHalf, say.fullTime][Math.min(whistles - 1, 3)] as string
        push({ t: c.t + 0.3, expires: c.t + 4, kind: 'big', text, evidence: [c.event] })
        break
      }
      default:
        break
    }
  }
  return calls.sort((a, b) => a.t - b.t)
}

/** The build-up to the goal at index `goalIdx`: who started the move, who carried it, who finished. */
export function buildUp(cues: Cue[], goalIdx: number, names: Names, lang: Lang): { text: string; evidence: string[] } | null {
  const goal = cues[goalIdx]
  if (!goal?.team || !goal.player) return null
  const team = goal.team
  let start = goalIdx - 1
  while (start > 0) {
    const c = cues[start - 1] as Cue
    if (c.team && c.team !== team) break
    if (c.sound === 'whistle' && !c.team) break
    start--
  }
  const chain = cues.slice(start, goalIdx).filter((c) => c.team === team && c.player)
  const first = chain[0]
  const shot = [...chain].reverse().find((c) => c.sound === 'shot')
  if (!first || !shot || !first.from || !shot.from) return null
  const passes = chain.filter((c) => c.sound === 'pass' && c.outcome === 'complete').length
  const scorer = names.player(goal.player)
  const middle = [...new Set(chain.map((c) => c.player as string))]
    .filter((p) => p !== first.player && p !== goal.player)
    .slice(-2)
    .map(names.player)
  const startZone = zoneText(zoneOf(first.from, team, names.home), lang)
  const finishZone = zoneText(zoneOf(shot.from, team, names.home), lang)
  const opener = names.player(first.player as string)
  const how =
    first.sound === 'tackle'
      ? lang === 'pcm' ? `${opener} collect the ball ${startZone}` : `${opener} won the ball ${startZone}`
      : first.sound === 'restart' && first.subtype && first.subtype !== 'kickoff'
        ? lang === 'pcm' ? `E start from ${first.subtype.replace('_', ' ')}, ${opener}` : `It came from a ${first.subtype.replace('_', ' ')} by ${opener}`
        : lang === 'pcm' ? `${opener} start am ${startZone}` : `${opener} started it ${startZone}`
  const via = middle.length ? (lang === 'pcm' ? `, then ${middle.join(' and ')}` : `, then ${middle.join(' and ')} moved it on`) : ''
  const solo = first.player === goal.player
  const end = solo
    ? lang === 'pcm' ? `, and e finish am ${finishZone}.` : `, and scored ${finishZone}.`
    : lang === 'pcm' ? `, and ${scorer} finish am ${finishZone}.` : `, and ${scorer} finished ${finishZone}.`
  const count = passes >= 2 ? (lang === 'pcm' ? ` ${passes} passes for the move.` : ` ${passes} passes in the move.`) : ''
  const lead = lang === 'pcm' ? 'How the goal take happen: ' : 'The build-up: '
  return { text: `${lead}${how}${via}${end}${count}`, evidence: [...chain.map((c) => c.event), goal.event] }
}
