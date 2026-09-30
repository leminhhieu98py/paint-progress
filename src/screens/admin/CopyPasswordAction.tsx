import { App, Button, Tooltip } from 'antd'
import { IconAction } from '../../components/IconAction'
import { ACTION_ICONS } from '../../components/actionIcons'

/**
 * The copy icon beside a revealed password (NL-09 am. 2): it says, in
 * Vietnamese, that the password was copied -- or that it was not, when the
 * browser has no clipboard (an http page, an old tablet) or refuses it, so the
 * admin never reads out a password that is not on the clipboard.
 */
export function CopyPasswordAction({ password, disabled, joined = false }: {
  password: string
  disabled?: boolean
  /**
   * Inside a Space.Compact beside the field (N2): the Button itself is the
   * compact item, with no wrapper span, so its borders and corners join the
   * input and the button after it.
   */
  joined?: boolean
}) {
  const { message } = App.useApp()
  const copy = async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('no clipboard')
      await navigator.clipboard.writeText(password)
      message.success('Đã sao chép mật khẩu')
    } catch {
      message.error('Không sao chép được mật khẩu: trình duyệt không cho dùng bộ nhớ tạm. Hãy chọn mật khẩu và sao chép bằng tay.')
    }
  }
  if (joined) {
    const Icon = ACTION_ICONS.copy
    return (
      <Tooltip title="Sao chép mật khẩu">
        <Button aria-label="Sao chép mật khẩu" icon={<Icon aria-hidden />} disabled={disabled} onClick={() => void copy()} />
      </Tooltip>
    )
  }
  return <IconAction verb="copy" label="Sao chép mật khẩu" disabled={disabled} onClick={() => void copy()} />
}
