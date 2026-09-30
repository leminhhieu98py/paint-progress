/**
 * The geometry of the `Donut` ring (CHT-02), apart from the component so it
 * can be tested on its own and the component file exports components only.
 */

/** Between two slices, as a fraction of the circle: the old 0.5% white band. */
const GAP = 0.005
/** Fractions to 9 places, so 0.5 − 0.005 is 0.495 and not 0.49500000000000005. */
const round = (n: number) => Math.round(n * 1e9) / 1e9

export interface RingSegment {
  /** Position of the slice in the list it came from. */
  index: number
  /** Where the arc starts, as a fraction of the circle from twelve o'clock. */
  from: number
  /** Where its colour stops and the white gap after it begins. */
  solidTo: number
  /** Where the gap ends and the next slice, or the remainder, begins. */
  to: number
  /** `to − from`: what the slice takes of the circle, its gap included. */
  arc: number
}

/**
 * Where each slice of a ring sits, clockwise from twelve o'clock.
 *
 * Split out from the component and tested on its own because it is the part
 * with anything to get wrong, and because a wrong ring is not obviously
 * wrong: a slice that runs past the full circle paints over the others and
 * reads as a finished deck rather than as a bug.
 *
 * Values are fractions of the whole circle and are expected to sum to at most
 * 1; whatever is left over, from `remainderFrom` on, is the remainder track.
 * Anything past the end is clamped, which is reachable through stage weights
 * an admin has edited to sum above 1. A slice of zero has no arc and no gap.
 */
export function ringSegments(slices: { value: number }[]): { segments: RingSegment[]; remainderFrom: number } {
  const segments: RingSegment[] = []
  let acc = 0
  slices.forEach((s, index) => {
    if (s.value <= 0) return
    const from = acc
    const to = round(Math.min(1, from + s.value))
    if (to <= from) return
    segments.push({ index, from, solidTo: round(Math.max(from, to - GAP)), to, arc: round(to - from) })
    acc = to
  })
  return { segments, remainderFrom: acc }
}

/** An SVG number: three decimals at most, no trailing zeros, never `-0`. */
const num = (n: number) => String(Math.abs(n) < 5e-4 ? 0 : Number(n.toFixed(3)))

/**
 * The SVG path of a ring sector between two fractions of the circle,
 * clockwise from twelve o'clock -- the direction and origin the CSS
 * conic-gradient this replaced used, so the slices sit where they always did.
 */
export function sectorPath(
  cx: number, cy: number, rOuter: number, rInner: number, from: number, to: number,
): string {
  const at = (r: number, f: number) => {
    const a = 2 * Math.PI * f
    return `${num(cx + r * Math.sin(a))} ${num(cy - r * Math.cos(a))}`
  }
  // A sector within a hair of the full circle has both ends on one point once
  // rounded, and an arc from a point to itself draws nothing (m-1).
  if (to - from >= 1 || (to - from > 0.5 && at(rOuter, from) === at(rOuter, to))) {
    // One arc cannot end where it starts, so a whole ring is two halves, and
    // the hole is the inner circle drawn the other way round.
    return `M${at(rOuter, 0)}A${num(rOuter)} ${num(rOuter)} 0 1 1 ${at(rOuter, 0.5)}`
      + `A${num(rOuter)} ${num(rOuter)} 0 1 1 ${at(rOuter, 0)}Z`
      + `M${at(rInner, 0)}A${num(rInner)} ${num(rInner)} 0 1 0 ${at(rInner, 0.5)}`
      + `A${num(rInner)} ${num(rInner)} 0 1 0 ${at(rInner, 0)}Z`
  }
  const large = to - from > 0.5 ? 1 : 0
  return `M${at(rOuter, from)}A${num(rOuter)} ${num(rOuter)} 0 ${large} 1 ${at(rOuter, to)}`
    + `L${at(rInner, to)}A${num(rInner)} ${num(rInner)} 0 ${large} 0 ${at(rInner, from)}Z`
}
