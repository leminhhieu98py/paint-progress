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
 *
 * Every control applies as it changes, through the screen's own onChange
 * (RV7-3): there is no draft, no `Đặt lại` and no `Tìm`.
 */
export function FilterBar({
  children,
  align = 'center',
  label = 'Bộ lọc',
}: {
  children: ReactNode
  /** `end` for a card's bar whose controls carry a label above them: the items line up at the bottom. */
  align?: 'center' | 'end'
  /** The landmark's name, for a screen that holds two bars side by side. */
  label?: string
}) {
  return (
    <div
      role="search"
      aria-label={label}
      style={{ display: 'flex', flexWrap: 'wrap', alignItems: align === 'end' ? 'flex-end' : 'center', gap: space.md, minWidth: 0, width: '100%' }}
    >
      {children}
    </div>
  )
}
