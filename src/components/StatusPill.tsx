import type { ReactNode } from 'react'
import { palette, type } from '../theme'

export type StatusTone = 'ok' | 'warn' | 'off' | 'accent' | 'slate' | 'info'

/**
 * `ok` is a fact that holds -- a drawing is attached, an account is live.
 * `warn` is a fact that blocks something downstream -- no drawing means no
 * bays for a foreman to tap. `off` is deliberate absence, not a problem: a
 * deactivated account is the admin's own decision and should not read as an
 * alarm.
 *
 * `accent`, `slate` and `info` carry no verdict; they exist so a column of
 * category badges (UI-04, `CategoryBadge`) can give each value of a small set
 * its own colour. Every pair is palette-only and clears AA on the text.
 */
const TONES: Record<StatusTone, { background: string; color: string }> = {
  ok: { background: palette.successBg, color: '#177245' },
  warn: { background: palette.warningBg, color: '#9A5B12' },
  off: { background: palette.bgHover, color: palette.textTertiary },
  accent: { background: palette.accentTint, color: palette.accentHover },
  slate: { background: palette.track, color: palette.ink },
  info: { background: palette.infoBg, color: palette.info },
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
        ...type.micro,
        lineHeight: 1,
        background,
        color,
      }}
    >
      {children}
    </span>
  )
}
