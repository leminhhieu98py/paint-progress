import { DownOutlined, RightOutlined } from '@ant-design/icons'
import { useId, useState, type MouseEvent, type ReactNode } from 'react'
import { palette, shadowCard, type } from '../theme'
import { KeyFacts, type KeyFact } from './KeyFacts'

/**
 * The one card shape this app has: white, hairline border, soft shadow, an
 * optional header with a spec code, a title, its live facts and its own
 * actions.
 *
 * `facts` (HLT-01, drawn by `KeyFacts`) are what make collapsing worth
 * anything. The deck screen stacks four of these, and a foreman-shaped answer
 * -- "184 ô đã dựng", "tổng 1,00" -- has to survive the panel being shut, or the admin opens all four every
 * visit and the collapse is decoration.
 *
 * `extra` lives in the header, NOT the body, and stays mounted while
 * collapsed. Save and export belong to the panel; hiding them with the body
 * would mean collapsing a panel to see more of the page costs you the action
 * you came for.
 */
export function SectionCard({
  code,
  title,
  facts,
  extra,
  children,
  collapsible = false,
  defaultOpen = true,
  bodyPadding = '18px 20px 20px',
  footer,
  extraFill = false,
}: {
  code?: string
  title?: ReactNode
  facts?: ReadonlyArray<KeyFact | false | null | undefined>
  extra?: ReactNode
  children: ReactNode
  collapsible?: boolean
  defaultOpen?: boolean
  bodyPadding?: string | number
  footer?: ReactNode
  /**
   * The extra takes the header row's free width, its items at the right end,
   * for an extra with a control that should grow into it (a phone's coat select).
   */
  extraFill?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  const bodyId = useId()
  const shown = !collapsible || open
  const hasHeader = code !== undefined || title !== undefined || extra !== undefined
  /**
   * COL-01: the whole header row toggles a collapsible card, except the
   * controls it holds -- a select, a button, a switch, an InfoTip, a KeyFact
   * -- which keep their own behaviour. The chevron button is the keyboard's
   * way in (Enter, Space) and toggles on its own click.
   */
  const onHeaderClick = (e: MouseEvent<HTMLDivElement>) => {
    if (!collapsible) return
    const target = e.target as HTMLElement
    if (target.closest(
      'button, a, input, select, textarea, label, [role="button"], [role="combobox"], [role="switch"], '
      + '[role="img"], [role="listitem"], [role="radio"], [role="checkbox"], .ant-select, .ant-picker, .ant-segmented',
    )) return
    setOpen((v) => !v)
  }

  return (
    <section
      style={{
        background: palette.bgContainer,
        border: `1px solid ${palette.borderCard}`,
        borderRadius: 14,
        boxShadow: shadowCard,
        overflow: 'hidden',
      }}
    >
      {hasHeader && (
        <div
          onClick={onHeaderClick}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 11,
            padding: '14px 20px',
            flexWrap: 'wrap',
            cursor: collapsible ? 'pointer' : undefined,
          }}
        >
          {code !== undefined && (
            <span
              style={{
                ...type.micro,
                lineHeight: 1,
                color: palette.accent,
                background: palette.accentTint,
                padding: '5px 7px',
                borderRadius: 6,
                flex: 'none',
              }}
            >
              {code}
            </span>
          )}
          {title !== undefined && (
            <h2
              style={{
                margin: 0,
                ...type.cardTitle,
                lineHeight: 1.25,
                letterSpacing: '-0.018em',
              }}
            >
              {title}
            </h2>
          )}
          {facts !== undefined && <KeyFacts facts={facts} />}
          {extra !== undefined && (
            <div
              style={{
                marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10,
                ...(extraFill ? { flex: '1 1 auto', minWidth: 0, justifyContent: 'flex-end' } : {}),
              }}
            >
              {extra}
            </div>
          )}
          {collapsible && (
            // At the right end (COL-01), so the title starts at the card's
            // inset like every card's. Named by the section, not by "Thu
            // gọn"/"Mở rộng": four stacked toggles all called "Thu gọn" are
            // indistinguishable to anyone navigating by name.
            <button
              type="button"
              aria-label={typeof title === 'string' ? title : 'Mục'}
              aria-expanded={open}
              aria-controls={bodyId}
              className="pp-card-toggle"
              onClick={() => setOpen((v) => !v)}
              style={{
                width: 30,
                height: 30,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: 0,
                borderRadius: 9,
                cursor: 'pointer',
                flex: 'none',
                ...(extra === undefined ? { marginLeft: 'auto' } : {}),
                background: open ? palette.accentTint : palette.bgSubtleAlt,
                color: open ? palette.accent : palette.textTertiary,
                transition: 'background .15s ease',
              }}
            >
              {/* Right when closed, down when open. */}
              {open ? <DownOutlined aria-hidden /> : <RightOutlined aria-hidden />}
            </button>
          )}
        </div>
      )}

      {shown && (
        <div
          // The hook `index.css` keys on to give a table inside the card the
          // card's own gutter on its first and last column (LAY-01).
          id={bodyId}
          className="pp-card"
          style={{
            padding: bodyPadding,
            borderTop: hasHeader ? `1px solid ${palette.borderSplit}` : undefined,
          }}
        >
          {children}
        </div>
      )}

      {shown && footer !== undefined && (
        <div style={{ borderTop: `1px solid ${palette.borderSplit}` }}>{footer}</div>
      )}
    </section>
  )
}
