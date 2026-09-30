import { App } from 'antd'
import { IconAction } from '../../components/IconAction'

/**
 * The copy icon beside a revealed password (NL-09 am. 2): it says, in
 * Vietnamese, that the password was copied -- or that it was not, when the
 * browser has no clipboard (an http page, an old tablet) or refuses it, so the
 * admin never reads out a password that is not on the clipboard.
 */
export function CopyPasswordAction({ password, disabled }: { password: string; disabled?: boolean }) {
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
  return <IconAction verb="copy" label="Sao chép mật khẩu" disabled={disabled} onClick={() => void copy()} />
}
