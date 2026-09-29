import { Avatar, Button, Dropdown, Grid, Layout } from 'antd'
import { useState, type CSSProperties } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../auth/AuthProvider'
import { ConsequenceModal } from '../../components/ConsequenceModal'
import { StatusPill } from '../../components/StatusPill'
import { APP_BASE_PATH, LOGIN_PATH } from '../../config'
import { palette, space } from '../../theme'
import { fieldAccountMenuItems } from './fieldAccountMenu'
import { FIELD_SECTIONS, fieldSectionOf } from './fieldSections'
import { initialsOf } from './initials'

/** One fixed height on all three routes: a 48px field control and 8px either side. */
const HEADER_HEIGHT = 64

const ellipsis: CSSProperties = { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }

/**
 * The one header of the field screens (GS-01, GS-06): Sàn, Năng suất and KPI
 * of one project, for the foreman and the viewer alike, and the account.
 *
 * Left, the three pages as router links, the active one read from the route;
 * they are the only way between the pages (GS-02), so there is no back button
 * anywhere. Right, the account trigger -- avatar, full name, `Chỉ xem` for a
 * viewer -- whose menu holds who is signed in and Đăng xuất, behind the same
 * confirm as before. The project is not here: it is the first control of each
 * page's filter bar (GS-07).
 *
 * On a phone (< 768) the trigger folds to the avatar, named for who is signed
 * in; the name, the login and a viewer's `Chỉ xem` are in its menu.
 */
export function FieldHeader({ projectId }: { projectId: string }) {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const { profile, signOut } = useAuth()
  const readOnly = profile?.role === 'viewer'
  const screens = Grid.useBreakpoint()
  const phone = !screens.md
  const [menuOpen, setMenuOpen] = useState(false)
  const [confirmingOut, setConfirmingOut] = useState(false)

  const base = `${APP_BASE_PATH}/gs/${projectId}`
  const current = fieldSectionOf(pathname)

  const fullName = profile?.fullName ?? ''
  const username = profile?.username ?? ''
  const who = `${fullName} (${username})`
  const items = fieldAccountMenuItems({
    fullName,
    username,
    readOnly,
    onLogout: () => {
      setMenuOpen(false)
      setConfirmingOut(true)
    },
  })

  return (
    <Layout.Header
      style={{
        background: palette.bgContainer,
        borderBottom: `1px solid ${palette.borderCard}`,
        display: 'flex',
        flexWrap: 'nowrap',
        alignItems: 'center',
        gap: phone ? space.sm : space.md,
        paddingInline: phone ? space.md : space.lg,
        height: HEADER_HEIGHT,
        lineHeight: 'normal',
        overflow: 'hidden',
      }}
    >
      <nav aria-label="Điều hướng" style={{ display: 'flex', alignSelf: 'stretch', flex: 'none' }}>
        {FIELD_SECTIONS.map((s) => (
          <Link
            key={s.label}
            to={`${base}${s.suffix}`}
            aria-current={s === current ? 'page' : undefined}
            style={{
              display: 'flex',
              alignItems: 'center',
              paddingInline: phone ? space.sm : space.md,
              whiteSpace: 'nowrap',
              textDecoration: 'none',
              fontWeight: s === current ? 600 : 500,
              color: s === current ? palette.accent : palette.textSecondary,
              borderBottom: `2px solid ${s === current ? palette.accent : 'transparent'}`,
              borderTop: '2px solid transparent',
            }}
          >
            {s.label}
          </Link>
        ))}
      </nav>

      <Dropdown
        trigger={['click']}
        placement="bottomRight"
        open={menuOpen}
        onOpenChange={setMenuOpen}
        menu={{ items }}
      >
        {/*
          The one item that gives up width when the row is short: the name
          ellipsises, the avatar and the tabs never shrink.
        */}
        <Button
          type="text"
          aria-label={readOnly ? `${who} · Chỉ xem` : who}
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
              <span style={{ ...ellipsis, fontWeight: 600, minWidth: 0, maxWidth: 200 }}>
                {fullName}
              </span>
              {readOnly && <StatusPill tone="off">Chỉ xem</StatusPill>}
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
        consequence="Muốn ghi tiếp tiến độ thì phải đăng nhập lại bằng mật khẩu quản trị viên đã giao."
        okText="Vẫn đăng xuất"
        onCancel={() => setConfirmingOut(false)}
        onOk={() => void signOut().then(() => navigate(LOGIN_PATH, { replace: true }))}
      />
    </Layout.Header>
  )
}
