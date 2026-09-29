import {
  DeleteOutlined,
  ExclamationCircleFilled,
  InfoCircleFilled,
  WarningFilled,
} from '@ant-design/icons'
import { Alert, Button, ConfigProvider, Input, Modal, theme } from 'antd'
import { useContext, useState, type ReactNode } from 'react'
import { palette } from '../theme'
import { useTypeScale } from './typeScale'

export interface ConsequenceItem {
  label: string
  meta?: string
  /** A stage or zone colour, when the thing being acted on has one. */
  color?: string
}

export type ConsequenceTone = 'accent' | 'warn' | 'danger'

const TONES: Record<ConsequenceTone, { fg: string; bg: string; icon: ReactNode }> = {
  accent: { fg: palette.accent, bg: palette.accentTint, icon: <InfoCircleFilled aria-hidden /> },
  warn: { fg: palette.warning, bg: palette.warningTint, icon: <WarningFilled aria-hidden /> },
  danger: { fg: palette.error, bg: palette.errorTint, icon: <DeleteOutlined aria-hidden /> },
}

/**
 * A confirmation that says what will happen, not merely that something will.
 *
 * `Modal.confirm`'s "Bạn có chắc không?" is a speed bump: it tells the admin
 * nothing they did not know when they clicked. This asks for the two things
 * that actually inform the decision -- the exact rows about to be affected
 * (`items`), and what happens afterwards (`consequences`, one item each).
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
  consequences,
  okText = 'Xác nhận',
  cancelText = 'Huỷ',
  confirmLoading = false,
  onOk,
  onCancel,
  confirmText,
  error,
}: {
  open: boolean
  tone?: ConsequenceTone
  tag?: string
  title: ReactNode
  description?: ReactNode
  items?: ConsequenceItem[]
  /**
   * What happens on confirm, one item each (RUL-01), below the subjects in
   * `items` and apart from them by one hairline.
   */
  consequences?: string[]
  okText?: string
  cancelText?: string
  confirmLoading?: boolean
  onOk: () => void
  onCancel: () => void
  /**
   * When set, the confirm button stays disabled until this exact text has
   * been typed (surrounding whitespace forgiven, nothing else). For the
   * deletes that take a deck's or a project's whole history with them:
   * "are you sure?" is answered by reflex, a name is not. The field is
   * cleared on every close so the next delete is never one click.
   */
  confirmText?: string
  /**
   * A refused confirm, said inside the dialog the admin is looking at rather
   * than on the page behind its mask (M8). The dialog stays open to retry.
   */
  error?: string | null
}) {
  // The scale of the page this is on: the field's 14 on a field page (GS-10).
  const type = useTypeScale()
  const t = TONES[tone]
  // The size every other dialog under this theme titles itself at: the
  // theme's Modal title, antd's fontSizeLG when a theme sets none (Q6).
  const { token } = theme.useToken()
  const modalTheme = useContext(ConfigProvider.ConfigContext).theme?.components?.Modal
  const titleFontSize = modalTheme?.titleFontSize ?? token.fontSizeLG
  const [typed, setTyped] = useState('')
  // Reset on every OPENING, whichever way the last one closed -- Huỷ, the X,
  // the mask, Esc, or the parent closing it itself after a successful write.
  // Seen in Chrome: resetting only from the Huỷ handler left the previous
  // name in the box the next time round. React's documented "state from the
  // previous render" pattern: no effect, and a name typed for the last delete
  // can never arm the next one.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setTyped('')
  }
  const armed = confirmText === undefined || typed.trim() === confirmText
  const confirm = () => {
    if (armed) onOk()
  }
  return (
    <Modal
      open={open}
      onCancel={onCancel}
      title={null}
      footer={null}
      centered
      destroyOnHidden
      styles={{ content: { overflow: 'hidden' } }}
      width={items?.length || consequences?.length ? 520 : 480}
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
                ...type.micro,
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
              ...type.cardTitle,
              fontSize: titleFontSize,
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
                ...type.body,
                lineHeight: 1.5,
                color: palette.textSecondary,
              }}
            >
              {description}
            </p>
          )}
        </div>
      </div>

      {(Boolean(items?.length) || Boolean(consequences?.length)) && (
        <div
          style={{
            marginTop: 16,
            border: `1px solid ${palette.borderSplit}`,
            borderRadius: 11,
            overflow: 'hidden',
          }}
        >
          {items?.map((it, i) => (
            <div
              key={it.label}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 11,
                padding: '11px 14px',
                // Between rows only: under the last one the frame, or the
                // consequences' own divider, is the line.
                ...(i < items.length - 1 ? { borderBottom: `1px solid ${palette.borderSplit}` } : {}),
              }}
            >
              {it.color !== undefined && (
                <span
                  data-testid="consequence-swatch"
                  style={{
                    // A circle of the colour, nothing else (CLR-01).
                    width: 20,
                    height: 20,
                    borderRadius: '50%',
                    flex: 'none',
                    background: it.color,
                  }}
                />
              )}
              <span style={{ ...type.body, lineHeight: 1.4, flex: 1 }}>
                {it.label}
              </span>
              {it.meta !== undefined && (
                <span style={{ ...type.body, color: palette.textTertiary }}>{it.meta}</span>
              )}
            </div>
          ))}
          {consequences !== undefined && consequences.length > 0 && (
            <ul
              aria-label="Hệ quả"
              style={{
                margin: 0,
                padding: '11px 14px 11px 32px',
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                ...type.body,
                lineHeight: 1.45,
                color: palette.textSecondary,
                background: tone === 'danger' ? palette.errorBg : palette.bgSubtle,
                // The one line between who or what it is about and what happens.
                ...(items?.length ? { borderTop: `1px solid ${palette.borderSplit}` } : {}),
              }}
            >
              {consequences.map((c) => <li key={c}>{c}</li>)}
            </ul>
          )}
        </div>
      )}

      {confirmText !== undefined && (
        <div style={{ marginTop: 16 }}>
          <label
            htmlFor="consequence-confirm"
            style={{ display: 'block', marginBottom: 6, ...type.label }}
          >
            Gõ đúng tên để xác nhận
          </label>
          <Input
            id="consequence-confirm"
            value={typed}
            placeholder={confirmText}
            autoComplete="off"
            onChange={(e) => setTyped(e.target.value)}
            onPressEnter={confirm}
          />
        </div>
      )}

      {error && <Alert type="error" showIcon message={error} style={{ marginTop: 16 }} />}

      <div style={{ display: 'flex', gap: 9, justifyContent: 'flex-end', marginTop: 20 }}>
        <Button onClick={onCancel}>{cancelText}</Button>
        <Button
          type="primary"
          danger={tone === 'danger'}
          loading={confirmLoading}
          disabled={!armed}
          onClick={confirm}
          icon={tone === 'danger' ? <ExclamationCircleFilled aria-hidden /> : undefined}
        >
          {okText}
        </Button>
      </div>
    </Modal>
  )
}
