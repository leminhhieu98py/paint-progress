import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
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
  ProductivityDashboard: ({ events, decks }: { events: unknown[]; decks: { name: string }[] }) => (
    <div>DASHBOARD {events.length} sự kiện · {decks.map((d) => d.name).join(',')}</div>
  ),
}))
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => navigate }
})

const MODEL = { models: [], decks: [{ id: 'd1', name: 'Sàn A' }], audit: {} }

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
    expect(await screen.findByText('DASHBOARD 2 sự kiện · Sàn A')).toBeInTheDocument()
    expect(loadProjectModel).toHaveBeenCalledWith('p1')
    expect(listProjectEvents).toHaveBeenCalledWith('p1')
    expect(screen.getByText(/Giàn A · Mhr\/m²/)).toBeInTheDocument()
  })

  it('honours ?project= when it names a project that exists', async () => {
    renderAdmin('/admin/dashboard?project=p2')
    expect(await screen.findByText('DASHBOARD 2 sự kiện · Sàn A')).toBeInTheDocument()
    expect(loadProjectModel).toHaveBeenCalledWith('p2')
    expect(loadProjectModel).not.toHaveBeenCalledWith('p1')
  })

  it('reloads for the project picked in the header', async () => {
    renderAdmin()
    expect(await screen.findByText('DASHBOARD 2 sự kiện · Sàn A')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('combobox'))
    await userEvent.click(await screen.findByTitle('Giàn B (GB)'))
    await waitFor(() => expect(loadProjectModel).toHaveBeenCalledWith('p2'))
  })

  it('reports a failed read and retries on request', async () => {
    listProjectEvents.mockRejectedValueOnce(new Error('mất kết nối'))
    renderAdmin()
    expect(await screen.findByText('Không tải được số liệu năng suất')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Thử lại' }))
    expect(await screen.findByText('DASHBOARD 2 sự kiện · Sàn A')).toBeInTheDocument()
  })
})

describe('DashboardScreen (gs)', () => {
  it('reads the project from the path and offers the way back to the drawing', async () => {
    renderField()
    expect(await screen.findByText('DASHBOARD 2 sự kiện · Sàn A')).toBeInTheDocument()
    expect(loadProjectModel).toHaveBeenCalledWith('p2')
    expect(listProjectNames).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Về bản vẽ' }))
    expect(navigate).toHaveBeenCalledWith('/gs/p2')
  })
})
