import type { ReactNode } from 'react'
import { space } from '../../theme'

/**
 * A Piping card's header controls (selects, the import actions): a row that
 * wraps, right-aligned, so a narrow desktop card (from 768 px) moves a control
 * to the next line instead of cutting it at the card's edge. Goes in
 * `SectionCard`'s `extra`, whose own row does not wrap.
 */
export function HeaderActions({ children }: { children: ReactNode }) {
  return (
    <div
      data-testid="header-actions"
      style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-end', gap: space.sm }}
    >
      {children}
    </div>
  )
}
