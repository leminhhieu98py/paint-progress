import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AdminLayout } from './AdminLayout'
import { consequenceItems } from '../../test/copy'

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
          <Route path="users" element={<div>nội dung nhân lực</div>} />
          <Route path="dashboard" element={<div>nội dung năng suất</div>} />
          <Route path="kpi" element={<div>nội dung KPI</div>} />
          <Route path="*" element={<div>không tìm thấy</div>} />
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
    expect(screen.getByRole('link', { name: /KPI/ })).toHaveAttribute('href', '/admin/kpi')
    expect(screen.getByRole('link', { name: /Nhân lực/ })).toHaveAttribute('href', '/admin/users')
  })

  it('offers accounts and employees as one item, Nhân lực (NL-01)', () => {
    renderAt('/admin/users')
    expect(screen.queryByRole('link', { name: /Người dùng/ })).toBeNull()
    expect(screen.queryByRole('link', { name: /Nhân viên/ })).toBeNull()
    expect(screen.getByRole('menuitem', { name: /Nhân lực/ })).toHaveClass('ant-menu-item-selected')
  })

  it('puts KPI immediately after Năng suất (Feedback Rv5, item 9)', () => {
    // RV5-28: "KPI nằm 1 mục riêng trên thanh menu". The position is the rule,
    // not decoration -- the two charts are read together.
    renderAt('/admin/projects')
    const labels = screen.getAllByRole('menuitem').map((i) => i.textContent)
    expect(labels.indexOf('KPI')).toBe(labels.indexOf('Năng suất') + 1)
  })

  it('marks KPI as the open destination on its own route', () => {
    renderAt('/admin/kpi')
    expect(screen.getByRole('menuitem', { name: /KPI/ })).toHaveClass('ant-menu-item-selected')
    // And not the neighbour it sits beside.
    expect(screen.getByRole('menuitem', { name: /Năng suất/ })).not.toHaveClass('ant-menu-item-selected')
  })

  it('marks the open destination, including from a deck detail route', () => {
    // A deck's own address is /admin/decks/:id. Selecting on an exact match
    // would leave the whole sidebar unselected on the screen the admin spends
    // the most time in.
    renderAt('/admin/decks/abc-123')
    expect(screen.getByRole('menuitem', { name: /Sàn/ })).toHaveClass('ant-menu-item-selected')
  })

  it('marks nothing on a path that is not a destination (QA F2 follow-up)', () => {
    // The not-found page sits inside this shell; highlighting Dự án there told
    // the admin they were on the projects screen.
    renderAt('/admin/nowhere')
    for (const item of screen.getAllByRole('menuitem')) {
      expect(item).not.toHaveClass('ant-menu-item-selected')
    }
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
    // The data-loss consequence, without the aside on what lives where (CPY-01).
    expect(await screen.findByText('Thay đổi chưa lưu ở màn đang mở bị mất')).toBeInTheDocument()
    expect(consequenceItems()).toEqual(['Thay đổi chưa lưu ở màn đang mở bị mất'])
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

  it('lets the product name wrap instead of clipping it (QA F1)', () => {
    // At the open rail's width the name is longer than the space beside the
    // mark, and a nowrap + ellipsis span cut it to "Construction Ma…" on
    // every admin screen. Wrapping keeps the whole name at the same size.
    renderAt('/admin/projects')
    const brand = screen.getByText('Construction Management')
    expect(brand).not.toHaveStyle({ whiteSpace: 'nowrap' })
    expect(brand).not.toHaveStyle({ textOverflow: 'ellipsis' })
  })

  it('renders without a profile rather than crashing on first paint', () => {
    // The layout mounts before AuthProvider has read profiles; an unguarded
    // fullName here is a white screen on every admin page load.
    profile.current = null
    renderAt('/admin/projects')
    expect(screen.getByText('nội dung dự án')).toBeInTheDocument()
  })
})
