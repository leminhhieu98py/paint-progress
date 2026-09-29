import { LogoutOutlined } from '@ant-design/icons'
import type { MenuProps } from 'antd'
import { StatusPill } from '../../components/StatusPill'
import { fieldType, palette, space } from '../../theme'

/**
 * The account menu, as one list (GS-06): what the account can do about being
 * signed in. Today that is Đăng xuất alone -- GS accounts have no
 * self-service by design (spec §2, §8.1) -- and a later field feature adds its
 * entry here rather than a button in the header.
 *
 * No login name anywhere in it (MOB-04). From 768 px the trigger carries the
 * full name (and a viewer's Visitor), so the menu starts with its items; on a
 * phone the trigger is the avatar alone, so the menu opens with who is signed
 * in -- the full name, and Visitor for a viewer, which has no room on the
 * avatar.
 */
export function fieldAccountMenuItems({ fullName, readOnly, phone, onLogout }: {
  fullName: string
  readOnly: boolean
  phone: boolean
  onLogout: () => void
}): NonNullable<MenuProps['items']> {
  const logout = { key: 'logout', icon: <LogoutOutlined aria-hidden />, label: 'Đăng xuất', onClick: onLogout }
  if (!phone) return [logout]
  return [
    {
      key: 'account',
      type: 'group',
      label: (
        <div style={{ color: palette.text }}>
          <div style={fieldType.bodyStrong}>{fullName}</div>
          {readOnly && <div style={{ marginTop: space.xs }}><StatusPill tone="off">Visitor</StatusPill></div>}
        </div>
      ),
      children: [],
    },
    { key: 'account-divider', type: 'divider' },
    logout,
  ]
}
