import type { ReactNode } from 'react'
import { palette, shadowCard } from '../theme'

/**
 * One number, large, with what it is above it and what it is out of below.
 *
 * `tone="accent"` and `live` are for exactly one card per screen: the one
 * showing something that changed a moment ago and will change again while the
 * admin is looking at it. Two of them on a row and neither reads as the live
 * one.
 */
export function StatCard({
  label,
  value,
  sub,
  tone = 'default',
  live = false,
}: {
  label: ReactNode
  value: ReactNode
  sub?: ReactNode
  tone?: 'default' | 'accent'
  live?: boolean
}) {
  const accent = tone === 'accent'
  return (
    <div
      style={{
        position: 'relative',
        overflow: 'hidden',
        background: accent ? palette.accentTint : palette.bgContainer,
        border: `1px solid ${accent ? '#CFEAE5' : palette.borderCard}`,
        borderRadius: 14,
        padding: '18px 20px 20px',
        boxShadow: shadowCard,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <span
          style={{
            fontSize: 12,
            fontWeight: 600,
            lineHeight: 1,
            color: accent ? palette.accentHover : palette.textTertiary,
          }}
        >
          {label}
        </span>
        {live && (
          <span
            data-testid="stat-live-dot"
            style={{
              width: 7,
              height: 7,
              borderRadius: '50%',
              background: palette.flame,
              flex: 'none',
            }}
          />
        )}
      </div>
      <div
        style={{ marginTop: 12, fontSize: 32, fontWeight: 700, lineHeight: 1, letterSpacing: '-0.03em' }}
      >
        {value}
      </div>
      {sub !== undefined && (
        <div
          data-testid="stat-sub"
          style={{ marginTop: 7, fontSize: 12, lineHeight: 1, color: palette.textTertiary }}
        >
          {sub}
        </div>
      )}
    </div>
  )
}
