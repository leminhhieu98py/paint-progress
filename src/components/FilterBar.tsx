import { SearchOutlined } from '@ant-design/icons'
import { Button } from 'antd'
import type { KeyboardEvent, ReactNode } from 'react'
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
 * With more than one control the bar holds a draft (FLT-02, `useDraftFilters`)
 * and ends with `Đặt lại` and `Tìm`: pass `onApply` and `onReset`. Enter in a
 * text field of the bar applies too; Enter in a select or a date picker is
 * theirs (it picks the option) and does not. A bar with one control passes
 * neither and applies as it changes.
 */
export function FilterBar({
  children,
  onApply,
  onReset,
}: {
  children: ReactNode
  onApply?: () => void
  onReset?: () => void
}) {
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (onApply === undefined || e.key !== 'Enter') return
    const target = e.target as HTMLElement
    const textField = target instanceof HTMLInputElement && target.closest('.ant-select, .ant-picker') === null
    if (textField) onApply()
  }

  return (
    <div
      role="search"
      aria-label="Bộ lọc"
      onKeyDown={onKeyDown}
      style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: space.md, minWidth: 0 }}
    >
      {children}
      {onApply !== undefined && (
        <>
          <Button type="text" onClick={onReset}>Đặt lại</Button>
          <Button type="primary" icon={<SearchOutlined aria-hidden />} onClick={onApply}>Tìm</Button>
        </>
      )}
    </div>
  )
}
