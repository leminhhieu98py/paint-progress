import type { Session } from '@supabase/supabase-js'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Outlet, useParams } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthProvider } from './auth/AuthProvider'
import { APP_BASE_PATH } from './config'
import { AppRoutes } from './routes'

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
vi.mock('./screens/admin/UsersScreen', () => ({
  UsersScreen: () => <div>USERS SCREEN</div>,
}))
// Konva and recharts, and its own data fetching. This file is about which route
// a signed-in profile lands on, not what the destination renders. The projectId
// is rendered so the assertion below can prove the redirect landed on THIS
// project's screen and not merely "some" GS route.
vi.mock('./screens/gs/GsScreen', () => ({
  GsScreen: () => {
    const { projectId } = useParams()
    return <div>GS SCREEN (dự án {projectId})</div>
  },
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

  it('tells a membership-less gs to contact the admin, not the bare 404', async () => {
    maybeSingle.mockResolvedValue({
      data: { id: 'user-1', username: 'gs2', full_name: 'GS Hai', role: 'gs', active: true },
      error: null,
    })
    myFirstProjectId.mockResolvedValue(null)

    renderAtBasePath()

    expect(await screen.findByText('Chưa được thêm vào dự án nào')).toBeInTheDocument()
    expect(screen.queryByText('404')).toBeNull()
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
  })
})

describe('AppRoutes: /login is the entry point', () => {
  const asRole = (role: 'admin' | 'gs') => maybeSingle.mockResolvedValue({
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

  it('gives a path that is not a route the bare 404, as spec §7.3 asks', async () => {
    asRole('admin')
    renderAt('/nope')
    expect(await screen.findByText('404')).toBeInTheDocument()
  })
})
