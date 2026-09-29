import type { ReactNode } from 'react'
import { space } from '../theme'

/**
 * The one row of controls that narrows what a screen shows (FLT-01).
 *
 * Directly under the page title, in the order Dự án → scope → Sàn → dates →
 * other toggles; one row that wraps at narrow widths. No control carries a
 * visible label -- each names itself with an `aria-label` and shows its value
 * or placeholder -- so no label floats above one control while the others
 * have none. Page actions (Xuất báo cáo, Thêm …) stay at the right end of the
 * title row, not here.
 */
export function FilterBar({ children }: { children: ReactNode }) {
  return (
    <div
      role="search"
      aria-label="Bộ lọc"
      style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: space.md, minWidth: 0 }}
    >
      {children}
    </div>
  )
}
