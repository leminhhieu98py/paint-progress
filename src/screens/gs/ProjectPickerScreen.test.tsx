import { App as AntApp } from 'antd'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { endSession } from '../../lib/sessionCache'
import { cachedProjectList } from './fieldProjects'
import { ProjectPickerScreen } from './ProjectPickerScreen'

const listProjectCards = vi.hoisted(() => vi.fn())
const listProjectNames = vi.hoisted(() => vi.fn())
vi.mock('../../lib/projectsApi', () => ({
  listProjectCards: () => listProjectCards(),
  listProjectNames: () => listProjectNames(),
}))

const signOut = vi.hoisted(() => vi.fn())
vi.mock('../../auth/AuthProvider', () => ({
  useAuth: () => ({
    profile: { id: 'u1', username: 'boss1', fullName: 'Sếp Một', role: 'viewer', active: true },
    signOut,
  }),
}))

const GsStandIn = () => {
  const { projectId } = useParams()
  return <div>GS SCREEN (dự án {projectId})</div>
}

const renderPicker = () =>
  render(
    <AntApp>
      <MemoryRouter initialEntries={['/gs']}>
        <Routes>
          <Route path="/gs" element={<ProjectPickerScreen />} />
          <Route path="/gs/:projectId" element={<GsStandIn />} />
          <Route path="/login" element={<div>LOGIN</div>} />
        </Routes>
      </MemoryRouter>
    </AntApp>,
  )

const CARDS = [
  { id: 'p1', name: 'BlockB1_CPPTS', code: 'BB1', deckCount: 3 },
  { id: 'p2', name: 'Đại Hùng', code: 'DH', deckCount: 1 },
]

beforeEach(() => {
  endSession()
  listProjectNames.mockReset()
  listProjectCards.mockReset()
  listProjectCards.mockResolvedValue(CARDS)
  signOut.mockReset()
  signOut.mockResolvedValue(undefined)
})

/**
 * RV6-23: where a viewer lands. 0034 lets the role read every project and
 * gives it no membership row, so the 0028 landing -- the GS screen of the
 * first project_members row -- has nothing to go on. This page is the choice
 * the boss makes instead: one card per project, in the order the API returns
 * them (by name), each a link to that project's GS screen.
 */
describe('ProjectPickerScreen', () => {
  it('lists every project as a card with its name, code and deck count', async () => {
    renderPicker()

    const first = await screen.findByRole('link', { name: /BlockB1_CPPTS/ })
    expect(first).toHaveTextContent('BB1')
    expect(first).toHaveTextContent('3 sàn')
    const second = screen.getByRole('link', { name: /Đại Hùng/ })
    expect(second).toHaveTextContent('DH')
    expect(second).toHaveTextContent('1 sàn')
    // In the API's order -- the API sorts by name, and the screen must not
    // re-sort by something else.
    const links = screen.getAllByRole('link')
    expect(links.map((l) => l.textContent)).toEqual([
      expect.stringContaining('BlockB1_CPPTS'),
      expect.stringContaining('Đại Hùng'),
    ])
  })

  it('opens the project whose card is tapped', async () => {
    renderPicker()
    await userEvent.click(await screen.findByRole('link', { name: /Đại Hùng/ }))
    expect(await screen.findByText('GS SCREEN (dự án p2)')).toBeInTheDocument()
  })

  it('skips the list when there is only one project to choose from', async () => {
    listProjectCards.mockResolvedValue([CARDS[0]])
    renderPicker()
    expect(await screen.findByText('GS SCREEN (dự án p1)')).toBeInTheDocument()
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('says so when there is no project at all, instead of an empty page', async () => {
    listProjectCards.mockResolvedValue([])
    renderPicker()
    expect(await screen.findByText('Chưa có dự án nào')).toBeInTheDocument()
    expect(screen.getByText('Quản trị viên chưa tạo dự án nào.')).toBeInTheDocument()
  })

  it('explains a failed read, and does not pretend there are no projects', async () => {
    listProjectCards.mockRejectedValue(new Error('Failed to fetch'))
    renderPicker()
    expect(await screen.findByText('Không tải được danh sách dự án')).toBeInTheDocument()
    expect(screen.queryByText('Chưa có dự án nào')).toBeNull()
  })

  it('offers logout, after a confirmation, and nothing else about the account', async () => {
    renderPicker()
    await screen.findByRole('link', { name: /BlockB1_CPPTS/ })

    // The project pages' account trigger and menu (GS-06, M-4), not a button of its own.
    expect(screen.queryByRole('button', { name: 'Đăng xuất' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Sếp Một (boss1) · Chỉ xem' }))
    const menu = await screen.findByRole('menu')
    expect(within(menu).getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Đăng xuất'])
    await userEvent.click(within(menu).getByRole('menuitem', { name: /Đăng xuất/ }))
    expect(signOut).not.toHaveBeenCalled()
    expect(await screen.findByText('Muốn xem tiếp thì phải đăng nhập lại bằng mật khẩu quản trị viên đã giao.')).toBeInTheDocument()
    await userEvent.click(await screen.findByRole('button', { name: 'Vẫn đăng xuất' }))
    expect(signOut).toHaveBeenCalledTimes(1)
    expect(await screen.findByText('LOGIN')).toBeInTheDocument()
  })
})

describe('ProjectPickerScreen: the Dự án switch\'s project list (M-1b)', () => {
  it('hands its fresh read to the Dự án switch\'s session list, so a new project is in it', async () => {
    renderPicker()
    await screen.findByText('Đại Hùng')
    expect(cachedProjectList()).toEqual([
      { id: 'p1', name: 'BlockB1_CPPTS', code: 'BB1' },
      { id: 'p2', name: 'Đại Hùng', code: 'DH' },
    ])
    expect(listProjectNames).not.toHaveBeenCalled()
  })
})

describe('ProjectPickerScreen: on the field scale (GS-10)', () => {
  it('titles the page as a page and each card as a card', async () => {
    renderPicker()
    const card = await screen.findByRole('link', { name: /BlockB1_CPPTS/ })
    expect(screen.getByRole('heading', { level: 1, name: 'Chọn dự án' })).toHaveStyle({ fontSize: '20px', fontWeight: '600' })
    expect(within(card).getByText('BlockB1_CPPTS')).toHaveStyle({ fontSize: '15px', fontWeight: '600' })
    // The sub-line under a name is a caption; the code is set apart by colour, not weight.
    expect(within(card).getByText('BB1')).toHaveStyle({ fontWeight: '400' })
    expect(within(card).getByText('BB1').parentElement).toHaveStyle({ fontSize: '12px' })
  })

  it('names who is signed in on the scale, in a phone\'s account menu: the full name bodyStrong, no login (MOB-04)', async () => {
    // jsdom reads as a phone, where the trigger is the avatar and the menu names who it is.
    renderPicker()
    await screen.findByRole('link', { name: /BlockB1_CPPTS/ })
    const header = document.querySelector('header') as HTMLElement
    await userEvent.click(within(header).getByRole('button', { name: 'Sếp Một (boss1) · Chỉ xem' }))
    const menu = await screen.findByRole('menu')
    expect(within(menu).getByText('Sếp Một')).toHaveStyle({ fontSize: '14px', fontWeight: '600' })
    expect(within(menu).queryByText('boss1')).toBeNull()
    expect(within(menu).getByText('Chỉ xem')).toBeInTheDocument()
  })
})
