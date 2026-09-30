import { ReloadOutlined } from '@ant-design/icons'
import { Button, Input, Space, Tooltip, type InputProps } from 'antd'

/**
 * A password field with a generator beside it. A rule the admin has to satisfy
 * is a rule the admin works around -- they find the shortest string that
 * passes and reuse it. Not asking them to invent one is the actual fix.
 * `onGenerate` puts a fresh one into the form.
 */
export function PasswordInput({ onGenerate, ...input }: InputProps & { onGenerate: () => void }) {
  // One compound control at the theme's one height (CTL-02): the field and its
  // generator side by side, not a button squeezed into an addon.
  return (
    <Space.Compact style={{ width: '100%' }}>
      <Input {...input} />
      <Tooltip title="Sinh mật khẩu ngẫu nhiên, dễ đọc qua bộ đàm">
        <Button aria-label="Sinh mật khẩu" icon={<ReloadOutlined aria-hidden />} onClick={onGenerate} />
      </Tooltip>
    </Space.Compact>
  )
}
