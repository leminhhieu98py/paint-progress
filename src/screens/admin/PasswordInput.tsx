import { EyeInvisibleOutlined, EyeOutlined, ReloadOutlined } from '@ant-design/icons'
import { Button, Input, Space, Tooltip } from 'antd'
import { useState } from 'react'
import { useControlHeight } from '../../components/swatch'
import { palette } from '../../theme'
import { CopyPasswordAction } from './CopyPasswordAction'

/**
 * The one password field of Nhân lực (NL-09 amendment 2, NL-10): masked, an
 * eye inside it, a copy icon and the generator joined beside it at the
 * theme's one height (CTL-02). A rule the admin has to satisfy is a rule the
 * admin works around, so the generator puts a fresh one in -- still masked.
 *
 * The eye and copy work on what is in the field. Only the Sửa dialog passes
 * `onReveal`: there an empty field's first look fetches the stored password
 * (the call that logs a reveal, silently) and fills it in. Thêm has nothing
 * stored yet, so its eye only unmasks and nothing is fetched or logged.
 */
export function PasswordInput({
  id, value, onChange, placeholder, onGenerate, onReveal,
}: {
  /** From Form.Item, so the label names the input. */
  id?: string
  value?: string
  onChange?: (value: string) => void
  placeholder?: string
  onGenerate: () => void
  onReveal?: () => Promise<string | null>
}) {
  const [visible, setVisible] = useState(false)
  const controlHeight = useControlHeight()
  const toggle = async () => {
    if (!visible && onReveal && (value ?? '') === '') {
      const password = await onReveal()
      if (password === null) return
      onChange?.(password)
    }
    setVisible((v) => !v)
  }
  return (
    <Space.Compact style={{ width: '100%' }}>
      <Input
        id={id}
        // The theme's one height, as the two buttons joined to it (N2, CTL-02):
        // an input with a suffix comes out a pixel taller on its own.
        style={{ height: controlHeight }}
        type={visible ? 'text' : 'password'}
        autoComplete="new-password"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        suffix={(
          <button
            type="button"
            aria-label={visible ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
            onClick={() => void toggle()}
            style={{ border: 0, background: 'none', padding: 0, cursor: 'pointer', color: palette.iconMuted, display: 'inline-flex' }}
          >
            {visible ? <EyeInvisibleOutlined aria-hidden /> : <EyeOutlined aria-hidden />}
          </button>
        )}
      />
      <CopyPasswordAction joined password={value ?? ''} disabled={(value ?? '') === ''} />
      <Tooltip title="Sinh mật khẩu ngẫu nhiên, dễ đọc qua bộ đàm">
        <Button aria-label="Sinh mật khẩu" icon={<ReloadOutlined aria-hidden />} onClick={onGenerate} />
      </Tooltip>
    </Space.Compact>
  )
}
