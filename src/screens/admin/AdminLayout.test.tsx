import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AdminLayout } from './AdminLayout'

const signOut = vi.hoisted(() => vi.fn())
const profile = vi.hoisted(() => ({ current: null as unknown }))

vi.mock('../../auth/AuthProvider', () => ({
  useAuth: () => ({ profile: profile.current, signOut }),
}))

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/admin" element={<AdminLayout />}>
          <Route path="projects" element={<div>nội dung dự án</div>} />
          <Route path="decks" element={<div>nội dung sàn</div>} />
        <Route path="decks/:deckId" element={<div>nội dung một sàn</div>} />
          <Route path="users" element={<div>nội dung người dùng</div>} />
          <Route path="dashboard" element={<div>nội dung năng suất</div>} />
        </Route>
        <Route path="/login" element={<div>màn đăng nhập</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  signOut.mockReset()
  signOut.mockResolvedValue(undefined)
  profile.current = { id: 'a1', username: 'admin.linh', fullName: 'Nguyễn Thị Linh', role: 'admin', active: true }
})

describe('AdminLayout', () => {
  it('renders the routed screen', () => {
    renderAt('/admin/decks')
    expect(screen.getByText('nội dung sàn')).toBeInTheDocument()
  })

  it('offers the admin destinations, the dashboard among them', () => {
    renderAt('/admin/projects')
    expect(screen.getByRole('link', { name: /Dự án/ })).toHaveAttribute('href', '/admin/projects')
    expect(screen.getByRole('link', { name: /Sàn/ })).toHaveAttribute('href', '/admin/decks')
    expect(screen.getByRole('link', { name: /Năng suất/ })).toHaveAttribute('href', '/admin/dashboard')
    expect(screen.getByRole('link', { name: /Người dùng/ })).toHaveAttribute('href', '/admin/users')
  })

  it('marks the open destination, including from a deck detail route', () => {
    // A deck's own address is /admin/decks/:id. Selecting on an exact match
    // would leave the whole sidebar unselected on the screen the admin spends
    // the most time in.
    renderAt('/admin/decks/abc-123')
    expect(screen.getByRole('menuitem', { name: /Sàn/ })).toHaveClass('ant-menu-item-selected')
  })

  it('shows who is signed in, by name, role and initials', () => {
    renderAt('/admin/projects')
    expect(screen.getByText('Nguyễn Thị Linh')).toBeInTheDocument()
    expect(screen.getByText('Quản trị viên')).toBeInTheDocument()
    expect(screen.getByText('NL')).toBeInTheDocument()
  })

  it('signs out and leaves the admin URL behind', async () => {
    const user = userEvent.setup()
    renderAt('/admin/projects')
    await user.click(screen.getByRole('button', { name: 'Đăng xuất' }))
    await user.click(await screen.findByRole('button', { name: 'Vẫn đăng xuất' }))
    expect(signOut).toHaveBeenCalledOnce()
    // Navigating is the point: without it the session goes but the URL stays
    // on an admin route, so the login form renders under a path this person is
    // no longer allowed on -- and a refresh puts them straight back.
    await waitFor(() => expect(screen.getByText('màn đăng nhập')).toBeInTheDocument())
  })

  it('collapses to icons only, and back', async () => {
    const user = userEvent.setup()
    renderAt('/admin/projects')
    expect(screen.getByText('Construction Management')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Thu gọn thanh điều hướng' }))
    expect(screen.queryByText('Construction Management')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Mở rộng thanh điều hướng' }))
    expect(screen.getByText('Construction Management')).toBeInTheDocument()
  })

  it('renders without a profile rather than crashing on first paint', () => {
    // The layout mounts before AuthProvider has read profiles; an unguarded
    // fullName here is a white screen on every admin page load.
    profile.current = null
    renderAt('/admin/projects')
    expect(screen.getByText('nội dung dự án')).toBeInTheDocument()
  })
})
