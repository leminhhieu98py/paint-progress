import { LogoutOutlined } from '@ant-design/icons'
import { Avatar, Button, Grid, Layout, Select, Tooltip } from 'antd'
import { useEffect, useState, type CSSProperties } from 'react'
import { NavLink, matchPath, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../auth/AuthProvider'
import { ConsequenceModal } from '../../components/ConsequenceModal'
import { searchSelectProps } from '../../components/searchSelect'
import { StatusPill } from '../../components/StatusPill'
import { APP_BASE_PATH, LOGIN_PATH } from '../../config'
import { loadGsProjectIdentity } from '../../lib/gsApi'
import { listProjectNames } from '../../lib/projectsApi'
import { palette, space } from '../../theme'
import { initialsOf } from './initials'

/**
 * The three field pages of one project, in the order the tabs show them. The
 * suffix is what follows `/gs/:projectId`, so the viewer's project switch can
 * open the same page of the project it chooses.
 */
const SECTIONS = [
  { label: 'Sàn', suffix: '' },
  { label: 'Năng suất', suffix: '/dashboard' },
  { label: 'KPI', suffix: '/kpi' },
] as const

/** One fixed height on all three routes: a 48px field control and 8px either side. */
const HEADER_HEIGHT = 64

const ellipsis: CSSProperties = { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }

/**
 * The one header of the field screens (GS-01): Sàn, Năng suất and KPI of one
 * project, for the foreman and the viewer alike.
 *
 * Left, the project -- its name for a foreman, whose screen is his one
 * project's; the searchable switch for a viewer, who reads every project
 * (0034, RV6-24). Then the three pages as router links, the active one read
 * from the route; they are the only way between the pages (GS-02), so there
 * is no back button anywhere. Right, who is signed in, `Chỉ xem` for a
 * viewer, and logout behind a confirm.
 *
 * One line at every width. On a phone the name and the login fold into an
 * avatar whose tooltip gives both, and a viewer's `Chỉ xem` goes with them:
 * at 390px the badge would leave the project switch no width to show a name.
 */
export function FieldHeader({ projectId }: { projectId: string }) {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const { profile, signOut } = useAuth()
  const readOnly = profile?.role === 'viewer'
  const screens = Grid.useBreakpoint()
  const phone = !screens.sm
  const [confirmingOut, setConfirmingOut] = useState(false)

  /**
   * The project's name for a foreman, the list for a viewer. Either failure
   * leaves the header working: the foreman loses a label, and the viewer's
   * switch lists the project on screen, which is on the route.
   */
  const [identity, setIdentity] = useState<{ projectId: string; name: string } | null>(null)
  const projectName = identity?.projectId === projectId ? identity.name : null
  const [projectOptions, setProjectOptions] = useState<{ value: string; label: string }[]>([])
  // The list once per mount: it does not change with the project on screen.
  useEffect(() => {
    if (!readOnly) return
    let cancelled = false
    listProjectNames()
      .then((rows) => {
        if (!cancelled) setProjectOptions(rows.map((p) => ({ value: p.id, label: p.name })))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [readOnly])
  useEffect(() => {
    if (readOnly) return
    let cancelled = false
    loadGsProjectIdentity(projectId)
      .then((p) => {
        if (!cancelled) setIdentity({ projectId, name: p.name })
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [readOnly, projectId])

  const base = `${APP_BASE_PATH}/gs/${projectId}`
  const section = SECTIONS.find((s) => matchPath(`${APP_BASE_PATH}/gs/:projectId${s.suffix}`, pathname))
    ?? SECTIONS[0]

  const fullName = profile?.fullName ?? ''
  const username = profile?.username ?? ''
  const who = `${fullName} (${username})`

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
      {/*
        The one item that gives up width when the row is short (the name
        ellipsises, the Select narrows). Everything else is flex: none, so on a
        phone logout can never be pushed past the header's clip edge.
      */}
      <div data-testid="field-header-project" style={{ flex: '0 1 auto', minWidth: 0 }}>
        {readOnly ? (
          <Select
            aria-label="Dự án"
            style={{ width: phone ? 140 : 220, maxWidth: '100%' }}
            value={projectId}
            onChange={(id) => navigate(`${APP_BASE_PATH}/gs/${id}${section.suffix}`)}
            {...searchSelectProps}
            options={projectOptions.some((o) => o.value === projectId)
              ? projectOptions
              : [{ value: projectId, label: projectId }, ...projectOptions]}
          />
        ) : (
          <div style={{ ...ellipsis, maxWidth: 280, fontWeight: 600 }}>
            {projectName}
          </div>
        )}
      </div>

      <nav aria-label="Điều hướng" style={{ display: 'flex', alignSelf: 'stretch', flex: 'none' }}>
        {SECTIONS.map((s) => (
          <NavLink
            key={s.label}
            to={`${base}${s.suffix}`}
            // Sàn is the project's own address, so without `end` it would stay
            // lit under Năng suất and KPI as well.
            end
            style={({ isActive }) => ({
              display: 'flex',
              alignItems: 'center',
              paddingInline: phone ? space.sm : space.md,
              whiteSpace: 'nowrap',
              textDecoration: 'none',
              fontWeight: isActive ? 600 : 500,
              color: isActive ? palette.accent : palette.textSecondary,
              borderBottom: `2px solid ${isActive ? palette.accent : 'transparent'}`,
              borderTop: '2px solid transparent',
            })}
          >
            {s.label}
          </NavLink>
        ))}
      </nav>

      <div
        style={{
          marginInlineStart: 'auto',
          display: 'flex',
          alignItems: 'center',
          gap: phone ? space.sm : space.md,
          // On a phone the block is an avatar and a button, neither of which
          // can shrink, so the block must not either. Wider, the name inside
          // it ellipsises, so it may.
          flex: phone ? 'none' : '0 1 auto',
          minWidth: 0,
        }}
      >
        {phone ? (
          <Tooltip
            trigger={['hover', 'focus']}
            title={(
              <>
                <div style={{ fontWeight: 600 }}>{fullName}</div>
                <div>{username}</div>
                {readOnly && <div>Chỉ xem</div>}
              </>
            )}
          >
            {/* Named and focusable here, so the tooltip opens from the keyboard too. */}
            <span
              role="img"
              tabIndex={0}
              aria-label={readOnly ? `${who} · Chỉ xem` : who}
              style={{ display: 'inline-flex', flex: 'none', borderRadius: '50%' }}
            >
              <Avatar style={{ background: palette.accentTint, color: palette.accentHover, cursor: 'default' }}>
                {initialsOf(fullName, username)}
              </Avatar>
            </span>
          </Tooltip>
        ) : (
          <>
            <div style={{ textAlign: 'right', minWidth: 0, maxWidth: 200 }}>
              <div style={{ ...ellipsis, fontWeight: 600, lineHeight: 1.25 }}>{fullName}</div>
              <div style={{ ...ellipsis, fontSize: 11, color: palette.textTertiary }}>{username}</div>
            </div>
            {readOnly && <StatusPill tone="off">Chỉ xem</StatusPill>}
          </>
        )}
        {/* Spec §8.1: no account UI. Logout only. */}
        <Button
          aria-label="Đăng xuất"
          icon={<LogoutOutlined />}
          style={{ flex: 'none' }}
          onClick={() => setConfirmingOut(true)}
        />
      </div>

      {/*
        A foreman in gloves, on a tablet, one button away from the drawing he is
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
