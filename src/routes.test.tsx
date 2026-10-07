import type { Session } from '@supabase/supabase-js'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Outlet, useParams } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthProvider } from './auth/AuthProvider'
import { APP_BASE_PATH } from './config'
import { AppRoutes } from './routes'
import { COPYRIGHT } from './test/copy'

const getSession = vi.hoisted(() => vi.fn())
const onAuthStateChange = vi.hoisted(() =>
  vi.fn((_cb?: (event: string, next: Session | null) => void) => ({
    data: { subscription: { unsubscribe: vi.fn() } },
  })),
)
const maybeSingle = vi.hoisted(() => vi.fn())
const myFirstProjectId = vi.hoisted(() => vi.fn())

// AppRoutes is exercised through a real AuthProvider (like RequireRole.test.tsx
// does) because the behaviour under test -- reading the real profile.role and
// choosing where to land -- lives partly in IndexRedirect and partly in
// RequireRole's own gating. Only their Supabase dependency is faked.
vi.mock('./lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: (...args: unknown[]) => getSession(...args),
      onAuthStateChange: (cb?: (event: string, next: Session | null) => void) =>
        onAuthStateChange(cb),
      signInWithPassword: vi.fn(),
      signOut: vi.fn(),
    },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }),
  },
}))

vi.mock('./lib/projectsApi', () => ({
  myFirstProjectId: () => myFirstProjectId(),
}))

// The four admin screens are heavy (pdf.js, Konva, their own data fetching)
// and are not what this file is about -- it is about which route the app
// sends a signed-in profile to, not what each destination screen renders once
// it gets there. AdminLayout keeps a real <Outlet/> so its nested routes
// still render through it.
vi.mock('./screens/admin/AdminLayout', () => ({
  AdminLayout: () => (
    <div>
      ADMIN LAYOUT
      <Outlet />
    </div>
  ),
}))
vi.mock('./screens/admin/ProjectsScreen', () => ({
  ProjectsScreen: () => <div>PROJECTS SCREEN</div>,
}))
vi.mock('./screens/admin/DecksScreen', () => ({
  DecksScreen: () => <div>DECKS SCREEN</div>,
}))
vi.mock('./screens/admin/NhanLucScreen', () => ({
  NhanLucScreen: () => <div>NHAN LUC SCREEN</div>,
}))
// Konva, and its own data fetching. This file is about which route
// a signed-in profile lands on, not what the destination renders. The projectId
// is rendered so the assertion below can prove the redirect landed on THIS
// project's screen and not merely "some" GS route.
vi.mock('./screens/dashboard/DashboardScreen', () => ({
  DashboardScreen: ({ variant }: { variant: string }) => {
    const { projectId } = useParams()
    return <div>DASHBOARD {variant}{projectId ? ` (dự án ${projectId})` : ''}</div>
  },
}))
// Recharts and its own three reads. Like the dashboard's stand-in, it prints
// the variant and the project id so an assertion can prove the gate landed on
// THIS project's KPI screen rather than merely on "some" KPI route.
vi.mock('./screens/kpi/KpiScreen', () => ({
  KpiScreen: ({ variant }: { variant: string }) => {
    const { projectId } = useParams()
    return <div>KPI {variant}{projectId ? ` (dự án ${projectId})` : ''}</div>
  },
}))
// The Piping screen's own reads and tests live beside it; here only where it lands.
vi.mock('./screens/piping/PipingScreen', () => ({
  PipingScreen: ({ variant }: { variant: string }) => {
    const { projectId } = useParams()
    return <div>PIPING {variant}{projectId ? ` (dự án ${projectId})` : ''}</div>
  },
}))
vi.mock('./screens/gs/GsScreen', () => ({
  GsScreen: () => {
    const { projectId } = useParams()
    return <div>GS SCREEN (dự án {projectId})</div>
  },
}))
// The viewer's landing page (RV6-23): its own reads, its own tests.
vi.mock('./screens/gs/ProjectPickerScreen', () => ({
  ProjectPickerScreen: () => <div>PROJECT PICKER</div>,
}))

const fakeSession = { access_token: 'token', user: { id: 'user-1' } } as unknown as Session

const renderAt = (path: string) =>
  render(
    <AuthProvider>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>
    </AuthProvider>,
  )

const renderAtBasePath = () => renderAt(APP_BASE_PATH || '/')

beforeEach(() => {
  getSession.mockReset()
  onAuthStateChange.mockReset()
  onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } })
  maybeSingle.mockReset()
  myFirstProjectId.mockReset()
  getSession.mockResolvedValue({ data: { session: fakeSession } })
})

describe('AppRoutes: landing at the base path by role', () => {
  it('sends an admin profile to the projects screen, not the bare 404', async () => {
    maybeSingle.mockResolvedValue({
      data: { id: 'user-1', username: 'admin1', full_name: 'Admin Một', role: 'admin', active: true },
      error: null,
    })

    renderAtBasePath()

    expect(await screen.findByText('PROJECTS SCREEN')).toBeInTheDocument()
    expect(screen.queryByText('404')).toBeNull()
  })

  it('sends a gs profile with one membership to that project\'s GS route, not the bare 404', async () => {
    maybeSingle.mockResolvedValue({
      data: { id: 'user-1', username: 'gs1', full_name: 'GS Một', role: 'gs', active: true },
      error: null,
    })
    myFirstProjectId.mockResolvedValue('proj-1')

    renderAtBasePath()

    // Asserts on the destination project id actually reaching the rendered
    // screen, not merely "some" GS route -- a redirect that landed on the
    // wrong project would still show "GS SCREEN" with no project id.
    expect(await screen.findByText('GS SCREEN (dự án proj-1)')).toBeInTheDocument()
    expect(screen.queryByText('404')).toBeNull()
  })

  it('sends a viewer to the project picker, without asking for a membership (RV6-23)', async () => {
    // 0034: a viewer sees every project and holds no project_members row, so
    // `myFirstProjectId()` would answer null and the 0028 landing would tell
    // the boss to ask the admin for access they already have.
    maybeSingle.mockResolvedValue({
      data: { id: 'user-1', username: 'boss1', full_name: 'Sếp Một', role: 'viewer', active: true },
      error: null,
    })
    myFirstProjectId.mockResolvedValue(null)

    renderAtBasePath()

    expect(await screen.findByText('PROJECT PICKER')).toBeInTheDocument()
    expect(myFirstProjectId).not.toHaveBeenCalled()
    expect(screen.queryByText('Chưa được thêm vào dự án nào')).toBeNull()
    expect(screen.queryByText('404')).toBeNull()
  })

  it('refuses a foreman the project picker: /gs is the viewer\'s alone', async () => {
    maybeSingle.mockResolvedValue({
      data: { id: 'user-1', username: 'gs1', full_name: 'GS Một', role: 'gs', active: true },
      error: null,
    })
    renderAt(`${APP_BASE_PATH}/gs`)
    // Signed in and active: the branded page with a way to the foreman's own
    // home, not the bare 404 a stranger gets.
    expect(await screen.findByText('Không tìm thấy trang')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Về trang chính' })).toHaveAttribute('href', APP_BASE_PATH || '/')
    expect(screen.queryByText('PROJECT PICKER')).toBeNull()
    expect(screen.queryByText('404')).toBeNull()
  })

  it('tells a membership-less gs to contact the admin, not the bare 404', async () => {
    maybeSingle.mockResolvedValue({
      data: { id: 'user-1', username: 'gs2', full_name: 'GS Hai', role: 'gs', active: true },
      error: null,
    })
    myFirstProjectId.mockResolvedValue(null)

    renderAtBasePath()

    expect(await screen.findByText('Chưa được thêm vào dự án nào')).toBeInTheDocument()
    expect(screen.queryByText('404')).toBeNull()
    // A steady screen a real account sees, so it ends with the line (RV7-2).
    expect(screen.getByText(COPYRIGHT)).toBeInTheDocument()
  })

  it('tells a gs whose profile load failed to check their connection, not the bare 404', async () => {
    maybeSingle.mockResolvedValue({
      data: { id: 'user-1', username: 'gs3', full_name: 'GS Ba', role: 'gs', active: true },
      error: null,
    })
    myFirstProjectId.mockRejectedValue(new Error('Network error'))

    renderAtBasePath()

    expect(await screen.findByText('Không tải được thông tin dự án')).toBeInTheDocument()
    expect(screen.queryByText('Chưa được thêm vào dự án nào')).toBeNull()
    expect(screen.queryByText('404')).toBeNull()
    expect(screen.getByText(COPYRIGHT)).toBeInTheDocument()
  })
})

describe('AppRoutes: /login is the entry point', () => {
  const asRole = (role: 'admin' | 'gs' | 'viewer') => maybeSingle.mockResolvedValue({
    data: { id: 'user-1', username: 'u', full_name: 'U', role, active: true },
    error: null,
  })

  it('sends a signed-in admin from /login to their own screen', async () => {
    // "Redirect by role after login" is this: signing in re-renders the same
    // route with a session, and the role on the profile the auth context
    // already loaded decides where it goes. Nothing new is fetched.
    asRole('admin')
    renderAt(`${APP_BASE_PATH}/login`)
    expect(await screen.findByText('PROJECTS SCREEN')).toBeInTheDocument()
  })

  it('sends a signed-in foreman from /login to their own project', async () => {
    asRole('gs')
    myFirstProjectId.mockResolvedValue('proj-9')
    renderAt(`${APP_BASE_PATH}/login`)
    expect(await screen.findByText('GS SCREEN (dự án proj-9)')).toBeInTheDocument()
  })

  it('shows the login form at /login to a stranger', async () => {
    getSession.mockResolvedValue({ data: { session: null } })
    renderAt(`${APP_BASE_PATH}/login`)
    expect(await screen.findByLabelText('Tên đăng nhập')).toBeInTheDocument()
  })

  it('still answers at the root, so an old bookmark keeps working', async () => {
    asRole('admin')
    renderAt(APP_BASE_PATH || '/')
    expect(await screen.findByText('PROJECTS SCREEN')).toBeInTheDocument()
  })

  it('gives an admin the productivity dashboard under the admin frame (Feedback Rv2, item 12)', async () => {
    asRole('admin')
    renderAt(`${APP_BASE_PATH}/admin/dashboard`)
    expect(await screen.findByText('DASHBOARD admin')).toBeInTheDocument()
    expect(screen.getByText(/ADMIN LAYOUT/)).toBeInTheDocument()
  })

  it('gives a viewer the field dashboard of their project, and not the admin one', async () => {
    asRole('viewer')
    renderAt(`${APP_BASE_PATH}/gs/proj-4/dashboard`)
    expect(await screen.findByText('DASHBOARD gs (dự án proj-4)')).toBeInTheDocument()
  })

  it('gives an admin the KPI screen under the admin frame (Feedback Rv5, item 9)', async () => {
    // RV5-28: KPI is its own item on the menu, and the admin is the one who
    // types the plan dates.
    asRole('admin')
    renderAt(`${APP_BASE_PATH}/admin/kpi`)
    expect(await screen.findByText('KPI admin')).toBeInTheDocument()
    expect(screen.getByText(/ADMIN LAYOUT/)).toBeInTheDocument()
  })

  it('gives a foreman the field KPI chart of their project', async () => {
    asRole('gs')
    renderAt(`${APP_BASE_PATH}/gs/proj-7/kpi`)
    expect(await screen.findByText('KPI gs (dự án proj-7)')).toBeInTheDocument()
  })

  it('gives a viewer the field KPI chart too, and not the admin one (RV5-29)', async () => {
    // The owner relayed Linh's "được": admin writes the plan dates; admin, gs
    // and viewer all read the charts. Without the viewer in the route's gate
    // this lands on the 404 instead.
    asRole('viewer')
    renderAt(`${APP_BASE_PATH}/gs/proj-4/kpi`)
    expect(await screen.findByText('KPI gs (dự án proj-4)')).toBeInTheDocument()
    expect(screen.queryByText('404')).toBeNull()
  })

  it('refuses a foreman the admin KPI screen', async () => {
    // admin/kpi sits under RequireRole role="admin", so the field cannot reach
    // the entry table even by typing the URL.
    asRole('gs')
    renderAt(`${APP_BASE_PATH}/admin/kpi`)
    expect(await screen.findByText('Không tìm thấy trang')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Về trang chính' })).toHaveAttribute('href', APP_BASE_PATH || '/')
    expect(screen.queryByText('KPI admin')).toBeNull()
    expect(screen.queryByText('ADMIN LAYOUT')).toBeNull()
  })

  it('gives an admin the Piping screen under the admin frame (piping spec §11)', async () => {
    asRole('admin')
    renderAt(`${APP_BASE_PATH}/admin/piping`)
    expect(await screen.findByText('PIPING admin')).toBeInTheDocument()
    expect(screen.getByText(/ADMIN LAYOUT/)).toBeInTheDocument()
  })

  it.each(['gs', 'viewer'] as const)('gives a %s the field Piping screen of the project', async (role) => {
    asRole(role)
    renderAt(`${APP_BASE_PATH}/gs/proj-7/piping`)
    expect(await screen.findByText('PIPING gs (dự án proj-7)')).toBeInTheDocument()
  })

  it('refuses a foreman the admin Piping screen', async () => {
    asRole('gs')
    renderAt(`${APP_BASE_PATH}/admin/piping`)
    expect(await screen.findByText('Không tìm thấy trang')).toBeInTheDocument()
    expect(screen.queryByText('PIPING admin')).toBeNull()
  })

  it('gives an admin Nhân lực at the users address (NL-01)', async () => {
    asRole('admin')
    renderAt(`${APP_BASE_PATH}/admin/users`)
    expect(await screen.findByText('NHAN LUC SCREEN')).toBeInTheDocument()
  })

  it('sends /admin itself to Dự án, where login, the role home and the not-found page go (M13)', async () => {
    asRole('admin')
    renderAt(`${APP_BASE_PATH}/admin`)
    expect(await screen.findByText('PROJECTS SCREEN')).toBeInTheDocument()
    expect(screen.queryByText('NHAN LUC SCREEN')).toBeNull()
  })

  it('sends the old staff roster address to Nhân lực, so a bookmark still lands (NL-01)', async () => {
    asRole('admin')
    renderAt(`${APP_BASE_PATH}/admin/employees`)
    expect(await screen.findByText('NHAN LUC SCREEN')).toBeInTheDocument()
    expect(screen.queryByText('Không tìm thấy trang')).toBeNull()
  })

  // -------------------------------------------------------------------
  // QA F2 -- a path that is not a route
  // -------------------------------------------------------------------

  it('gives a stranger at a path that is not a route the bare 404, as spec §7.3 asks', async () => {
    getSession.mockResolvedValue({ data: { session: null } })
    renderAt('/nope')
    expect(await screen.findByText('404')).toBeInTheDocument()
    expect(screen.queryByText('Không tìm thấy trang')).toBeNull()
  })

  it('tells a signed-in account at a path that is not a route so, with a way home', async () => {
    // Nothing to hide from an account that is already in: the bare 404 left
    // a mistyped URL as a blank page with no way back.
    asRole('admin')
    renderAt('/nope')
    expect(await screen.findByText('Không tìm thấy trang')).toBeInTheDocument()
    // Straight to the role's own home, as the role gate's page does (N-1).
    expect(screen.getByRole('link', { name: 'Về trang chính' })).toHaveAttribute('href', `${APP_BASE_PATH}/admin/projects`)
    expect(screen.queryByText('404')).toBeNull()
    expect(screen.queryByText('ADMIN LAYOUT')).toBeNull()
  })

  it('keeps an admin inside the admin shell at an unknown admin path, with a way to Dự án', async () => {
    asRole('admin')
    renderAt(`${APP_BASE_PATH}/admin/productivity`)
    expect(await screen.findByText('Không tìm thấy trang')).toBeInTheDocument()
    expect(screen.getByText('ADMIN LAYOUT')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Về trang chính' })).toHaveAttribute('href', `${APP_BASE_PATH}/admin/projects`)
    expect(screen.queryByText('404')).toBeNull()
  })

  it('gives the wrong role the same page at a known and an unknown admin path -- the gate reveals nothing', async () => {
    asRole('gs')
    const known = renderAt(`${APP_BASE_PATH}/admin/users`)
    expect(await screen.findByText('Không tìm thấy trang')).toBeInTheDocument()
    const knownPage = known.container.innerHTML
    known.unmount()
    const unknown = renderAt(`${APP_BASE_PATH}/admin/productivity`)
    expect(await screen.findByText('Không tìm thấy trang')).toBeInTheDocument()
    expect(unknown.container.innerHTML).toBe(knownPage)
    expect(screen.queryByText('NHAN LUC SCREEN')).toBeNull()
  })

  it.each([
    ['viewer', `${APP_BASE_PATH}/admin/projects`, `${APP_BASE_PATH}/gs`],
    ['admin', `${APP_BASE_PATH}/gs/proj-1`, `${APP_BASE_PATH}/admin/projects`],
  ] as const)('sends a signed-in %s at a route of another role to its own home', async (role, path, home) => {
    asRole(role)
    renderAt(path)
    expect(await screen.findByText('Không tìm thấy trang')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Về trang chính' })).toHaveAttribute('href', home)
  })

  it.each([
    ['admin', `${APP_BASE_PATH}/gs/p1`, `${APP_BASE_PATH}/gs/p1/xyz`],
    ['admin', `${APP_BASE_PATH}/gs`, `${APP_BASE_PATH}/gsx`],
    ['viewer', `${APP_BASE_PATH}/admin/users`, `${APP_BASE_PATH}/zzz`],
    ['gs', `${APP_BASE_PATH}/admin/users`, `${APP_BASE_PATH}/gs/p1/xyz`],
  ] as const)(
    'gives a signed-in %s the identical page at a gated route (%s) and at no route at all (%s) (N-1)',
    async (role, gated, unknown) => {
      asRole(role)
      const first = renderAt(gated)
      expect(await screen.findByText('Không tìm thấy trang')).toBeInTheDocument()
      const gatedPage = first.container.innerHTML
      first.unmount()
      const second = renderAt(unknown)
      expect(await screen.findByText('Không tìm thấy trang')).toBeInTheDocument()
      expect(second.container.innerHTML).toBe(gatedPage)
    },
  )

  it('keeps the bare 404 for a deactivated account, which is not signed in for any purpose', async () => {
    maybeSingle.mockResolvedValue({
      data: { id: 'user-1', username: 'u', full_name: 'U', role: 'gs', active: false },
      error: null,
    })
    renderAt(`${APP_BASE_PATH}/admin/users`)
    expect(await screen.findByText('404')).toBeInTheDocument()
    expect(screen.queryByText('Không tìm thấy trang')).toBeNull()
  })

  it('keeps the bare 404 for a session with no profile row', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null })
    renderAt(`${APP_BASE_PATH}/admin/users`)
    expect(await screen.findByText('404')).toBeInTheDocument()
    expect(screen.queryByText('Không tìm thấy trang')).toBeNull()
    // Bare means bare: not even the copyright line (spec §7.3).
    expect(screen.queryByText(COPYRIGHT)).toBeNull()
  })
})
