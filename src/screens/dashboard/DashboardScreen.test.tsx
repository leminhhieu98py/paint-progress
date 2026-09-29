import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Link, MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { pageSubtitle } from '../../test/copy'
import { DashboardScreen } from './DashboardScreen'
import { endSession } from '../../lib/sessionCache'

const loadProjectModel = vi.hoisted(() => vi.fn())
const listProjectEvents = vi.hoisted(() => vi.fn())
const listProjectNames = vi.hoisted(() => vi.fn())
const navigate = vi.hoisted(() => vi.fn())
const listWorks = vi.hoisted(() => vi.fn())
const listDecks = vi.hoisted(() => vi.fn())
vi.mock('../../lib/worksApi', () => ({ listWorks: (id: string) => listWorks(id) }))
vi.mock('../../lib/decksApi', () => ({ listDecks: (id: string) => listDecks(id) }))
vi.mock('../../lib/progressApi', () => ({
  loadProjectModel: (id: string) => loadProjectModel(id),
  listProjectEvents: (id: string) => listProjectEvents(id),
}))
vi.mock('../../lib/projectsApi', () => ({
  listProjectNames: () => listProjectNames(),
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

/** The one filter bar under the title (FLT-01). */
const bar = () => screen.getByRole('search', { name: 'Bộ lọc' })
/** Tìm, once the options it waits for have arrived (FLT-02). */
const pressTim = async () => {
  const tim = within(bar()).getByRole('button', { name: /Tìm/ })
  await waitFor(() => expect(tim).not.toHaveClass('ant-btn-loading'))
  await userEvent.click(tim)
}
/** A read the test resolves by hand. */
function deferred<T>() {
  let resolve: (v: T) => void = () => {}
  const promise = new Promise<T>((r) => { resolve = r })
  return { promise, resolve }
}
const before = (a: Element, b: Element) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0

beforeEach(() => {
  loadProjectModel.mockReset()
  listProjectEvents.mockReset()
  listProjectNames.mockReset()
  navigate.mockReset()
  authRole.value = 'gs'
  // The field's Dự án switch keeps project names per session; every test is a new one.
  endSession()
  listWorks.mockReset()
  listDecks.mockReset()
  // Another project's options, read only while it is the DRAFT project (FLT-02).
  listWorks.mockResolvedValue([{ ...work('w9', 1, 'Giàn giáo').work, projectId: 'p2' }])
  listDecks.mockResolvedValue([{ id: 'd9', name: 'Sàn Z' }])
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

  it('reloads for the project picked in the header', async () => {
    renderAdmin()
    expect(await screen.findByText('DASHBOARD 2 sự kiện · Tất cả sàn · công việc đầu')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('combobox', { name: 'Dự án' }))
    await userEvent.click(await screen.findByTitle('Giàn B (GB)'))
    await pressTim()
    await waitFor(() => expect(loadProjectModel).toHaveBeenCalledWith('p2'))
  })

  it('holds Dự án, Công việc, Sàn and the dates in one bar under the title, in that order, unlabelled (FLT-01)', async () => {
    renderAdmin()
    expect(await screen.findByText(/^DASHBOARD 2 sự kiện/)).toBeInTheDocument()
    const project = within(bar()).getByRole('combobox', { name: 'Dự án' })
    const scope = within(bar()).getByRole('radiogroup', { name: 'Công việc' })
    const deck = within(bar()).getByRole('combobox', { name: 'Sàn' })
    const from = within(bar()).getByPlaceholderText('Từ ngày')
    expect(within(bar()).getByPlaceholderText('Đến ngày')).toBeInTheDocument()
    expect(before(project, scope) && before(scope, deck) && before(deck, from)).toBe(true)
    // No field label: the only <label>s are the Segmented's own options.
    expect(bar().querySelector('label:not(.ant-segmented-item)')).toBeNull()
    expect(screen.getByRole('heading', { level: 1, name: 'Năng suất' })).toBeInTheDocument()
  })

  it('narrows the dashboard by what the bar holds, once Tìm is pressed (FLT-02)', async () => {
    renderAdmin()
    await screen.findByText(/^DASHBOARD 2 sự kiện/)
    await userEvent.click(within(bar()).getByText('Tháo giáo'))
    expect(screen.getByText('DASHBOARD 2 sự kiện · Tất cả sàn · công việc đầu')).toBeInTheDocument()
    await pressTim()
    expect(await screen.findByText('DASHBOARD 2 sự kiện · Tất cả sàn · Tháo giáo')).toBeInTheDocument()
  })

  it('queries nothing while two filters change, then exactly once on Tìm (FLT-02)', async () => {
    renderAdmin()
    await screen.findByText(/^DASHBOARD 2 sự kiện/)
    expect(loadProjectModel).toHaveBeenCalledTimes(1)
    await userEvent.click(within(bar()).getByRole('combobox', { name: 'Sàn' }))
    await userEvent.click(await screen.findByTitle('Sàn A'))
    await userEvent.click(within(bar()).getByRole('combobox', { name: 'Dự án' }))
    await userEvent.click(await screen.findByTitle('Giàn B (GB)'))
    expect(loadProjectModel).toHaveBeenCalledTimes(1)
    expect(listProjectEvents).toHaveBeenCalledTimes(1)
    await pressTim()
    await waitFor(() => expect(loadProjectModel).toHaveBeenCalledTimes(2))
    expect(loadProjectModel).toHaveBeenLastCalledWith('p2')
    expect(listProjectEvents).toHaveBeenCalledTimes(2)
  })

  it('offers the draft project\'s decks, and drops a draft deck that project does not have (FLT-02)', async () => {
    renderAdmin()
    await screen.findByText(/^DASHBOARD 2 sự kiện/)
    await userEvent.click(within(bar()).getByRole('combobox', { name: 'Sàn' }))
    await userEvent.click(await screen.findByTitle('Sàn A'))
    await userEvent.click(within(bar()).getByRole('combobox', { name: 'Dự án' }))
    await userEvent.click(await screen.findByTitle('Giàn B (GB)'))
    await waitFor(() => expect(listDecks).toHaveBeenCalledWith('p2'))
    // Sàn A is Giàn A's: the draft falls back to Tất cả sàn.
    await waitFor(() => expect(within(bar()).getByTitle('Tất cả sàn')).toBeInTheDocument())
    await userEvent.click(within(bar()).getByRole('combobox', { name: 'Sàn' }))
    expect(await screen.findByTitle('Sàn Z')).toBeInTheDocument()
    expect(screen.queryByTitle('Sàn A')).toBeNull()
    // And the draft project's works replace the scope switch's options.
    expect(within(bar()).queryByRole('radiogroup', { name: 'Công việc' })).toBeNull()
  })

  it('keeps the chosen deck when Tìm is pressed twice while the new project loads (FLT-02)', async () => {
    const p2 = deferred<typeof MODEL>()
    loadProjectModel.mockImplementation((id: string) => (id === 'p2' ? p2.promise : Promise.resolve(MODEL)))
    renderAdmin()
    await screen.findByText(/^DASHBOARD 2 sự kiện/)
    await userEvent.click(within(bar()).getByRole('combobox', { name: 'Dự án' }))
    await userEvent.click(await screen.findByTitle('Giàn B (GB)'))
    await userEvent.click(within(bar()).getByRole('combobox', { name: 'Sàn' }))
    await userEvent.click(await screen.findByTitle('Sàn Z'))
    await pressTim()
    const tim = within(bar()).getByRole('button', { name: /Tìm/ })
    // Giàn B's data is on its way: Tìm waits, and the bar still says Sàn Z.
    expect(tim).toHaveClass('ant-btn-loading')
    await userEvent.click(tim)
    expect(within(bar()).getByTitle('Sàn Z')).toBeInTheDocument()
    p2.resolve({ ...MODEL, decks: [{ id: 'd9', name: 'Sàn Z' }] })
    expect(await screen.findByText('DASHBOARD 2 sự kiện · Sàn Z · công việc đầu')).toBeInTheDocument()
    await pressTim()
    expect(screen.getByText('DASHBOARD 2 sự kiện · Sàn Z · công việc đầu')).toBeInTheDocument()
  })

  it('clears a draft deck the newly chosen project lacks, so going back does not restore it (FLT-02)', async () => {
    renderAdmin()
    await screen.findByText(/^DASHBOARD 2 sự kiện/)
    await userEvent.click(within(bar()).getByRole('combobox', { name: 'Sàn' }))
    await userEvent.click(await screen.findByTitle('Sàn A'))
    await userEvent.click(within(bar()).getByRole('combobox', { name: 'Dự án' }))
    await userEvent.click(await screen.findByTitle('Giàn B (GB)'))
    await waitFor(() => expect(within(bar()).getByTitle('Tất cả sàn')).toBeInTheDocument())
    await userEvent.click(within(bar()).getByRole('combobox', { name: 'Dự án' }))
    await userEvent.click(await screen.findByTitle('Giàn A (GA)'))
    expect(within(bar()).getByTitle('Tất cả sàn')).toBeInTheDocument()
    await pressTim()
    expect(screen.getByText('DASHBOARD 2 sự kiện · Tất cả sàn · công việc đầu')).toBeInTheDocument()
  })

  it('offers the draft project\'s works from its works list alone, with no history read before Tìm (FLT-02)', async () => {
    listWorks.mockResolvedValue([
      { ...work('w8', 2, 'Tháo giáo B').work, projectId: 'p2' },
      { ...work('w9', 1, 'Giàn giáo').work, projectId: 'p2' },
    ])
    renderAdmin()
    await screen.findByText(/^DASHBOARD 2 sự kiện/)
    await userEvent.click(within(bar()).getByRole('combobox', { name: 'Dự án' }))
    await userEvent.click(await screen.findByTitle('Giàn B (GB)'))
    const scope = await within(bar()).findByRole('radiogroup', { name: 'Công việc' })
    expect(within(scope).getAllByRole('radio').map((r) => r.closest('label')?.textContent)).toEqual(['Giàn giáo', 'Tháo giáo B'])
    // Tìm is ready on the works and decks alone; the history is read once, on Tìm.
    await waitFor(() => expect(within(bar()).getByRole('button', { name: /Tìm/ })).not.toHaveClass('ant-btn-loading'))
    expect(listProjectEvents).toHaveBeenCalledTimes(1)
    expect(listProjectEvents).not.toHaveBeenCalledWith('p2')
  })

  it('writes ?project= when Tìm applies the project, not when the draft changes (FLT-02)', async () => {
    renderAdmin()
    await screen.findByText(/^DASHBOARD 2 sự kiện/)
    await userEvent.click(within(bar()).getByRole('combobox', { name: 'Dự án' }))
    await userEvent.click(await screen.findByTitle('Giàn B (GB)'))
    expect(screen.getByTestId('url-search')).not.toHaveTextContent('project=p2')
    await pressTim()
    await waitFor(() => expect(screen.getByTestId('url-search')).toHaveTextContent('project=p2'))
  })

  it('counts every Tìm, so the dashboard\'s pagers go back to page 1 even when nothing changed (FLT-02)', async () => {
    renderAdmin()
    const dash = await screen.findByTestId('dashboard-mock')
    const before = Number(dash.dataset.version)
    await pressTim()
    await waitFor(() => expect(Number(screen.getByTestId('dashboard-mock').dataset.version)).toBe(before + 1))
  })

  it('says so when the draft project\'s options fail, and applies it with Tất cả rather than the old selection (FLT-02)', async () => {
    listDecks.mockRejectedValue(new Error('mất kết nối'))
    renderAdmin()
    await screen.findByText(/^DASHBOARD 2 sự kiện/)
    await userEvent.click(within(bar()).getByText('Tháo giáo'))
    await userEvent.click(within(bar()).getByRole('combobox', { name: 'Sàn' }))
    await userEvent.click(await screen.findByTitle('Sàn A'))
    await userEvent.click(within(bar()).getByRole('combobox', { name: 'Dự án' }))
    await userEvent.click(await screen.findByTitle('Giàn B (GB)'))
    expect(await screen.findByText('Không tải được bộ lọc của dự án')).toBeInTheDocument()
    expect(screen.getByText('mất kết nối')).toBeInTheDocument()
    const tim = within(bar()).getByRole('button', { name: /Tìm/ })
    expect(tim).not.toHaveClass('ant-btn-loading')
    await userEvent.click(tim)
    await waitFor(() => expect(loadProjectModel).toHaveBeenLastCalledWith('p2'))
    expect(await screen.findByText('DASHBOARD 2 sự kiện · Tất cả sàn · công việc đầu')).toBeInTheDocument()
  })

  it('puts the defaults back and applies them on Đặt lại (FLT-02)', async () => {
    renderAdmin()
    await screen.findByText(/^DASHBOARD 2 sự kiện/)
    await userEvent.click(within(bar()).getByText('Tháo giáo'))
    await pressTim()
    expect(await screen.findByText('DASHBOARD 2 sự kiện · Tất cả sàn · Tháo giáo')).toBeInTheDocument()
    await userEvent.click(within(bar()).getByRole('button', { name: 'Đặt lại' }))
    expect(await screen.findByText('DASHBOARD 2 sự kiện · Tất cả sàn · công việc đầu')).toBeInTheDocument()
    // The project stays: the address carries it.
    expect(loadProjectModel).toHaveBeenCalledTimes(1)
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
    // "Năng suất" once: the tab, not a title beside it.
    expect(screen.getAllByText('Năng suất')).toHaveLength(1)
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
    await pressTim()
    expect(await screen.findByText('DASHBOARD 2 sự kiện · Sàn A · công việc đầu')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('link', { name: 'sang Giàn A' }))
    await waitFor(() => expect(loadProjectModel).toHaveBeenCalledWith('p1'))
    expect(await screen.findByText('DASHBOARD 2 sự kiện · Tất cả sàn · công việc đầu')).toBeInTheDocument()
  })

  it('gives the field the same bar, the project first (FLT-01, GS-07)', async () => {
    renderField()
    await screen.findByText(/^DASHBOARD 2 sự kiện/)
    const project = within(bar()).getByRole('combobox', { name: 'Dự án' })
    const work = within(bar()).getByRole('radiogroup', { name: 'Công việc' })
    const deck = within(bar()).getByRole('combobox', { name: 'Sàn' })
    const from = within(bar()).getByPlaceholderText('Từ ngày')
    const tim = within(bar()).getByRole('button', { name: /Tìm/ })
    expect(before(project, work) && before(work, deck) && before(deck, from) && before(from, tim)).toBe(true)
    expect(within(bar()).getAllByRole('combobox')[0]).toBe(project)
  })

  it('opens this page of another project at once from Dự án: navigation, not a draft (GS-07)', async () => {
    renderField()
    await screen.findByText(/^DASHBOARD 2 sự kiện/)
    await userEvent.click(within(bar()).getByRole('combobox', { name: 'Dự án' }))
    await userEvent.click(await screen.findByTitle('Giàn A'))
    expect(navigate).toHaveBeenCalledWith('/gs/p1/dashboard')
  })

  it('holds the field\'s draft until Tìm too (FLT-02)', async () => {
    renderField()
    await screen.findByText(/^DASHBOARD 2 sự kiện/)
    await userEvent.click(within(bar()).getByRole('combobox', { name: 'Sàn' }))
    await userEvent.click(await screen.findByTitle('Sàn A'))
    expect(screen.getByText('DASHBOARD 2 sự kiện · Tất cả sàn · công việc đầu')).toBeInTheDocument()
    await pressTim()
    expect(await screen.findByText('DASHBOARD 2 sự kiện · Sàn A · công việc đầu')).toBeInTheDocument()
  })
})
