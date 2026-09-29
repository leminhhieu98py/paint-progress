import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { endSession } from '../../lib/sessionCache'
import { FieldHeader } from './FieldHeader'

const listProjectNames = vi.hoisted(() => vi.fn())
vi.mock('../../lib/projectsApi', () => ({
  listProjectNames: () => listProjectNames(),
}))
const loadGsProjectIdentity = vi.hoisted(() => vi.fn())
vi.mock('../../lib/gsApi', () => ({
  loadGsProjectIdentity: (projectId: string) => loadGsProjectIdentity(projectId),
}))
// react-router's navigate, so a test can see where the project switch and the
// logout send the user. Link does not go through this export, so the tabs
// still navigate for real.
const navigate = vi.hoisted(() => vi.fn())
vi.mock('react-router-dom', async (importOriginal) => ({
  ...await importOriginal<typeof import('react-router-dom')>(),
  useNavigate: () => navigate,
}))
const signOut = vi.hoisted(() => vi.fn())
const authRole = vi.hoisted(() => ({ value: 'gs' as 'gs' | 'viewer' }))
vi.mock('../../auth/AuthProvider', () => ({
  useAuth: () => ({
    profile: { id: 'u1', username: 'gs1', fullName: 'Nguyễn Văn A', role: authRole.value, active: true },
    signOut,
  }),
}))

/**
 * A viewport of `width` px for antd's breakpoints. jsdom has no layout, so the
 * shared shim answers every media query with `false` -- a phone. This one
 * answers the min/max-width queries antd's Grid asks against a real width.
 */
const originalMatchMedia = window.matchMedia
function setViewport(width: number) {
  window.matchMedia = ((query: string) => {
    const min = /min-width:\s*([\d.]+)px/.exec(query)
    const max = /max-width:\s*([\d.]+)px/.exec(query)
    const matches = (!min || width >= Number(min[1])) && (!max || width <= Number(max[1]))
    return {
      matches,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }
  }) as typeof window.matchMedia
}

/** The address, as the header leaves it. */
function PathEcho() {
  return <div data-testid="path">{useLocation().pathname}</div>
}

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        {['/gs/:projectId', '/gs/:projectId/dashboard', '/gs/:projectId/kpi'].map((p) => (
          <Route
            key={p}
            path={p}
            element={(
              <>
                <FieldHeader projectId="p1" />
                <PathEcho />
              </>
            )}
          />
        ))}
      </Routes>
    </MemoryRouter>,
  )

const nav = () => screen.getByRole('navigation', { name: 'Điều hướng' })
const tab = (name: string) => within(nav()).getByRole('link', { name })

beforeEach(() => {
  // Project names are kept per session (fieldProjects); every test is a new one.
  endSession()
  authRole.value = 'gs'
  setViewport(1280)
  navigate.mockReset()
  signOut.mockReset()
  signOut.mockResolvedValue(undefined)
  listProjectNames.mockReset()
  listProjectNames.mockResolvedValue([
    { id: 'p1', name: 'BlockB1_CPPTS', code: 'BB1' },
    { id: 'p2', name: 'Đại Hùng', code: 'DH' },
  ])
  loadGsProjectIdentity.mockReset()
  loadGsProjectIdentity.mockResolvedValue({ code: 'BB1', name: 'BlockB1_CPPTS' })
})

afterEach(() => {
  window.matchMedia = originalMatchMedia
})

describe('FieldHeader: navigation (GS-01)', () => {
  it('holds Sàn, Năng suất and KPI as links of this project inside one nav landmark', () => {
    renderAt('/gs/p1')
    const links = within(nav()).getAllByRole('link')
    expect(links.map((l) => l.textContent)).toEqual(['Sàn', 'Năng suất', 'KPI'])
    expect(tab('Sàn')).toHaveAttribute('href', '/gs/p1')
    expect(tab('Năng suất')).toHaveAttribute('href', '/gs/p1/dashboard')
    expect(tab('KPI')).toHaveAttribute('href', '/gs/p1/kpi')
  })

  it.each([
    ['/gs/p1', 'Sàn'],
    ['/gs/p1/dashboard', 'Năng suất'],
    ['/gs/p1/kpi', 'KPI'],
    // A hand-typed or shared address with a trailing slash matches the same route.
    ['/gs/p1/', 'Sàn'],
    ['/gs/p1/dashboard/', 'Năng suất'],
    ['/gs/p1/kpi/', 'KPI'],
  ])('marks the tab of the route as the current page on %s', (path, active) => {
    renderAt(path)
    for (const name of ['Sàn', 'Năng suất', 'KPI']) {
      if (name === active) expect(tab(name)).toHaveAttribute('aria-current', 'page')
      else expect(tab(name)).not.toHaveAttribute('aria-current')
    }
  })

  it('goes where a tab points and moves the active mark with it', async () => {
    renderAt('/gs/p1')
    await userEvent.click(tab('KPI'))
    expect(screen.getByTestId('path')).toHaveTextContent('/gs/p1/kpi')
    expect(tab('KPI')).toHaveAttribute('aria-current', 'page')
    await userEvent.click(tab('Sàn'))
    expect(screen.getByTestId('path')).toHaveTextContent(/^\/gs\/p1$/)
    expect(tab('Sàn')).toHaveAttribute('aria-current', 'page')
  })

  it('can be walked with the keyboard', async () => {
    authRole.value = 'gs'
    renderAt('/gs/p1/dashboard')
    const user = userEvent.setup()
    await user.tab()
    expect(tab('Sàn')).toHaveFocus()
    await user.tab()
    expect(tab('Năng suất')).toHaveFocus()
    await user.tab()
    expect(tab('KPI')).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(screen.getByTestId('path')).toHaveTextContent('/gs/p1/kpi')
  })

  it('keeps everything on one line of one fixed height', () => {
    renderAt('/gs/p1')
    const header = nav().closest('header') as HTMLElement
    expect(header).toHaveStyle({ height: '64px', flexWrap: 'nowrap' })
  })
})

describe('FieldHeader: the project', () => {
  it('names a foreman\'s project as text, with no switch and no read of the list', async () => {
    renderAt('/gs/p1')
    expect(await screen.findByText('BlockB1_CPPTS')).toBeInTheDocument()
    expect(loadGsProjectIdentity).toHaveBeenCalledWith('p1')
    expect(screen.queryByRole('combobox', { name: 'Dự án' })).toBeNull()
    expect(listProjectNames).not.toHaveBeenCalled()
    expect(screen.queryByText('Chỉ xem')).toBeNull()
  })

  it('still renders the rest of the header when the project name cannot be read', async () => {
    loadGsProjectIdentity.mockRejectedValue(new Error('Failed to fetch'))
    renderAt('/gs/p1')
    await waitFor(() => expect(loadGsProjectIdentity).toHaveBeenCalled())
    expect(tab('Sàn')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Đăng xuất' })).toBeInTheDocument()
  })

  it('gives a viewer the searchable project switch, on the project on screen (RV6-24)', async () => {
    authRole.value = 'viewer'
    renderAt('/gs/p1')
    const box = await screen.findByRole('combobox', { name: 'Dự án' })
    expect(await screen.findByText('BlockB1_CPPTS', { selector: '.ant-select-selection-item' })).toBeInTheDocument()
    expect(loadGsProjectIdentity).not.toHaveBeenCalled()
    await userEvent.type(box, 'dai')
    expect(await screen.findByTitle('Đại Hùng')).toBeInTheDocument()
    expect(screen.getByText('Chỉ xem')).toBeInTheDocument()
  })

  it.each([
    ['/gs/p1', '/gs/p2'],
    ['/gs/p1/dashboard', '/gs/p2/dashboard'],
    ['/gs/p1/kpi', '/gs/p2/kpi'],
  ])('switches a viewer on %s to the same page of the chosen project', async (from, to) => {
    authRole.value = 'viewer'
    renderAt(from)
    await userEvent.click(await screen.findByRole('combobox', { name: 'Dự án' }))
    await userEvent.click(await screen.findByTitle('Đại Hùng'))
    expect(navigate).toHaveBeenCalledWith(to)
  })

  it('reads a viewer\'s list once per session, across remounts and project switches (M-1)', async () => {
    // The header remounts on every field page and every project switch, so
    // "once" has to hold across mounts, not only across rerenders.
    authRole.value = 'viewer'
    const first = renderAt('/gs/p1')
    expect(await screen.findByText('BlockB1_CPPTS', { selector: '.ant-select-selection-item' })).toBeInTheDocument()
    first.unmount()
    renderAt('/gs/p1/kpi')
    expect(screen.getByText('BlockB1_CPPTS', { selector: '.ant-select-selection-item' })).toBeInTheDocument()
    expect(listProjectNames).toHaveBeenCalledTimes(1)
  })

  it('reads the viewer\'s list again after the session ends', async () => {
    authRole.value = 'viewer'
    const first = renderAt('/gs/p1')
    await screen.findByText('BlockB1_CPPTS', { selector: '.ant-select-selection-item' })
    first.unmount()
    endSession()
    renderAt('/gs/p1')
    await waitFor(() => expect(listProjectNames).toHaveBeenCalledTimes(2))
  })

  it('takes a foreman\'s project name from its host, with no read of its own', () => {
    render(
      <MemoryRouter initialEntries={['/gs/p1']}>
        <FieldHeader projectId="p1" projectName="Giàn đã đọc" />
      </MemoryRouter>,
    )
    expect(screen.getByText('Giàn đã đọc')).toBeInTheDocument()
    expect(loadGsProjectIdentity).not.toHaveBeenCalled()
  })

  it('reads a foreman\'s project name once per session, not on every page', async () => {
    const first = renderAt('/gs/p1/kpi')
    expect(await screen.findByText('BlockB1_CPPTS')).toBeInTheDocument()
    first.unmount()
    renderAt('/gs/p1/dashboard')
    expect(screen.getByText('BlockB1_CPPTS')).toBeInTheDocument()
    expect(loadGsProjectIdentity).toHaveBeenCalledTimes(1)
  })

  it('names the new project, never the old one, when a foreman\'s project changes', async () => {
    loadGsProjectIdentity.mockImplementation((id: string) =>
      Promise.resolve(id === 'p1' ? { code: 'BB1', name: 'BlockB1_CPPTS' } : { code: 'DH', name: 'Đại Hùng' }))
    const view = (id: string) => (
      <MemoryRouter initialEntries={[`/gs/${id}`]}>
        <FieldHeader projectId={id} />
      </MemoryRouter>
    )
    const { rerender } = render(view('p1'))
    expect(await screen.findByText('BlockB1_CPPTS')).toBeInTheDocument()
    rerender(view('p2'))
    expect(screen.queryByText('BlockB1_CPPTS')).toBeNull()
    expect(await screen.findByText('Đại Hùng')).toBeInTheDocument()
  })

  it('keeps the project on screen in the switch when the list cannot be read', async () => {
    authRole.value = 'viewer'
    listProjectNames.mockRejectedValue(new Error('Failed to fetch'))
    renderAt('/gs/p1')
    expect(await screen.findByRole('combobox', { name: 'Dự án' })).toBeInTheDocument()
    expect(screen.getByText('p1', { selector: '.ant-select-selection-item' })).toBeInTheDocument()
  })
})

describe('FieldHeader: who is signed in', () => {
  it('shows the full name with the login beneath it', () => {
    renderAt('/gs/p1')
    expect(screen.getByText('Nguyễn Văn A')).toBeInTheDocument()
    expect(screen.getByText('gs1')).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: 'Nguyễn Văn A (gs1)' })).toBeNull()
  })

  it('asks before signing out, then replaces the page with the login', async () => {
    renderAt('/gs/p1')
    await userEvent.click(screen.getByRole('button', { name: 'Đăng xuất' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Đăng xuất?')).toBeInTheDocument()
    expect(within(dialog).getByText('Phiên làm việc hiện tại sẽ kết thúc:')).toBeInTheDocument()
    expect(within(dialog).getByText(
      'Muốn ghi tiếp tiến độ thì phải đăng nhập lại bằng mật khẩu quản trị viên đã giao.',
    )).toBeInTheDocument()
    expect(signOut).not.toHaveBeenCalled()

    await userEvent.click(within(dialog).getByRole('button', { name: 'Vẫn đăng xuất' }))
    expect(signOut).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/login', { replace: true }))
  })

  it('stays signed in when the confirm is cancelled', async () => {
    renderAt('/gs/p1')
    await userEvent.click(screen.getByRole('button', { name: 'Đăng xuất' }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Huỷ' }))
    expect(signOut).not.toHaveBeenCalled()
  })
})

describe('FieldHeader: phone width', () => {
  beforeEach(() => setViewport(390))

  it('folds the name block into an avatar of initials whose tooltip gives name and login', async () => {
    renderAt('/gs/p1')
    const avatar = screen.getByRole('img', { name: 'Nguyễn Văn A (gs1)' })
    expect(avatar).toHaveTextContent('NA')
    expect(screen.queryByText('Nguyễn Văn A')).toBeNull()
    await userEvent.hover(avatar)
    const tip = await screen.findByRole('tooltip')
    expect(tip).toHaveTextContent('Nguyễn Văn A')
    expect(tip).toHaveTextContent('gs1')
  })

  it('opens the avatar tooltip from the keyboard too', async () => {
    renderAt('/gs/p1')
    screen.getByRole('img', { name: 'Nguyễn Văn A (gs1)' }).focus()
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Nguyễn Văn A')
  })

  it.each(['gs', 'viewer'] as const)(
    'gives up width only from the project slot, never from the tabs, avatar or logout (%s)',
    (role) => {
      authRole.value = role
      renderAt('/gs/p1')
      // flex: none on everything but the project slot: an overflowing row
      // shrinks the name or the Select (ellipsis), and logout stays on screen.
      const right = screen.getByRole('button', { name: 'Đăng xuất' }).parentElement as HTMLElement
      expect(right).toHaveStyle({ flexGrow: '0', flexShrink: '0' })
      expect(nav()).toHaveStyle({ flexShrink: '0' })
      expect(screen.getByTestId('field-header-project')).toHaveStyle({ flexShrink: '1', minWidth: '0px' })
    },
  )

  it('keeps the tab labels', () => {
    renderAt('/gs/p1')
    expect(within(nav()).getAllByRole('link').map((l) => l.textContent)).toEqual(['Sàn', 'Năng suất', 'KPI'])
  })

  it('carries a viewer\'s Chỉ xem into the avatar, where the badge has no room', async () => {
    authRole.value = 'viewer'
    renderAt('/gs/p1')
    expect(await screen.findByRole('combobox', { name: 'Dự án' })).toBeInTheDocument()
    expect(screen.queryByText('Chỉ xem')).toBeNull()
    const avatar = screen.getByRole('img', { name: 'Nguyễn Văn A (gs1) · Chỉ xem' })
    await userEvent.hover(avatar)
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Chỉ xem')
  })
})
