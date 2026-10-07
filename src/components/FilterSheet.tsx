import { FilterOutlined } from '@ant-design/icons'
import { Badge, Button, Drawer } from 'antd'
import { useState, type CSSProperties, type ReactNode } from 'react'
import { space } from '../theme'

const ellipsis: CSSProperties = { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }

/**
 * A filter bar on a phone (FLT-04, FLT-09): one row, and the controls in a
 * sheet.
 *
 * The row holds either the one control used most (`inline`, the Sàn page's
 * deck) or a one-line `summary` of what is
 * applied, then a `Bộ lọc` button badged with how many filters are off their
 * defaults (`count`). The button -- and the summary -- open a bottom sheet
 * with the rest of the bar's controls (`children`), stacked; each control is
 * given full width by its screen, so they all line up.
 *
 * Inside the sheet each control applies as it changes, as in the bar (RV7-3):
 * no footer, no `Đặt lại`, no `Tìm`, nothing to discard. The sheet closes with
 * its X, Esc or a tap on the mask. At 768 px and wider the screens use
 * FilterBar instead.
 */
export function FilterSheet({
  children,
  count,
  inline,
  summary,
  label = 'Bộ lọc',
}: {
  children: ReactNode
  /** Applied filters off their defaults, for the button's badge; 0 shows none. */
  count: number
  /** The control that stays in the row, beside the button. */
  inline?: ReactNode
  /** What is applied, in one line, when no control stays in the row. */
  summary?: string
  /**
   * The name of the bar, its button and its sheet: `Bộ lọc` for the page's
   * own, another for a card's second sheet on the same screen.
   */
  label?: string
}) {
  const [open, setOpen] = useState(false)
  const trigger = { 'aria-haspopup': 'dialog' as const, 'aria-expanded': open, onClick: () => setOpen(true) }

  return (
    <>
      <div
        role="search"
        aria-label={label}
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
          <Button {...trigger} aria-label={label} icon={<FilterOutlined aria-hidden />} />
        </Badge>
      </div>
      <Drawer
        title={label}
        placement="bottom"
        open={open}
        onClose={() => setOpen(false)}
        height="auto"
        destroyOnHidden
        styles={{
          // The panel is capped, not only its wrapper (I4): a column in which
          // the body gives way and scrolls on a short screen.
          content: { maxHeight: '80vh', display: 'flex', flexDirection: 'column' },
          // The controls' inset (M1), and clear of a home indicator where the device has one.
          body: {
            flex: '1 1 auto', minHeight: 0, overflowY: 'auto',
            display: 'flex', flexDirection: 'column', gap: space.md,
            paddingLeft: space.xl, paddingRight: space.xl,
            paddingBottom: `calc(${space.xl}px + env(safe-area-inset-bottom, 0px))`,
          },
        }}
      >
        {children}
      </Drawer>
    </>
  )
}
