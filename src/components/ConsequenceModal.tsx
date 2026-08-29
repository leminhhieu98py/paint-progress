import {
  DeleteOutlined,
  ExclamationCircleFilled,
  InfoCircleFilled,
  WarningFilled,
} from '@ant-design/icons'
import { Button, Modal } from 'antd'
import type { ReactNode } from 'react'
import { palette } from '../theme'

export interface ConsequenceItem {
  label: string
  meta?: string
  /** A stage or zone colour, when the thing being acted on has one. */
  color?: string
}

export type ConsequenceTone = 'accent' | 'warn' | 'danger'

const TONES: Record<ConsequenceTone, { fg: string; bg: string; icon: ReactNode }> = {
  accent: { fg: palette.accent, bg: palette.accentTint, icon: <InfoCircleFilled /> },
  warn: { fg: palette.warning, bg: '#FDF0D5', icon: <WarningFilled /> },
  danger: { fg: palette.error, bg: '#FEE4E2', icon: <DeleteOutlined /> },
}

/**
 * A confirmation that says what will happen, not merely that something will.
 *
 * `Modal.confirm`'s "Bạn có chắc không?" is a speed bump: it tells the admin
 * nothing they did not know when they clicked. This asks for the two things
 * that actually inform the decision -- the exact rows about to be affected
 * (`items`), and what the crew on the deck loses afterwards (`consequence`).
 *
 * Every destructive path in this app goes through it: replacing a drawing,
 * clearing a bay grid, deleting a stage, deactivating an account, resetting a
 * password. Those are the operations where an undo does not exist.
 */
export function ConsequenceModal({
  open,
  tone = 'accent',
  tag,
  title,
  description,
  items,
  consequence,
  okText = 'Xác nhận',
  cancelText = 'Huỷ',
  confirmLoading = false,
  onOk,
  onCancel,
}: {
  open: boolean
  tone?: ConsequenceTone
  tag?: string
  title: ReactNode
  description?: ReactNode
  items?: ConsequenceItem[]
  consequence?: ReactNode
  okText?: string
  cancelText?: string
  confirmLoading?: boolean
  onOk: () => void
  onCancel: () => void
}) {
  const t = TONES[tone]
  return (
    <Modal
      open={open}
      onCancel={onCancel}
      title={null}
      footer={null}
      destroyOnHidden
      width={items?.length || consequence ? 520 : 480}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
        <span
          style={{
            width: 38,
            height: 38,
            borderRadius: 11,
            flex: 'none',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 18,
            background: t.bg,
            color: t.fg,
          }}
        >
          {t.icon}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          {tag !== undefined && (
            <span
              style={{
                display: 'inline-flex',
                fontSize: 11,
                fontWeight: 600,
                lineHeight: 1,
                padding: '5px 8px',
                borderRadius: 999,
                background: tone === 'danger' ? palette.errorBg : t.bg,
                color: t.fg,
              }}
            >
              {tag}
            </span>
          )}
          <h3
            style={{
              margin: '7px 0 0',
              fontSize: 17,
              fontWeight: 600,
              lineHeight: 1.3,
              letterSpacing: '-0.022em',
            }}
          >
            {title}
          </h3>
          {description !== undefined && (
            <p
              style={{
                margin: '7px 0 0',
                fontSize: 13,
                lineHeight: 1.5,
                color: palette.textSecondary,
              }}
            >
              {description}
            </p>
          )}
        </div>
      </div>

      {(items?.length || consequence !== undefined) && (
        <div
          style={{
            marginTop: 16,
            border: `1px solid ${palette.borderSplit}`,
            borderRadius: 11,
            overflow: 'hidden',
          }}
        >
          {items?.map((it) => (
            <div
              key={it.label}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 11,
                padding: '11px 14px',
                borderBottom: `1px solid ${palette.borderSplit}`,
              }}
            >
              {it.color !== undefined && (
                <span
                  data-testid="consequence-swatch"
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: 6,
                    flex: 'none',
                    background: it.color,
                    boxShadow: 'inset 0 0 0 1px #16202B47',
                  }}
                />
              )}
              <span style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.4, flex: 1 }}>
                {it.label}
              </span>
              {it.meta !== undefined && (
                <span style={{ fontSize: 13, color: palette.textTertiary }}>{it.meta}</span>
              )}
            </div>
          ))}
          {consequence !== undefined && (
            <div
              style={{
                padding: '13px 14px',
                fontSize: 13,
                lineHeight: 1.55,
                color: palette.textSecondary,
                background: tone === 'danger' ? palette.errorBg : palette.bgSubtle,
              }}
            >
              {consequence}
            </div>
          )}
        </div>
      )}

      <div style={{ display: 'flex', gap: 9, justifyContent: 'flex-end', marginTop: 20 }}>
        <Button onClick={onCancel}>{cancelText}</Button>
        <Button
          type="primary"
          danger={tone === 'danger'}
          loading={confirmLoading}
          onClick={onOk}
          icon={tone === 'danger' ? <ExclamationCircleFilled /> : undefined}
        >
          {okText}
        </Button>
      </div>
    </Modal>
  )
}
