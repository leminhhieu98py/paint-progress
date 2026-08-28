import type { CSSProperties, ReactNode } from 'react'
import { palette } from '../theme'

export interface DonutSlice {
  label: string
  /** Fraction of the WHOLE circle, not of the other slices. */
  value: number
  color: string
}

/** Degrees of white between two slices, as a percentage of the circle. */
const GAP = 0.5

/**
 * The `conic-gradient` colour stops for a ring.
 *
 * Split out from the component and tested on its own because it is the only
 * part with anything to get wrong, and because a wrong ring is not obviously
 * wrong: a gradient whose stops run past 100% renders as a solid disc, which
 * reads as a finished deck rather than as a bug.
 *
 * Values are fractions of the whole circle and are expected to sum to at most
 * 1; whatever is left over is drawn in `remainderColor`. Anything past the end
 * is clamped, which is reachable through stage weights an admin has edited to
 * sum above 1.
 */
export function conicStops(slices: DonutSlice[], remainderColor: string): string {
  const stops: string[] = []
  let acc = 0
  for (const s of slices) {
    if (s.value <= 0) continue
    const from = acc
    const to = Math.min(100, from + s.value * 100)
    if (to <= from) continue
    const solidTo = Math.max(from, to - GAP)
    stops.push(`${s.color} ${from.toFixed(3)}% ${solidTo.toFixed(3)}%`)
    stops.push(`#ffffff ${solidTo.toFixed(3)}% ${to.toFixed(3)}%`)
    acc = to
  }
  stops.push(`${remainderColor} ${acc.toFixed(3)}% 100%`)
  return stops.join(',')
}

/**
 * A ring with something written in the middle of it.
 *
 * A CSS conic-gradient rather than a charting library: this is a static ring
 * with no axes, no tooltip and no animation the reader needs, and recharts
 * would be a second rendering model on the same screen as the Konva drawing.
 */
export function Donut({
  slices,
  size = 150,
  thickness = 27,
  remainderColor = palette.track,
  children,
  style,
}: {
  slices: DonutSlice[]
  size?: number
  thickness?: number
  remainderColor?: string
  children?: ReactNode
  style?: CSSProperties
}) {
  return (
    <div style={{ position: 'relative', width: size, height: size, flex: 'none', ...style }}>
      <div
        data-testid="donut-ring"
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: '50%',
          background: `conic-gradient(${conicStops(slices, remainderColor)})`,
          boxShadow: 'inset 0 0 0 1px rgba(22, 32, 43, 0.08)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          inset: thickness,
          borderRadius: '50%',
          background: palette.bgContainer,
          boxShadow: '0 2px 9px -4px rgba(22, 32, 43, 0.18)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
          padding: '0 8px',
        }}
      >
        {children}
      </div>
    </div>
  )
}
