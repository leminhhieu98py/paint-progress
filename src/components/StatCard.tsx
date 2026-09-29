import type { ReactNode } from 'react'
import { palette, shadowCard, space } from '../theme'
import { useTypeScale } from './typeScale'

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
  compact = false,
}: {
  label: ReactNode
  value: ReactNode
  sub?: ReactNode
  tone?: 'default' | 'accent'
  live?: boolean
  /**
   * A phone's card (MOB-02): the label a caption, the number at displaySm,
   * the sub-line micro, a tighter inset, so six cards fill three short rows.
   */
  compact?: boolean
}) {
  // The scale of the page this is on: the field's 14 on a field page (GS-10).
  const type = useTypeScale()
  const accent = tone === 'accent'
  return (
    <div
      data-testid="stat-card"
      style={{
        position: 'relative',
        overflow: 'hidden',
        background: accent ? palette.accentTint : palette.bgContainer,
        border: `1px solid ${accent ? '#CFEAE5' : palette.borderCard}`,
        borderRadius: 14,
        padding: compact ? space.md : '18px 20px 20px',
        boxShadow: shadowCard,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <span
          style={{
            ...(compact ? type.caption : type.label),
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
              // Keyframes live in index.css -- inline styles cannot declare
              // them. Reduced-motion flattens the ring there too.
              animation: 'pp-pulse 1.9s ease-out infinite',
            }}
          />
        )}
      </div>
      <div
        style={{ marginTop: compact ? space.sm : 12, ...(compact ? type.displaySm : type.display), lineHeight: 1, letterSpacing: '-0.03em' }}
      >
        {value}
      </div>
      {sub !== undefined && (
        <div
          data-testid="stat-sub"
          style={{ marginTop: compact ? space.xs : 7, ...(compact ? type.micro : type.caption), lineHeight: 1, color: palette.textTertiary }}
        >
          {sub}
        </div>
      )}
    </div>
  )
}
