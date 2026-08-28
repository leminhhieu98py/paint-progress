import type { CSSProperties, ReactNode } from 'react'
import { monoFamily } from '../theme'

/**
 * The monospace face, for the three things that earn it: bay codes (R3C7),
 * deck and project codes, and timestamps.
 *
 * Not for numbers in a column -- the UI face is already `tabular-nums`, so
 * percentages and areas line up without changing typeface, and switching faces
 * mid-table is noise. This exists so no component has to import the font stack
 * itself and none of them can drift apart.
 */
export function Mono({
  children,
  style,
}: {
  children: ReactNode
  style?: CSSProperties
}) {
  return <span style={{ fontFamily: monoFamily, ...style }}>{children}</span>
}
