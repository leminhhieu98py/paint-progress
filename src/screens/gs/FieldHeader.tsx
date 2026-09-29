import { LogoutOutlined } from '@ant-design/icons'
import { Avatar, Button, Grid, Layout, Select, Skeleton, Tooltip } from 'antd'
import { useEffect, useState, type CSSProperties } from 'react'
import { Link, matchPath, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../auth/AuthProvider'
import { ConsequenceModal } from '../../components/ConsequenceModal'
import { searchSelectProps } from '../../components/searchSelect'
import { StatusPill } from '../../components/StatusPill'
import { APP_BASE_PATH, LOGIN_PATH } from '../../config'
import { palette, space } from '../../theme'
import { cachedProjectList, cachedProjectName, fieldProjectName, projectListFor } from './fieldProjects'
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
export function FieldHeader({ projectId, projectName: givenName, projectNameLoading = false }: {
  projectId: string
  /**
   * The foreman's project name when the host already read the project row
   * (GsScreen), so the header reads nothing; null when that row had none.
   * Omitted, the header takes it from the session or reads it once.
   */
  projectName?: string | null
  /** The host is still reading the row that name comes from: show the placeholder, read nothing. */
  projectNameLoading?: boolean
}) {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const { profile, signOut } = useAuth()
  const readOnly = profile?.role === 'viewer'
  const screens = Grid.useBreakpoint()
  const phone = !screens.sm
  const [confirmingOut, setConfirmingOut] = useState(false)

  /**
   * The project's name for a foreman, the list for a viewer, both kept for the
   * session (fieldProjects) because this header remounts on every page and
   * every project switch. Either failure leaves the header working: the
   * foreman loses a label, and the viewer's switch lists the project on
   * screen, which is on the route.
   */
  /** The header's own read, settled: a name, or null when the read failed. */
  const [identity, setIdentity] = useState<{ projectId: string; name: string | null } | null>(null)
  const nameGiven = givenName !== undefined || projectNameLoading
  const cachedName = cachedProjectName(projectId)
  const ownRead = identity?.projectId === projectId ? identity : null
  const projectName = nameGiven ? (givenName ?? null) : (cachedName ?? ownRead?.name ?? null)
  const nameLoading = nameGiven ? projectNameLoading : cachedName === undefined && ownRead === null
  const [projectList, setProjectList] = useState(cachedProjectList)
  const projectOptions = (projectList ?? []).map((p) => ({ value: p.id, label: p.name }))
  useEffect(() => {
    if (!readOnly || cachedProjectList()?.some((p) => p.id === projectId)) return
    let cancelled = false
    // Nothing cached yet, or a cached list without the project on screen
    // (created since, M-1b): projectListFor re-reads once, then settles.
    projectListFor(projectId)
      .then((rows) => {
        if (!cancelled) setProjectList(rows)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [readOnly, projectId])
  useEffect(() => {
    if (readOnly || nameGiven || cachedProjectName(projectId) !== undefined) return
    let cancelled = false
    fieldProjectName(projectId)
      .then((name) => {
        if (!cancelled) setIdentity({ projectId, name })
      })
      .catch(() => {
        if (!cancelled) setIdentity({ projectId, name: null })
      })
    return () => {
      cancelled = true
    }
  }, [readOnly, nameGiven, projectId])

  const base = `${APP_BASE_PATH}/gs/${projectId}`
  /**
   * The page on screen, read from the route. matchPath, not NavLink's own
   * comparison: NavLink with `end` compares the pathname byte for byte, so a
   * shared `/gs/p1/` or `/gs/p1/kpi/` -- which the routes still match -- lit
   * no tab at all.
   */
  const current = SECTIONS.find((s) => matchPath(`${APP_BASE_PATH}/gs/:projectId${s.suffix}`, pathname))
  const section = current ?? SECTIONS[0]

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
      {/*
        One width for both roles and every state (M-3): the tabs start at the
        same place whether the name is loading, loaded or missing, and whether
        a name or the viewer's Select sits here.
      */}
      <div
        data-testid="field-header-project"
        aria-busy={!readOnly && nameLoading ? true : undefined}
        style={{ flex: '0 1 auto', minWidth: 0, width: phone ? 140 : 220 }}
      >
        {readOnly ? (
          <Select
            aria-label="Dự án"
            style={{ width: '100%' }}
            value={projectId}
            onChange={(id) => navigate(`${APP_BASE_PATH}/gs/${id}${section.suffix}`)}
            {...searchSelectProps}
            options={projectOptions.some((o) => o.value === projectId)
              ? projectOptions
              : [{ value: projectId, label: projectId }, ...projectOptions]}
          />
        ) : (
          nameLoading ? (
            <Skeleton.Input active size="small" block aria-hidden />
          ) : (
            <div style={{ ...ellipsis, fontWeight: 600 }}>{projectName}</div>
          )
        )}
      </div>

      <nav aria-label="Điều hướng" style={{ display: 'flex', alignSelf: 'stretch', flex: 'none' }}>
        {SECTIONS.map((s) => (
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
