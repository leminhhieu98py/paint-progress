import { FilterOutlined, SearchOutlined } from '@ant-design/icons'
import { Badge, Button, Drawer } from 'antd'
import { useState, type CSSProperties, type ReactNode } from 'react'
import { space } from '../theme'

const ellipsis: CSSProperties = { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }
/** The sheet's two footer buttons share its row equally. */
const half: CSSProperties = { flex: '1 1 0', minWidth: 0 }

/**
 * A filter bar on a phone (FLT-04, FLT-09): one row, and the controls in a
 * sheet.
 *
 * The row holds either the one control used most (`inline`, the Sàn page's
 * deck, which still applies at once) or a one-line `summary` of what is
 * applied, then a `Bộ lọc` button badged with how many filters are off their
 * defaults (`count`). The button -- and the summary -- open a bottom sheet
 * with the rest of the bar's controls (`children`), stacked; each control is
 * given full width by its screen, so they all line up.
 *
 * Inside the sheet the controls are a draft, on every screen alike: it ends
 * with `Đặt lại` and `Tìm`, half the row each. Tìm applies (`onApply`) and
 * closes; Đặt lại puts the defaults back and applies them (`onReset`, the
 * screen's), the sheet staying open; closing it any other way -- its X, Esc,
 * a tap on the mask -- throws the draft away (`onDiscard`), so reopening shows
 * what is applied. At 768 px and wider the screens use FilterBar instead.
 */
export function FilterSheet({
  children,
  count,
  inline,
  summary,
  onApply,
  onReset,
  onDiscard,
  applyLoading = false,
}: {
  children: ReactNode
  /** Filters off their defaults, for the button's badge; 0 shows none. */
  count: number
  /** The control that stays in the row, beside the button. */
  inline?: ReactNode
  /** What is applied, in one line, when no control stays in the row. */
  summary?: string
  onApply: () => void
  onReset: () => void
  /** The sheet closed without Tìm: the draft goes back to what is applied. */
  onDiscard: () => void
  applyLoading?: boolean
}) {
  const [open, setOpen] = useState(false)
  const trigger = { 'aria-haspopup': 'dialog' as const, 'aria-expanded': open, onClick: () => setOpen(true) }

  return (
    <>
      <div
        role="search"
        aria-label="Bộ lọc"
        style={{ display: 'flex', flexWrap: 'nowrap', alignItems: 'center', gap: space.md, minWidth: 0, width: '100%' }}
      >
        {summary !== undefined && inline === undefined
          ? (
            <Button {...trigger} style={{ flex: '1 1 auto', minWidth: 0, justifyContent: 'flex-start' }}>
              <span style={{ ...ellipsis, minWidth: 0 }}>{summary}</span>
            </Button>
          )
          : <div style={{ flex: '1 1 auto', minWidth: 0 }}>{inline}</div>}
        <Badge count={count} size="small">
          <Button {...trigger} aria-label="Bộ lọc" icon={<FilterOutlined aria-hidden />} />
        </Badge>
      </div>
      <Drawer
        title="Bộ lọc"
        placement="bottom"
        open={open}
        onClose={() => {
          onDiscard()
          setOpen(false)
        }}
        height="auto"
        destroyOnHidden
        styles={{
          // The panel is capped, not only its wrapper (I4): a column in which
          // the body gives way and scrolls, so Tìm stays on a short screen.
          content: { maxHeight: '80vh', display: 'flex', flexDirection: 'column' },
          body: {
            flex: '1 1 auto', minHeight: 0, overflowY: 'auto',
            display: 'flex', flexDirection: 'column', gap: space.md,
            paddingLeft: space.xl, paddingRight: space.xl,
          },
          // The controls' inset (M1), and clear of a home indicator where the device has one.
          footer: {
            flexShrink: 0,
            paddingTop: space.md,
            paddingLeft: space.xl,
            paddingRight: space.xl,
            paddingBottom: `calc(${space.md}px + env(safe-area-inset-bottom, 0px))`,
          },
        }}
        footer={(
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
        )}
      >
        {children}
      </Drawer>
    </>
  )
}
