import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { endSession } from '../../lib/sessionCache'
import { fieldAccountMenuItems } from './fieldAccountMenu'
import { FieldHeader } from './FieldHeader'
import { FieldLayout } from './FieldLayout'

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

describe('FieldHeader: navigation and the account, nothing else (GS-06)', () => {
  const trigger = (name = 'Nguyễn Văn A (gs1)') => screen.getByRole('button', { name })
  const openMenu = async (name?: string) => {
    await userEvent.click(trigger(name))
    return screen.findByRole('menu')
  }

  it('has no project in it: no switch, no name, no read of either', async () => {
    renderAt('/gs/p1')
    expect(screen.queryByRole('combobox', { name: 'Dự án' })).toBeNull()
    expect(screen.queryByText('BlockB1_CPPTS')).toBeNull()
    await Promise.resolve()
    expect(listProjectNames).not.toHaveBeenCalled()
    expect(loadGsProjectIdentity).not.toHaveBeenCalled()
  })

  it('puts the tabs first and the account trigger last', () => {
    renderAt('/gs/p1')
    const header = nav().closest('header') as HTMLElement
    const focusable = Array.from(header.querySelectorAll('a, button'))
    expect(focusable.map((e) => e.textContent)).toEqual(['Sàn', 'Năng suất', 'KPI', expect.stringContaining('Nguyễn Văn A')])
  })

  it('reaches the account trigger from the keyboard, after the tabs', async () => {
    renderAt('/gs/p1')
    const user = userEvent.setup()
    await user.tab()
    await user.tab()
    await user.tab()
    await user.tab()
    expect(trigger()).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(await screen.findByRole('menu')).toBeInTheDocument()
  })

  it('shows an avatar of initials and the full name on the trigger, and no logout button', () => {
    renderAt('/gs/p1')
    expect(trigger()).toHaveTextContent('NA')
    expect(trigger()).toHaveTextContent('Nguyễn Văn A')
    expect(trigger()).toHaveAttribute('aria-haspopup', 'menu')
    expect(screen.queryByRole('button', { name: 'Đăng xuất' })).toBeNull()
    expect(screen.queryByText('Chỉ xem')).toBeNull()
  })

  it('adds the Chỉ xem badge to a viewer\'s trigger', () => {
    authRole.value = 'viewer'
    renderAt('/gs/p1')
    expect(trigger('Nguyễn Văn A (gs1) · Chỉ xem')).toHaveTextContent('Chỉ xem')
  })

  it('opens a menu of who is signed in -- full name, login beneath -- then Đăng xuất', async () => {
    renderAt('/gs/p1')
    const menu = await openMenu()
    expect(trigger()).toHaveAttribute('aria-expanded', 'true')
    expect(within(menu).getByText('Nguyễn Văn A')).toBeInTheDocument()
    expect(within(menu).getByText('gs1')).toBeInTheDocument()
    // Only Đăng xuất can be chosen: GS accounts have no self-service (spec §2, §8.1).
    expect(within(menu).getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Đăng xuất'])
  })

  it('asks before signing out, with the same texts, then replaces the page with the login', async () => {
    renderAt('/gs/p1')
    const menu = await openMenu()
    await userEvent.click(within(menu).getByRole('menuitem', { name: /Đăng xuất/ }))
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
    const menu = await openMenu()
    await userEvent.click(within(menu).getByRole('menuitem', { name: /Đăng xuất/ }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Huỷ' }))
    expect(signOut).not.toHaveBeenCalled()
  })

  it('builds the menu from one items list, the account block first and Đăng xuất last', () => {
    const items = fieldAccountMenuItems({ fullName: 'Nguyễn Văn A', username: 'gs1', readOnly: false, onLogout: () => {} })
    expect(items.map((i) => i?.key)).toEqual(['account', 'account-divider', 'logout'])
  })
})

describe('FieldHeader: phone width', () => {
  beforeEach(() => setViewport(390))

  it('folds the trigger to the avatar, named for who is signed in', async () => {
    renderAt('/gs/p1')
    const avatar = screen.getByRole('button', { name: 'Nguyễn Văn A (gs1)' })
    expect(avatar).toHaveTextContent(/^NA$/)
    const menu = await (async () => {
      await userEvent.click(avatar)
      return screen.findByRole('menu')
    })()
    expect(within(menu).getByText('Nguyễn Văn A')).toBeInTheDocument()
    expect(within(menu).getByText('gs1')).toBeInTheDocument()
  })

  it('carries a viewer\'s Chỉ xem into the trigger\'s name and the menu, where the badge has no room', async () => {
    authRole.value = 'viewer'
    renderAt('/gs/p1')
    const avatar = screen.getByRole('button', { name: 'Nguyễn Văn A (gs1) · Chỉ xem' })
    expect(avatar).not.toHaveTextContent('Chỉ xem')
    await userEvent.click(avatar)
    expect(within(await screen.findByRole('menu')).getByText('Chỉ xem')).toBeInTheDocument()
  })
})

describe('FieldHeader: a bottom tab bar on phones (GS-06)', () => {
  const header = () => document.querySelector('header') as HTMLElement

  it.each([
    ['/gs/p1', 'Sàn'],
    ['/gs/p1/dashboard', 'Năng suất'],
    ['/gs/p1/kpi', 'KPI'],
  ])('titles the top bar with the page on screen, beside the avatar, on %s', (path, title) => {
    setViewport(390)
    renderAt(path)
    expect(within(header()).getByRole('heading', { level: 1 })).toHaveTextContent(new RegExp(`^${title}$`))
    expect(within(header()).queryByRole('navigation')).toBeNull()
    expect(within(header()).getByRole('button', { name: 'Nguyễn Văn A (gs1)' })).toBeInTheDocument()
  })

  it('moves the three tabs to a bar fixed to the bottom, over the safe area', () => {
    setViewport(390)
    renderAt('/gs/p1/dashboard')
    expect(header().contains(nav())).toBe(false)
    expect(nav()).toHaveStyle({ position: 'fixed', bottom: '0px', left: '0px', right: '0px' })
    expect(nav().style.height).toBe('calc(56px + env(safe-area-inset-bottom, 0px))')
    expect(nav().style.paddingBottom).toBe('calc(env(safe-area-inset-bottom, 0px))')
    const links = within(nav()).getAllByRole('link')
    expect(links.map((l) => l.textContent)).toEqual(['Sàn', 'Năng suất', 'KPI'])
    // An icon above each label, drawn for the eye only: the label names the link.
    for (const l of links) expect(l.querySelector('[role="img"][aria-hidden="true"], svg')).not.toBeNull()
    expect(tab('Năng suất')).toHaveAttribute('aria-current', 'page')
    expect(tab('Sàn')).not.toHaveAttribute('aria-current')
  })

  it('still goes where a tab points from the bottom bar', async () => {
    setViewport(390)
    renderAt('/gs/p1')
    await userEvent.click(tab('KPI'))
    expect(screen.getByTestId('path')).toHaveTextContent('/gs/p1/kpi')
    expect(within(header()).getByRole('heading', { level: 1 })).toHaveTextContent('KPI')
  })

  it.each([[767, 'bottom'], [768, 'top']] as const)('puts the tabs at the %s px width at the %s', (width, where) => {
    setViewport(width)
    renderAt('/gs/p1')
    expect(header().contains(nav())).toBe(where === 'top')
    if (where === 'top') expect(within(header()).queryByRole('heading', { level: 1 })).toBeNull()
  })
})

describe('FieldLayout: nothing hides behind the bottom bar', () => {
  const renderLayout = () =>
    render(
      <MemoryRouter initialEntries={['/gs/p1']}>
        <FieldLayout projectId="p1"><div>nội dung</div></FieldLayout>
      </MemoryRouter>,
    )

  it('pads the page by the bar and the safe area on a phone', () => {
    setViewport(390)
    renderLayout()
    const layout = screen.getByText('nội dung').parentElement as HTMLElement
    expect(layout.style.paddingBottom).toBe('calc(56px + env(safe-area-inset-bottom, 0px))')
    expect(layout.firstElementChild?.tagName).toBe('HEADER')
  })

  it('adds nothing from 768 px up, where the tabs are in the header', () => {
    setViewport(768)
    renderLayout()
    const layout = screen.getByText('nội dung').parentElement as HTMLElement
    expect(layout.style.paddingBottom).toBe('')
  })
})
