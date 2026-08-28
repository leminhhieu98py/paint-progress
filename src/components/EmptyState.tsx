import type { ReactNode } from 'react'
import { palette } from '../theme'

/**
 * An empty state that says what is missing AND what it blocks.
 *
 * "Chưa có dữ liệu" leaves the admin to guess whether something is broken or
 * merely unstarted. Every use here names the next action and its
 * consequence -- "no drawing means no bays for a foreman to tap" -- because
 * every empty state in this app is a step someone has not done yet, not an
 * error.
 */
export function EmptyState({
  title,
  description,
  action,
  tone = 'default',
}: {
  title: ReactNode
  description: ReactNode
  action?: ReactNode
  tone?: 'default' | 'error'
}) {
  return (
    <div style={{ padding: '52px 28px 56px', textAlign: 'center' }}>
      <div
        style={{
          width: 110,
          height: 72,
          margin: '0 auto',
          borderRadius: 12,
          border: `1.5px dashed ${palette.border}`,
          background:
            tone === 'error'
              ? palette.errorBg
              : `repeating-linear-gradient(45deg, ${palette.bgSubtleAlt} 0 8px, #fff 8px 16px)`,
        }}
      />
      <div style={{ marginTop: 20, fontSize: 15, fontWeight: 600, lineHeight: 1.3 }}>{title}</div>
      <div
        style={{
          marginTop: 7,
          fontSize: 13,
          lineHeight: 1.5,
          color: palette.textSecondary,
          maxWidth: 420,
          margin: '7px auto 0',
        }}
      >
        {description}
      </div>
      {action !== undefined && <div style={{ marginTop: 20 }}>{action}</div>}
    </div>
  )
}
