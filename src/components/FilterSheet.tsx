import { FilterOutlined, SearchOutlined } from '@ant-design/icons'
import { Badge, Button, Drawer } from 'antd'
import { useState, type CSSProperties, type ReactNode } from 'react'
import { space } from '../theme'

const ellipsis: CSSProperties = { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }
/** The sheet's two footer buttons share its row equally. */
const half: CSSProperties = { flex: '1 1 0', minWidth: 0 }

/**
 * A filter bar on a phone (FLT-04): one row, and the controls in a sheet.
 *
 * The row holds either the one control used most (`inline`, the Sàn page's
 * deck) or a one-line `summary` of what is applied, then a `Bộ lọc` button
 * badged with how many filters are off their defaults (`count`). The button
 * -- and the summary -- open a bottom sheet with every control of the bar
 * (`children`), stacked; each control is given full width by its screen, so
 * they all line up.
 *
 * A draft bar (FLT-02) passes `onApply` and `onReset`: the sheet ends with
 * `Đặt lại` and `Tìm`, half the row each, and Tìm applies and closes. A bar
 * whose controls apply at once passes neither, and the sheet ends with Xong.
 * At 768 px and wider the screens use FilterBar instead.
 */
export function FilterSheet({
  children,
  count,
  inline,
  summary,
  onApply,
  onReset,
  applyLoading = false,
}: {
  children: ReactNode
  /** Filters off their defaults, for the button's badge; 0 shows none. */
  count: number
  /** The control that stays in the row, beside the button. */
  inline?: ReactNode
  /** What is applied, in one line, when no control stays in the row. */
  summary?: string
  onApply?: () => void
  onReset?: () => void
  applyLoading?: boolean
}) {
  const [open, setOpen] = useState(false)

  const footer = onApply !== undefined
    ? (
      <div style={{ display: 'flex', gap: space.sm }}>
        <Button style={half} onClick={onReset}>Đặt lại</Button>
        <Button
          type="primary"
          style={half}
          icon={<SearchOutlined aria-hidden />}
          loading={applyLoading}
          onClick={() => {
            onApply()
            setOpen(false)
          }}
        >
          Tìm
        </Button>
      </div>
    )
    : <Button type="primary" block onClick={() => setOpen(false)}>Xong</Button>

  return (
    <>
      <div
        role="search"
        aria-label="Bộ lọc"
        style={{ display: 'flex', flexWrap: 'nowrap', alignItems: 'center', gap: space.md, minWidth: 0, width: '100%' }}
      >
        {summary !== undefined && inline === undefined
          ? (
            <Button
              aria-haspopup="dialog"
              style={{ flex: '1 1 auto', minWidth: 0, justifyContent: 'flex-start' }}
              onClick={() => setOpen(true)}
            >
              <span style={{ ...ellipsis, minWidth: 0 }}>{summary}</span>
            </Button>
          )
          : <div style={{ flex: '1 1 auto', minWidth: 0 }}>{inline}</div>}
        <Badge count={count} size="small">
          <Button
            aria-label="Bộ lọc"
            aria-haspopup="dialog"
            aria-expanded={open}
            icon={<FilterOutlined aria-hidden />}
            onClick={() => setOpen(true)}
          />
        </Badge>
      </div>
      <Drawer
        title="Bộ lọc"
        placement="bottom"
        open={open}
        onClose={() => setOpen(false)}
        height="auto"
        destroyOnHidden
        styles={{
          wrapper: { maxHeight: '80vh' },
          body: { display: 'flex', flexDirection: 'column', gap: space.md },
          // Clear of a home indicator, where the device has one.
          footer: { paddingBottom: `calc(${space.md}px + env(safe-area-inset-bottom, 0px))` },
        }}
        footer={footer}
      >
        {children}
      </Drawer>
    </>
  )
}
