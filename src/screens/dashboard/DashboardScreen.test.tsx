import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { pageSubtitle } from '../../test/copy'
import { DashboardScreen } from './DashboardScreen'

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
vi.mock('./ProductivityDashboard', () => ({
  ProductivityDashboard: ({ events, filters }: { events: unknown[]; filters: { work: string | null; deck: string } }) => (
    <div>DASHBOARD {events.length} sự kiện · {filters.deck || 'Tất cả sàn'} · {filters.work ?? 'công việc đầu'}</div>
  ),
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
const before = (a: Element, b: Element) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0

beforeEach(() => {
  loadProjectModel.mockReset()
  listProjectEvents.mockReset()
  listProjectNames.mockReset()
  navigate.mockReset()
  loadProjectModel.mockResolvedValue(MODEL)
  listProjectEvents.mockResolvedValue([{ id: 1 }, { id: 2 }])
  listProjectNames.mockResolvedValue([
    { id: 'p1', name: 'Giàn A', code: 'GA' }, { id: 'p2', name: 'Giàn B', code: 'GB' },
  ])
})

const renderAdmin = (path = '/admin/dashboard') =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/admin/dashboard" element={<DashboardScreen variant="admin" />} />
      </Routes>
    </MemoryRouter>,
  )

const renderField = () =>
  render(
    <MemoryRouter initialEntries={['/gs/p2/dashboard']}>
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

  it('narrows the dashboard by what the bar holds', async () => {
    renderAdmin()
    await screen.findByText(/^DASHBOARD 2 sự kiện/)
    await userEvent.click(within(bar()).getByText('Tháo giáo'))
    expect(await screen.findByText('DASHBOARD 2 sự kiện · Tất cả sàn · Tháo giáo')).toBeInTheDocument()
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
  it('reads the project from the path and offers the way back to the drawing', async () => {
    renderField()
    expect(await screen.findByText('DASHBOARD 2 sự kiện · Tất cả sàn · công việc đầu')).toBeInTheDocument()
    expect(loadProjectModel).toHaveBeenCalledWith('p2')
    expect(listProjectNames).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Về bản vẽ' }))
    expect(navigate).toHaveBeenCalledWith('/gs/p2')
  })

  it('gives the field the same bar without a project select (FLT-01, GS-04)', async () => {
    renderField()
    await screen.findByText(/^DASHBOARD 2 sự kiện/)
    expect(within(bar()).queryByRole('combobox', { name: 'Dự án' })).toBeNull()
    expect(within(bar()).getByRole('radiogroup', { name: 'Công việc' })).toBeInTheDocument()
    expect(within(bar()).getByRole('combobox', { name: 'Sàn' })).toBeInTheDocument()
    expect(within(bar()).getByPlaceholderText('Từ ngày')).toBeInTheDocument()
  })
})
