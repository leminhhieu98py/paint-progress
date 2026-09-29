import { LogoutOutlined } from '@ant-design/icons'
import type { MenuProps } from 'antd'
import { StatusPill } from '../../components/StatusPill'
import { fieldType, palette, space, type } from '../../theme'

/**
 * The account menu, as one list (GS-06): who is signed in, then what they can
 * do about it. Today that is Đăng xuất alone -- GS accounts have no
 * self-service by design (spec §2, §8.1) -- and a later field feature adds its
 * entry here rather than a button in the header.
 */
export function fieldAccountMenuItems({ fullName, username, readOnly, onLogout }: {
  fullName: string
  username: string
  readOnly: boolean
  onLogout: () => void
}): NonNullable<MenuProps['items']> {
  return [
    {
      key: 'account',
      type: 'group',
      label: (
        <div style={{ color: palette.text }}>
          <div style={fieldType.bodyStrong}>{fullName}</div>
          <div style={{ ...type.caption, color: palette.textTertiary }}>{username}</div>
          {readOnly && <div style={{ marginTop: space.xs }}><StatusPill tone="off">Chỉ xem</StatusPill></div>}
        </div>
      ),
      children: [],
    },
    { key: 'account-divider', type: 'divider' },
    { key: 'logout', icon: <LogoutOutlined aria-hidden />, label: 'Đăng xuất', onClick: onLogout },
  ]
}
