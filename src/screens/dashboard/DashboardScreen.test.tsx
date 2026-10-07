import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Link, MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { pageSubtitle } from '../../test/copy'
import { chooseOption, openDropdown } from '../../test/select'
import { setViewport } from '../../test/viewport'
import { DashboardScreen } from './DashboardScreen'
import { endSession } from '../../lib/sessionCache'

const loadProjectModel = vi.hoisted(() => vi.fn())
const listProjectEvents = vi.hoisted(() => vi.fn())
const listProjectNames = vi.hoisted(() => vi.fn())
const navigate = vi.hoisted(() => vi.fn())
vi.mock('../../lib/progressApi', () => ({
  loadProjectModel: (id: string) => loadProjectModel(id),
  listProjectEvents: (id: string) => listProjectEvents(id),
}))
vi.mock('../../lib/projectsApi', () => ({
  listProjectNames: () => listProjectNames(),
}))
// The field header asks whether the project has Piping (piping spec §2, R-1): none here.
vi.mock('../../lib/pipingApi/settings', () => ({
  getPipingSettings: () => Promise.resolve(null),
}))
vi.mock('./ProductivityDashboard', () => ({
  ProductivityDashboard: ({ events, filters, version }: {
    events: unknown[]; filters: { work: string | null; deck: string }; version: number
  }) => (
    <div data-testid="dashboard-mock" data-version={version}>DASHBOARD {events.length} sự kiện · {filters.deck || 'Tất cả sàn'} · {filters.work ?? 'công việc đầu'}</div>
  ),
}))
// The field header (GS-06) on the gs variant: who is signed in.
const authRole = vi.hoisted(() => ({ value: 'gs' as 'gs' | 'viewer' }))
vi.mock('../../auth/AuthProvider', () => ({
  useAuth: () => ({
    profile: { id: 'u1', username: 'gs1', fullName: 'Nguyễn Văn A', role: authRole.value, active: true },
    signOut: vi.fn(),
  }),
}))
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => navigate }
})

const work = (id: string, seq: number, name: string) => ({
  work: { id, projectId: 'p1', seq, name, kind: 'bays', weight: 0.5, counts: true, manualProgress: 0, quantityLabel: 'Diện tích', unit: 'm²' },
  decks: [],
})
const MODEL = { models: [work('w1', 1, 'Sơn'), work('w2', 2, 'Tháo giáo')], decks: [{ id: 'd1', name: 'Sàn A' }], audit: {} }
/** Another project's model: its own work and deck, none of the first's. */
const MODEL_Z = { models: [work('w9', 1, 'Giàn giáo')], decks: [{ id: 'd9', name: 'Sàn Z' }], audit: {} }

/** The one filter bar under the title (FLT-01). */
const bar = () => screen.getByRole('search', { name: 'Bộ lọc' })
/** No Đặt lại and no Tìm: every control applies as it changes (RV7-3). */
const expectNoApplyButtons = (root: HTMLElement) => {
  expect(within(root).queryByRole('button', { name: 'Đặt lại' })).toBeNull()
  expect(within(root).queryByRole('button', { name: /Tìm/ })).toBeNull()
}
/** Picks the bar's work, from its searchable select (FLT-03). */
const pickWork = (name: string) => chooseOption('Công việc', name, bar())
const before = (a: Element, b: Element) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0

beforeEach(() => {
  loadProjectModel.mockReset()
  listProjectEvents.mockReset()
  listProjectNames.mockReset()
  navigate.mockReset()
  authRole.value = 'gs'
  // The field's Dự án switch keeps project names per session; every test is a new one.
  endSession()
  loadProjectModel.mockResolvedValue(MODEL)
  listProjectEvents.mockResolvedValue([{ id: 1 }, { id: 2 }])
  listProjectNames.mockResolvedValue([
    { id: 'p1', name: 'Giàn A', code: 'GA' }, { id: 'p2', name: 'Giàn B', code: 'GB' },
  ])
})

/** The address, as the screen leaves it. */
function UrlEcho() {
  return <div data-testid="url-search">{useLocation().search}</div>
}

const renderAdmin = (path = '/admin/dashboard') =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <UrlEcho />
      <Routes>
        <Route path="/admin/dashboard" element={<DashboardScreen variant="admin" />} />
      </Routes>
    </MemoryRouter>,
  )

const renderField = () =>
  render(
    <MemoryRouter initialEntries={['/gs/p2/dashboard']}>
      {/* A real route change, as the viewer's project switch makes one. */}
      <Link to="/gs/p1/dashboard">sang Giàn A</Link>
      <Routes>
        <Route path="/gs/:projectId/dashboard" element={<DashboardScreen variant="gs" />} />
      </Routes>
    </MemoryRouter>,
  )

describe('DashboardScreen (admin)', () => {
  it('opens on the first project and loads its model and events', async () => {
    renderAdmin()
    expect(await screen.findByText('DASHBOARD 2 sự kiện · Tất cả sàn · công việc đầu')).toBeInTheDocument()
    expect(loadProjectModel).toHaveBeenCalledWith('p1')
    expect(listProjectEvents).toHaveBeenCalledWith('p1')
    // No subtitle listing the cards below; the project is in the select (CPY-01, CPY-03).
    expect(pageSubtitle()).toBeNull()
    expect(screen.queryByText(/theo công đoạn, theo ngày và theo nhóm trưởng/)).toBeNull()
  })

  it('honours ?project= when it names a project that exists', async () => {
    renderAdmin('/admin/dashboard?project=p2')
    expect(await screen.findByText('DASHBOARD 2 sự kiện · Tất cả sàn · công việc đầu')).toBeInTheDocument()
    expect(loadProjectModel).toHaveBeenCalledWith('p2')
    expect(loadProjectModel).not.toHaveBeenCalledWith('p1')
  })

  it('reloads for the project picked in the header at once, and writes ?project= (RV7-3)', async () => {
    renderAdmin()
    expect(await screen.findByText('DASHBOARD 2 sự kiện · Tất cả sàn · công việc đầu')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('combobox', { name: 'Dự án' }))
    await userEvent.click(await screen.findByTitle('Giàn B (GB)'))
    await waitFor(() => expect(loadProjectModel).toHaveBeenCalledWith('p2'))
    await waitFor(() => expect(screen.getByTestId('url-search')).toHaveTextContent('project=p2'))
  })

  it('holds Dự án, Công việc, Sàn and the dates in one bar under the title, in that order, unlabelled (FLT-01)', async () => {
    renderAdmin()
    expect(await screen.findByText(/^DASHBOARD 2 sự kiện/)).toBeInTheDocument()
    const project = within(bar()).getByRole('combobox', { name: 'Dự án' })
    const scope = within(bar()).getByRole('combobox', { name: 'Công việc' })
    const deck = within(bar()).getByRole('combobox', { name: 'Sàn' })
    const from = within(bar()).getByPlaceholderText('Từ ngày')
    expect(within(bar()).getByPlaceholderText('Đến ngày')).toBeInTheDocument()
    expect(before(project, scope) && before(scope, deck) && before(deck, from)).toBe(true)
    // No field label (FLT-01), and the work is a select, not a segmented (FLT-03).
    expect(bar().querySelector('label')).toBeNull()
    expect(within(bar()).queryByRole('radiogroup')).toBeNull()
    expect(screen.getByRole('heading', { level: 1, name: 'Năng suất' })).toBeInTheDocument()
    expectNoApplyButtons(bar())
  })

  it('narrows the dashboard as soon as a filter changes (RV7-3)', async () => {
    renderAdmin()
    await screen.findByText(/^DASHBOARD 2 sự kiện/)
    await pickWork('Tháo giáo')
    expect(await screen.findByText('DASHBOARD 2 sự kiện · Tất cả sàn · Tháo giáo')).toBeInTheDocument()
    await chooseOption('Sàn', 'Sàn A', bar())
    expect(await screen.findByText('DASHBOARD 2 sự kiện · Sàn A · Tháo giáo')).toBeInTheDocument()
  })

  it('reads nothing on a filter change, and the project\'s data once when the project changes (RV7-3)', async () => {
    renderAdmin()
    await screen.findByText(/^DASHBOARD 2 sự kiện/)
    await chooseOption('Sàn', 'Sàn A', bar())
    expect(loadProjectModel).toHaveBeenCalledTimes(1)
    expect(listProjectEvents).toHaveBeenCalledTimes(1)
    await chooseOption('Dự án', 'Giàn B (GB)', bar())
    await waitFor(() => expect(loadProjectModel).toHaveBeenCalledTimes(2))
    expect(loadProjectModel).toHaveBeenLastCalledWith('p2')
    expect(listProjectEvents).toHaveBeenCalledTimes(2)
  })

  it('drops a deck and a work the new project does not have, so going back does not restore them (RV7-3)', async () => {
    loadProjectModel.mockImplementation((id: string) => Promise.resolve(id === 'p2' ? MODEL_Z : MODEL))
    renderAdmin()
    await screen.findByText(/^DASHBOARD 2 sự kiện/)
    await pickWork('Tháo giáo')
    await chooseOption('Sàn', 'Sàn A', bar())
    expect(await screen.findByText('DASHBOARD 2 sự kiện · Sàn A · Tháo giáo')).toBeInTheDocument()
    await chooseOption('Dự án', 'Giàn B (GB)', bar())
    // Sàn A and Tháo giáo are Giàn A's: Tất cả sàn and Giàn B's first work.
    expect(await screen.findByText('DASHBOARD 2 sự kiện · Tất cả sàn · công việc đầu')).toBeInTheDocument()
    expect(within(bar()).getByTitle('Tất cả sàn')).toBeInTheDocument()
    await userEvent.click(within(bar()).getByRole('combobox', { name: 'Sàn' }))
    expect(await screen.findByTitle('Sàn Z')).toBeInTheDocument()
    expect(screen.queryByTitle('Sàn A')).toBeNull()
    await userEvent.keyboard('{Escape}')
    await chooseOption('Dự án', 'Giàn A (GA)', bar())
    await waitFor(() => expect(loadProjectModel).toHaveBeenLastCalledWith('p1'))
    expect(await screen.findByText('DASHBOARD 2 sự kiện · Tất cả sàn · công việc đầu')).toBeInTheDocument()
  })

  it('shows Tất cả sàn, not the last project\'s deck, while the new project loads (RV7-3)', async () => {
    loadProjectModel.mockImplementation((id: string) => (id === 'p2' ? new Promise(() => {}) : Promise.resolve(MODEL)))
    renderAdmin()
    await screen.findByText(/^DASHBOARD 2 sự kiện/)
    await chooseOption('Sàn', 'Sàn A', bar())
    await chooseOption('Dự án', 'Giàn B (GB)', bar())
    await waitFor(() => expect(loadProjectModel).toHaveBeenLastCalledWith('p2'))
    const deck = within(bar()).getByRole('combobox', { name: 'Sàn' }).closest('.ant-select') as HTMLElement
    expect(within(deck).getByTitle('Tất cả sàn')).toBeInTheDocument()
    expect(within(deck).queryByText('Sàn A')).toBeNull()
  })

  it('shows the last project picked when an earlier pick answers after it (RV7-3)', async () => {
    let resolveP2: (v: typeof MODEL | typeof MODEL_Z) => void = () => {}
    loadProjectModel.mockImplementation((id: string) =>
      (id === 'p2' ? new Promise((r) => { resolveP2 = r }) : Promise.resolve(MODEL)))
    listProjectEvents.mockImplementation((id: string) => Promise.resolve(id === 'p2' ? [{ id: 9 }] : [{ id: 1 }, { id: 2 }]))
    renderAdmin()
    await screen.findByText(/^DASHBOARD 2 sự kiện/)
    await chooseOption('Dự án', 'Giàn B (GB)', bar())
    await waitFor(() => expect(loadProjectModel).toHaveBeenLastCalledWith('p2'))
    await chooseOption('Dự án', 'Giàn A (GA)', bar())
    await waitFor(() => expect(loadProjectModel).toHaveBeenLastCalledWith('p1'))
    expect(await screen.findByText(/^DASHBOARD 2 sự kiện/)).toBeInTheDocument()
    await act(async () => resolveP2(MODEL_Z))
    expect(screen.getByText(/^DASHBOARD 2 sự kiện/)).toBeInTheDocument()
    expect(screen.queryByText(/^DASHBOARD 1 sự kiện/)).toBeNull()
  })

  it('keeps a deck the new project has too (RV7-3)', async () => {
    renderAdmin()
    await screen.findByText(/^DASHBOARD 2 sự kiện/)
    await chooseOption('Sàn', 'Sàn A', bar())
    await chooseOption('Dự án', 'Giàn B (GB)', bar())
    await waitFor(() => expect(loadProjectModel).toHaveBeenLastCalledWith('p2'))
    expect(await screen.findByText('DASHBOARD 2 sự kiện · Sàn A · công việc đầu')).toBeInTheDocument()
  })

  it('counts every applied change, so the dashboard\'s pagers go back to page 1 on each (RV7-3)', async () => {
    renderAdmin()
    const dash = await screen.findByTestId('dashboard-mock')
    const before = Number(dash.dataset.version)
    await pickWork('Tháo giáo')
    await waitFor(() => expect(Number(screen.getByTestId('dashboard-mock').dataset.version)).toBe(before + 1))
  })

  it('reports a failed read and retries on request', async () => {
    listProjectEvents.mockRejectedValueOnce(new Error('mất kết nối'))
    renderAdmin()
    expect(await screen.findByText('Không tải được số liệu năng suất')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Thử lại' }))
    expect(await screen.findByText('DASHBOARD 2 sự kiện · Tất cả sàn · công việc đầu')).toBeInTheDocument()
  })
})

describe('DashboardScreen (gs)', () => {
  // The inline bar, as a tablet or a laptop has it; the phone's sheet is below (FLT-04).
  let restoreViewport = () => {}
  beforeEach(() => { restoreViewport = setViewport(1024) })
  afterEach(() => restoreViewport())

  it('reads the project from the path, under the field header with Năng suất current (GS-01)', async () => {
    renderField()
    expect(await screen.findByText('DASHBOARD 2 sự kiện · Tất cả sàn · công việc đầu')).toBeInTheDocument()
    expect(loadProjectModel).toHaveBeenCalledWith('p2')
    const nav = screen.getByRole('navigation', { name: 'Điều hướng' })
    expect(within(nav).getByRole('link', { name: 'Năng suất' })).toHaveAttribute('aria-current', 'page')
    expect(within(nav).getByRole('link', { name: 'Sàn' })).toHaveAttribute('href', '/gs/p2')
    expect(await within(bar()).findByText('Giàn B', { selector: '.ant-select-selection-item' })).toBeInTheDocument()
  })

  it('has no back button and no title bar of its own: the Sàn tab is the way back (GS-02)', async () => {
    renderField()
    await screen.findByText(/^DASHBOARD 2 sự kiện/)
    expect(screen.queryByRole('button', { name: 'Về bản vẽ' })).toBeNull()
    // "Năng suất" only in the field header: the tab, and on a phone the top
    // bar's title (GS-06); the page draws no title of its own.
    expect(screen.getAllByText('Năng suất').every((e) => e.closest('header, nav') !== null)).toBe(true)
    // The filter bar is the first thing under the header.
    const content = bar().closest('.ant-layout-content') as HTMLElement
    expect(content.firstElementChild).toBe(bar())
    expect(before(screen.getByRole('navigation', { name: 'Điều hướng' }), bar())).toBe(true)
  })

  it('starts another project on its own defaults, not the last project\'s applied filters', async () => {
    renderField()
    await screen.findByText(/^DASHBOARD 2 sự kiện/)
    await userEvent.click(within(bar()).getByRole('combobox', { name: 'Sàn' }))
    await userEvent.click(await screen.findByTitle('Sàn A'))
    expect(await screen.findByText('DASHBOARD 2 sự kiện · Sàn A · công việc đầu')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('link', { name: 'sang Giàn A' }))
    await waitFor(() => expect(loadProjectModel).toHaveBeenCalledWith('p1'))
    expect(await screen.findByText('DASHBOARD 2 sự kiện · Tất cả sàn · công việc đầu')).toBeInTheDocument()
  })

  it('gives the field the same bar, the project first, and no Đặt lại or Tìm (FLT-01, GS-07, RV7-3)', async () => {
    renderField()
    await screen.findByText(/^DASHBOARD 2 sự kiện/)
    const project = within(bar()).getByRole('combobox', { name: 'Dự án' })
    const work = within(bar()).getByRole('combobox', { name: 'Công việc' })
    const deck = within(bar()).getByRole('combobox', { name: 'Sàn' })
    const from = within(bar()).getByPlaceholderText('Từ ngày')
    expect(before(project, work) && before(work, deck) && before(deck, from)).toBe(true)
    expect(within(bar()).getAllByRole('combobox')[0]).toBe(project)
    expectNoApplyButtons(bar())
  })

  /** Picks the field bar's project. */
  const pickProject = async (name: string) => {
    await userEvent.click(within(bar()).getByRole('combobox', { name: 'Dự án' }))
    await userEvent.click(await screen.findByTitle(name))
  }

  it('opens this page of the picked project at once, once (RV7-3, I-1)', async () => {
    renderField()
    await screen.findByText(/^DASHBOARD 2 sự kiện/)
    await pickProject('Giàn A')
    expect(navigate).toHaveBeenCalledTimes(1)
    expect(navigate).toHaveBeenCalledWith('/gs/p1/dashboard')
  })

  it('carries the applied filters to the picked project, which keeps those it has and drops the rest (I-1)', async () => {
    // Giàn A has Sàn A too, but not the work Tháo giáo.
    loadProjectModel.mockImplementation((id: string) => Promise.resolve(id === 'p1' ? { ...MODEL, models: [work('w1', 1, 'Sơn')] } : MODEL))
    renderField()
    await screen.findByText(/^DASHBOARD 2 sự kiện/)
    await pickWork('Tháo giáo')
    await userEvent.click(within(bar()).getByRole('combobox', { name: 'Sàn' }))
    await userEvent.click(await screen.findByTitle('Sàn A'))
    expect(await screen.findByText('DASHBOARD 2 sự kiện · Sàn A · Tháo giáo')).toBeInTheDocument()
    await pickProject('Giàn A')
    expect(navigate).toHaveBeenCalledWith('/gs/p1/dashboard')

    // The route change the navigate makes, on the page's fresh mount.
    await userEvent.click(screen.getByRole('link', { name: 'sang Giàn A' }))
    await waitFor(() => expect(loadProjectModel).toHaveBeenCalledWith('p1'))
    expect(await screen.findByText('DASHBOARD 2 sự kiện · Sàn A · công việc đầu')).toBeInTheDocument()
  })

  it('applies the field\'s filters as they change too (RV7-3)', async () => {
    renderField()
    await screen.findByText(/^DASHBOARD 2 sự kiện/)
    await userEvent.click(within(bar()).getByRole('combobox', { name: 'Sàn' }))
    await userEvent.click(await screen.findByTitle('Sàn A'))
    expect(await screen.findByText('DASHBOARD 2 sự kiện · Sàn A · công việc đầu')).toBeInTheDocument()
    expect(navigate).not.toHaveBeenCalled()
  })
})

describe('DashboardScreen (gs) on a phone (FLT-04)', () => {
  let restoreViewport = () => {}
  beforeEach(() => { restoreViewport = setViewport(390) })
  afterEach(() => restoreViewport())

  const summary = (text: string) => within(bar()).findByRole('button', { name: text })
  const openSheet = async () => {
    await userEvent.click(within(bar()).getByRole('button', { name: 'Bộ lọc' }))
    return screen.findByRole('dialog', { name: 'Bộ lọc' })
  }

  it('is one row: what is applied, in one line, and the Bộ lọc button', async () => {
    renderField()
    await screen.findByText(/^DASHBOARD 2 sự kiện/)
    expect(await summary('GB · Tất cả sàn · Sơn')).toBeInTheDocument()
    expect(within(bar()).getByRole('button', { name: 'Bộ lọc' })).toBeInTheDocument()
    expect(within(bar()).queryByRole('combobox')).toBeNull()
    expect(bar().querySelector('.ant-badge-count')).toBeNull()
  })

  it('opens the sheet from the summary too, with every control of the bar in order, full width', async () => {
    renderField()
    await screen.findByText(/^DASHBOARD 2 sự kiện/)
    await userEvent.click(await summary('GB · Tất cả sàn · Sơn'))
    const sheet = await screen.findByRole('dialog', { name: 'Bộ lọc' })
    const boxes = within(sheet).getAllByRole('combobox')
    expect(boxes.map((b) => b.getAttribute('aria-label'))).toEqual(['Dự án', 'Công việc', 'Sàn'])
    for (const box of boxes) expect(box.closest('.ant-select')).toHaveStyle({ width: '100%' })
    expect(within(sheet).getByPlaceholderText('Từ ngày').closest('.ant-picker')).toHaveStyle({ width: '100%' })
  })

  it('applies each control of the sheet as it changes, with no footer; the summary and the badge follow (RV7-3)', async () => {
    renderField()
    await screen.findByText(/^DASHBOARD 2 sự kiện/)
    const sheet = await openSheet()
    expect(sheet.querySelector('.ant-drawer-footer')).toBeNull()
    expectNoApplyButtons(sheet)
    await chooseOption('Sàn', 'Sàn A', sheet)
    expect(await screen.findByText('DASHBOARD 2 sự kiện · Sàn A · công việc đầu')).toBeInTheDocument()
    await chooseOption('Công việc', 'Tháo giáo', sheet)
    expect(await screen.findByText('DASHBOARD 2 sự kiện · Sàn A · Tháo giáo')).toBeInTheDocument()
    // Still open: it closes with its X, Esc or a tap on the mask.
    expect(screen.getByRole('dialog', { name: 'Bộ lọc' })).toBeInTheDocument()
    expect(await summary('GB · Sàn A · Tháo giáo')).toBeInTheDocument()
    expect(bar().querySelector('.ant-badge-count')).toHaveTextContent('2')
    expect(loadProjectModel).toHaveBeenCalledTimes(1)
  })

  it('keeps what was applied when the sheet closes: reopened, it shows it (RV7-3)', async () => {
    renderField()
    await screen.findByText(/^DASHBOARD 2 sự kiện/)
    const sheet = await openSheet()
    await chooseOption('Sàn', 'Sàn A', sheet)
    await userEvent.click(within(sheet).getByRole('button', { name: /Close|Đóng/ }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Bộ lọc' })).toBeNull())
    const again = await openSheet()
    expect(within(again).getByTitle('Sàn A')).toBeInTheDocument()
    expect(screen.getByText('DASHBOARD 2 sự kiện · Sàn A · công việc đầu')).toBeInTheDocument()
  })

  it('opens every select of the sheet with its options in full', async () => {
    renderField()
    await screen.findByText(/^DASHBOARD 2 sự kiện/)
    const sheet = await openSheet()
    for (const name of ['Dự án', 'Công việc', 'Sàn']) {
      expect((await openDropdown(name, sheet)).style.maxWidth).toBe('calc(100vw - 32px)')
    }
  })

  it('keeps the inline bar from 768 px, with no sheet', async () => {
    restoreViewport()
    restoreViewport = setViewport(768)
    renderField()
    await screen.findByText(/^DASHBOARD 2 sự kiện/)
    expect(within(bar()).getByRole('combobox', { name: 'Dự án' })).toBeInTheDocument()
    expect(within(bar()).queryByRole('button', { name: 'Bộ lọc' })).toBeNull()
  })
})
