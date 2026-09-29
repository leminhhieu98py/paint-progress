import { Avatar, Button, Dropdown } from 'antd'
import { useState, type CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../auth/AuthProvider'
import { ConsequenceModal } from '../../components/ConsequenceModal'
import { StatusPill } from '../../components/StatusPill'
import { LOGIN_PATH } from '../../config'
import { fieldType, palette, space } from '../../theme'
import { fieldAccountMenuItems } from './fieldAccountMenu'
import { useFieldPhone } from './fieldSections'
import { initialsOf } from './initials'

const ellipsis: CSSProperties = { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }

/**
 * Who is signed in, at the right end of a field header (GS-06): avatar, full
 * name and, for a viewer, `Visitor`; its menu (fieldAccountMenuItems) holds
 * Đăng xuất, behind a confirm. The same trigger on the project pages and on
 * the viewer's project picker (M-4). On a phone it folds to the avatar, named
 * for who is signed in, and the menu names them instead (MOB-04).
 */
export function FieldAccountTrigger({ consequence }: {
  /** What signing out costs on this page, the confirm's last line. */
  consequence: string
}) {
  const navigate = useNavigate()
  const { profile, signOut } = useAuth()
  const readOnly = profile?.role === 'viewer'
  const phone = useFieldPhone()
  const [menuOpen, setMenuOpen] = useState(false)
  const [confirmingOut, setConfirmingOut] = useState(false)

  const fullName = profile?.fullName ?? ''
  const username = profile?.username ?? ''
  const who = `${fullName} (${username})`
  const items = fieldAccountMenuItems({
    fullName,
    readOnly,
    phone,
    onLogout: () => {
      setMenuOpen(false)
      setConfirmingOut(true)
    },
  })

  return (
    <>
      <Dropdown
        trigger={['click']}
        placement="bottomRight"
        open={menuOpen}
        onOpenChange={setMenuOpen}
        menu={{ items }}
        // Above antd's tooltips (1070), so one still fading out of the bar
        // can never cover the account menu (C3).
        overlayStyle={{ zIndex: 1080 }}
      >
        {/*
          The one item that gives up width when the row is short: the name
          ellipsises, the avatar and the tabs never shrink.
        */}
        <Button
          type="text"
          aria-label={readOnly ? `${who} · Visitor` : who}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          style={{
            marginInlineStart: 'auto',
            display: 'flex',
            alignItems: 'center',
            gap: space.sm,
            flex: phone ? 'none' : '0 1 auto',
            minWidth: 0,
            paddingInline: phone ? 0 : space.sm,
          }}
        >
          <Avatar aria-hidden style={{ background: palette.accentTint, color: palette.accentHover, flex: 'none' }}>
            {initialsOf(fullName, username)}
          </Avatar>
          {!phone && (
            <>
              <span style={{ ...ellipsis, ...fieldType.bodyStrong, minWidth: 0, maxWidth: 200 }}>
                {fullName}
              </span>
              {readOnly && <StatusPill tone="off">Visitor</StatusPill>}
            </>
          )}
        </Button>
      </Dropdown>

      {/*
        A foreman in gloves, on a tablet, one tap away from the drawing he is
        working off. Signing out costs him a walk back to whoever holds the
        password, so it asks first.
      */}
      <ConsequenceModal
        open={confirmingOut}
        tag="Xác nhận"
        title="Đăng xuất?"
        description="Phiên làm việc hiện tại sẽ kết thúc:"
        items={[{ label: fullName, meta: username }]}
        consequence={consequence}
        okText="Vẫn đăng xuất"
        onCancel={() => setConfirmingOut(false)}
        onOk={() => void signOut().then(() => navigate(LOGIN_PATH, { replace: true }))}
      />
    </>
  )
}
