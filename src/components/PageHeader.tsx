import { ArrowLeftOutlined, RightOutlined } from '@ant-design/icons'
import { Fragment, type ReactNode } from 'react'
import { palette } from '../theme'
import { Mono } from './Mono'

export interface Crumb {
  label: string
  onClick: () => void
}

/**
 * The band at the top of every admin screen: where you are, what you are
 * looking at, and what you can do to it.
 *
 * The slot order is fixed across screens on purpose -- crumbs, then title with
 * its badge, then subtitle, then actions right, then filters underneath. An
 * admin moving between Projects, Decks and a deck should find the create
 * button in the same place every time rather than re-reading the header.
 *
 * `sticky` is for the deck screen only, where four tall panels scroll under a
 * header that carries the deck's own percentage.
 */
export function PageHeader({
  title,
  badge,
  subtitle,
  breadcrumbs,
  onBack,
  extra,
  filters,
  sticky = false,
}: {
  title: ReactNode
  badge?: ReactNode
  subtitle?: ReactNode
  breadcrumbs?: Crumb[]
  onBack?: () => void
  extra?: ReactNode
  filters?: ReactNode
  sticky?: boolean
}) {
  return (
    <div
      style={{
        background: palette.bgContainer,
        borderBottom: `1px solid ${palette.borderCard}`,
        padding: breadcrumbs?.length ? '14px 28px 16px' : '20px 28px',
        position: sticky ? 'sticky' : 'static',
        top: 0,
        zIndex: 30,
      }}
    >
      {breadcrumbs !== undefined && breadcrumbs.length > 0 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 7,
            fontSize: 12,
            fontWeight: 500,
            color: palette.textTertiary,
            marginBottom: 10,
          }}
        >
          {breadcrumbs.map((c, i) => (
            <Fragment key={c.label}>
              <button
                type="button"
                onClick={c.onClick}
                style={{
                  background: 'none',
                  border: 0,
                  padding: 0,
                  font: 'inherit',
                  fontWeight: 500,
                  color: palette.accent,
                  cursor: 'pointer',
                }}
              >
                {c.label}
              </button>
              {/* Between crumbs, not after the last one: a trailing chevron
                  points at nothing and reads as a label that failed to load. */}
              {i < breadcrumbs.length - 1 && (
                <RightOutlined style={{ fontSize: 10, color: '#647688' }} />
              )}
            </Fragment>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        {onBack !== undefined && (
          <button
            type="button"
            aria-label="Quay lại"
            onClick={onBack}
            style={{
              width: 38,
              height: 38,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: palette.bgContainer,
              border: `1px solid ${palette.border}`,
              borderRadius: 10,
              color: palette.text,
              cursor: 'pointer',
              flex: 'none',
            }}
          >
            <ArrowLeftOutlined />
          </button>
        )}

        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
            <h1
              style={{
                margin: 0,
                fontSize: 20,
                fontWeight: 600,
                lineHeight: 1.25,
                letterSpacing: '-0.028em',
              }}
            >
              {title}
            </h1>
            {badge !== undefined && (
              <Mono
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  lineHeight: 1,
                  color: palette.textSecondary,
                  padding: '5px 8px',
                  background: palette.bgHover,
                  borderRadius: 7,
                }}
              >
                {badge}
              </Mono>
            )}
          </div>
          {subtitle !== undefined && (
            <p style={{ margin: '5px 0 0', fontSize: 13, lineHeight: 1.35, color: palette.textTertiary }}>
              {subtitle}
            </p>
          )}
        </div>

        {extra !== undefined && (
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 14 }}>
            {extra}
          </div>
        )}
      </div>

      {filters !== undefined && (
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-end',
            gap: 14,
            marginTop: 16,
            paddingTop: 15,
            borderTop: `1px solid ${palette.borderSplit}`,
          }}
        >
          {filters}
        </div>
      )}
    </div>
  )
}

/**
 * The padded area under a PageHeader.
 *
 * The layout's content region is deliberately unpadded so a PageHeader's
 * bottom rule can run the full width of the screen. That makes the inset the
 * body's own responsibility, and this is it -- in one place, so the four admin
 * screens cannot drift a few pixels apart from each other.
 */
export function PageBody({ children }: { children: ReactNode }) {
  return (
    <div style={{ padding: '24px 28px 36px', display: 'flex', flexDirection: 'column', gap: 20 }}>
      {children}
    </div>
  )
}
