import type { ReactNode } from 'react'
import { space } from '../../../theme'

/**
 * A card's own controls on a phone: a row at the top of the card's body that
 * wraps, instead of the header's `extra`, which does not wrap and ran past a
 * 390 px screen. Each control there takes `PHONE_CONTROL` so the row shares
 * its width out evenly.
 */
export function ControlRow({ children }: { children: ReactNode }) {
  return (
    <div data-testid="control-row" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: space.md }}>
      {children}
    </div>
  )
}
