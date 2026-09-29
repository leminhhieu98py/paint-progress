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
 * and ends with `Đặt lại` and `Tìm`, one unit that never wraps apart
 * (FLT-05): pass `onApply` and `onReset`. Enter in a
 * text field of the bar (an input of type text or search) applies too; Enter
 * in a select, a date picker or a Segmented option is theirs and does not.
 * `applyLoading` holds Tìm (and Enter) while the options a draft depends on
 * are still loading. A bar with one control passes none of these and applies
 * as it changes.
 */
export function FilterBar({
  children,
  onApply,
  onReset,
  applyLoading = false,
}: {
  children: ReactNode
  onApply?: () => void
  onReset?: () => void
  applyLoading?: boolean
}) {
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (onApply === undefined || applyLoading || e.key !== 'Enter') return
    const target = e.target as HTMLElement
    const textField = target instanceof HTMLInputElement
      && (target.type === 'text' || target.type === 'search')
      && target.closest('.ant-select, .ant-picker') === null
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
        // One unit (FLT-05): the bar wraps whole controls, never Tìm away from Đặt lại.
        <div style={{ display: 'flex', flexWrap: 'nowrap', gap: space.sm, flex: 'none' }}>
          <Button type="text" onClick={onReset}>Đặt lại</Button>
          <Button type="primary" icon={<SearchOutlined aria-hidden />} loading={applyLoading} onClick={onApply}>
            Tìm
          </Button>
        </div>
      )}
    </div>
  )
}
