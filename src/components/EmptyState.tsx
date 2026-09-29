import type { ReactNode } from 'react'
import { palette, type } from '../theme'

/**
 * An empty state that says what is missing AND what it blocks.
 *
 * "Chưa có dữ liệu" leaves the admin to guess whether something is broken or
 * merely unstarted. A use names the next action when there is one -- "no
 * drawing means no bays for a foreman to tap" -- because every empty state in
 * this app is a step someone has not done yet, not an error. When the title
 * already says it all, it stands alone (CPY-01).
 */
export function EmptyState({
  title,
  description,
  action,
  tone = 'default',
}: {
  title: ReactNode
  /** Left out when the title says it all (CPY-01). */
  description?: ReactNode
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
      <div style={{ marginTop: 20, ...type.cardTitle, lineHeight: 1.3 }}>{title}</div>
      {description !== undefined && (
        <div
          style={{
            marginTop: 7,
            ...type.body,
            lineHeight: 1.5,
            color: palette.textSecondary,
            maxWidth: 420,
            margin: '7px auto 0',
          }}
        >
          {description}
        </div>
      )}
      {action !== undefined && <div style={{ marginTop: 20 }}>{action}</div>}
    </div>
  )
}
