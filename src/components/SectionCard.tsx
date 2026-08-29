import { DownOutlined } from '@ant-design/icons'
import { useState, type ReactNode } from 'react'
import { palette, shadowCard } from '../theme'

/**
 * The one card shape this app has: white, hairline border, soft shadow, an
 * optional header with a spec code, a title, a live summary and its own
 * actions.
 *
 * `summary` is what makes collapsing worth anything. The deck screen stacks
 * four of these, and a foreman-shaped answer -- "184 ô đã dựng", "tổng 1,00"
 * -- has to survive the panel being shut, or the admin opens all four every
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
  summary,
  extra,
  children,
  collapsible = false,
  defaultOpen = true,
  bodyPadding = '18px 20px 20px',
  footer,
}: {
  code?: string
  title?: ReactNode
  summary?: ReactNode
  extra?: ReactNode
  children: ReactNode
  collapsible?: boolean
  defaultOpen?: boolean
  bodyPadding?: string | number
  footer?: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  const shown = !collapsible || open
  const hasHeader = code !== undefined || title !== undefined || extra !== undefined

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
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 11,
            padding: '14px 20px',
            flexWrap: 'wrap',
          }}
        >
          {collapsible && (
            <button
              type="button"
              // Named by the section, not by "Thu gọn"/"Mở rộng": with four of
              // these stacked, four buttons all called "Thu gọn" are
              // indistinguishable to anyone navigating by name.
              aria-label={typeof title === 'string' ? title : 'Mục'}
              aria-expanded={open}
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
                background: open ? palette.accentTint : palette.bgSubtleAlt,
                color: open ? palette.accent : palette.textTertiary,
                transform: open ? 'none' : 'rotate(-90deg)',
                transition: 'transform .16s ease, background .15s ease',
              }}
            >
              <DownOutlined />
            </button>
          )}
          {code !== undefined && (
            <span
              style={{
                fontSize: 10,
                fontWeight: 600,
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
                fontSize: 15,
                fontWeight: 600,
                lineHeight: 1.25,
                letterSpacing: '-0.018em',
              }}
            >
              {title}
            </h2>
          )}
          {summary !== undefined && (
            <span style={{ fontSize: 13, color: palette.textTertiary, minWidth: 0 }}>{summary}</span>
          )}
          {extra !== undefined && (
            <div
              style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}
            >
              {extra}
            </div>
          )}
        </div>
      )}

      {shown && (
        <div
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
