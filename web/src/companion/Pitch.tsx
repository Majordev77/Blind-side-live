import type { Cue, Point } from '../match/types'

const W = 105
const H = 68

interface Props {
  ball: Point
  /** Recent cues with positions, oldest first: drawn as a fading trail. */
  trail: Cue[]
  home: string
  /** The player on the ball, for the name tag. */
  tag: { name: string; shirt?: number; team: string; badge?: string } | null
  /** Positions of the events behind the line on screen, highlighted when the card is opened. */
  evidence: Point[]
  homeName: string
  awayName: string
}

/** Pitch coordinates (x along, y across with y = 0 at the near touchline) to SVG coordinates. */
const sx = (x: number) => x
const sy = (y: number) => H - y

/**
 * The 2D pitch, drawn from the same cues the listener hears. Only what the
 * data contains is shown: where the ball is, where it has just been and who
 * has it. Players without the ball are not drawn, because the events do not
 * say where they are.
 */
export function Pitch({ ball, trail, home, tag, evidence, homeName, awayName }: Props) {
  const team = (code?: string) => (code === home ? 'home' : 'away')
  return (
    <figure className="pitch">
      <svg viewBox={`-2 -2 ${W + 4} ${H + 4}`} role="img" aria-label="Live pitch: the ball and the last few touches">
        <rect x={0} y={0} width={W} height={H} className="grass" />
        {[...Array(10).keys()].map((i) => (
          <rect key={i} x={i * 10.5} y={0} width={10.5} height={H} className={i % 2 ? 'stripe' : 'stripe alt'} />
        ))}
        <g className="lines">
          <rect x={0} y={0} width={W} height={H} />
          <line x1={W / 2} y1={0} x2={W / 2} y2={H} />
          <circle cx={W / 2} cy={H / 2} r={9.15} />
          <circle cx={W / 2} cy={H / 2} r={0.4} className="spot" />
          <rect x={0} y={H / 2 - 20.15} width={16.5} height={40.3} />
          <rect x={W - 16.5} y={H / 2 - 20.15} width={16.5} height={40.3} />
          <rect x={0} y={H / 2 - 9.16} width={5.5} height={18.32} />
          <rect x={W - 5.5} y={H / 2 - 9.16} width={5.5} height={18.32} />
          <rect x={-1.5} y={H / 2 - 3.66} width={1.5} height={7.32} className="goal" />
          <rect x={W} y={H / 2 - 3.66} width={1.5} height={7.32} className="goal" />
        </g>

        {trail.map((c, i) => {
          if (!c.from || !c.to) return null
          const age = (trail.length - i) / trail.length
          return (
            <g key={c.event} className={`touch ${team(c.team)}`} opacity={1 - age * 0.75}>
              {(c.sound === 'pass' || c.sound === 'shot') && (
                <line x1={sx(c.from[0])} y1={sy(c.from[1])} x2={sx(c.to[0])} y2={sy(c.to[1])} className={c.outcome === 'complete' || c.sound === 'shot' ? 'path' : 'path lost'} />
              )}
              <circle cx={sx(c.from[0])} cy={sy(c.from[1])} r={1.3} />
            </g>
          )
        })}

        {evidence.map((p, i) => (
          <g key={`ev${i}`} className="evidence-mark">
            <circle cx={sx(p[0])} cy={sy(p[1])} r={2.6} />
            <text x={sx(p[0])} y={sy(p[1]) - 3.4} textAnchor="middle">
              {i + 1}
            </text>
          </g>
        ))}

        <circle cx={sx(ball[0])} cy={sy(ball[1])} r={1.9} className="ball-halo" />
        <circle cx={sx(ball[0])} cy={sy(ball[1])} r={1.05} className="ball" />

        {tag && (
          <g className={`tag ${team(tag.team)}`} transform={`translate(${Math.min(W - 26, Math.max(1, sx(ball[0]) + 2.4))} ${Math.max(5, sy(ball[1]) - 6)})`}>
            <rect width={tag.badge ? 25 : 17} height={4.6} rx={0.6} />
            <text x={1.2} y={3.4}>
              {tag.shirt ? `${tag.shirt} ` : ''}
              {tag.name.toUpperCase()}
              {tag.badge ? ` · ${tag.badge}` : ''}
            </text>
          </g>
        )}
      </svg>
      <figcaption className="pitch-legend">
        <span className="home">{homeName} attack →</span>
        <span className="away">← {awayName} attack</span>
      </figcaption>
    </figure>
  )
}
