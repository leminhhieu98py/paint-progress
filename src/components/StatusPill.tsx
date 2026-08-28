import type { ReactNode } from 'react'
import { palette } from '../theme'

export type StatusTone = 'ok' | 'warn' | 'off'

/**
 * `ok` is a fact that holds -- a drawing is attached, an account is live.
 * `warn` is a fact that blocks something downstream -- no drawing means no
 * bays for a foreman to tap. `off` is deliberate absence, not a problem: a
 * deactivated account is the admin's own decision and should not read as an
 * alarm.
 */
const TONES: Record<StatusTone, { background: string; color: string }> = {
  ok: { background: palette.successBg, color: '#177245' },
  warn: { background: palette.warningBg, color: '#9A5B12' },
  off: { background: palette.bgHover, color: palette.textTertiary },
}

export function StatusPill({ tone, children }: { tone: StatusTone; children: ReactNode }) {
  const { background, color } = TONES[tone]
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '4px 9px',
        borderRadius: 7,
        fontSize: 11,
        fontWeight: 500,
        lineHeight: 1,
        background,
        color,
      }}
    >
      {children}
    </span>
  )
}
