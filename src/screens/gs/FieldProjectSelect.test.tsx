import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { endSession } from '../../lib/sessionCache'
import { rememberProjectName } from './fieldProjects'
import { FieldProjectSelect } from './FieldProjectSelect'

const listProjectNames = vi.hoisted(() => vi.fn())
vi.mock('../../lib/projectsApi', () => ({
  listProjectNames: () => listProjectNames(),
}))
const loadGsProjectIdentity = vi.hoisted(() => vi.fn())
vi.mock('../../lib/gsApi', () => ({
  loadGsProjectIdentity: (projectId: string) => loadGsProjectIdentity(projectId),
}))
const navigate = vi.hoisted(() => vi.fn())
vi.mock('react-router-dom', async (importOriginal) => ({
  ...await importOriginal<typeof import('react-router-dom')>(),
  useNavigate: () => navigate,
}))

const renderAt = (path: string, projectId = 'p1') =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        {['/gs/:projectId', '/gs/:projectId/dashboard', '/gs/:projectId/kpi'].map((p) => (
          <Route key={p} path={p} element={<FieldProjectSelect projectId={projectId} />} />
        ))}
      </Routes>
    </MemoryRouter>,
  )

const box = () => screen.findByRole('combobox', { name: 'Dự án' })
const shown = (name: string) => screen.findByText(name, { selector: '.ant-select-selection-item' })

beforeEach(() => {
  // Project names are kept per session (fieldProjects); every test is a new one.
  endSession()
  navigate.mockReset()
  listProjectNames.mockReset()
  // RLS answers this read: a foreman's memberships, a viewer's every project.
  listProjectNames.mockResolvedValue([
    { id: 'p1', name: 'BlockB1_CPPTS', code: 'BB1' },
    { id: 'p2', name: 'Đại Hùng', code: 'DH' },
  ])
  loadGsProjectIdentity.mockReset()
})

describe('FieldProjectSelect: the project, first in every field filter bar (GS-07)', () => {
  it('shows the project on screen by name, from the list of projects this account can open', async () => {
    renderAt('/gs/p1')
    expect(await shown('BlockB1_CPPTS')).toBeInTheDocument()
    expect(listProjectNames).toHaveBeenCalledTimes(1)
    expect(loadGsProjectIdentity).not.toHaveBeenCalled()
  })

  it('is there with one option for an account on one project, so every bar reads the same', async () => {
    listProjectNames.mockResolvedValue([{ id: 'p1', name: 'BlockB1_CPPTS', code: 'BB1' }])
    renderAt('/gs/p1')
    await shown('BlockB1_CPPTS')
    await userEvent.click(await box())
    expect(await screen.findAllByRole('option')).toHaveLength(1)
  })

  it('is searchable by name, without tones', async () => {
    renderAt('/gs/p1')
    await shown('BlockB1_CPPTS')
    await userEvent.type(await box(), 'dai')
    expect(await screen.findByTitle('Đại Hùng')).toBeInTheDocument()
  })

  it.each([
    ['/gs/p1', '/gs/p2'],
    ['/gs/p1/dashboard', '/gs/p2/dashboard'],
    ['/gs/p1/kpi', '/gs/p2/kpi'],
    ['/gs/p1/kpi/', '/gs/p2/kpi'],
  ])('switches on %s to the same page of the chosen project, at once', async (from, to) => {
    renderAt(from)
    await userEvent.click(await box())
    await userEvent.click(await screen.findByTitle('Đại Hùng'))
    expect(navigate).toHaveBeenCalledWith(to)
  })

  it('does not navigate when the project on screen is chosen again', async () => {
    renderAt('/gs/p1')
    await shown('BlockB1_CPPTS')
    await userEvent.click(await box())
    await screen.findByTitle('Đại Hùng')
    await userEvent.click(document.querySelector('.ant-select-item-option[title="BlockB1_CPPTS"]') as HTMLElement)
    expect(navigate).not.toHaveBeenCalled()
  })

  it('reads the list once per session, across remounts and project switches (M-1)', async () => {
    const first = renderAt('/gs/p1')
    await shown('BlockB1_CPPTS')
    first.unmount()
    renderAt('/gs/p1/kpi')
    expect(screen.getByText('BlockB1_CPPTS', { selector: '.ant-select-selection-item' })).toBeInTheDocument()
    expect(listProjectNames).toHaveBeenCalledTimes(1)
  })

  it('re-reads a cached list once when it lacks the project on screen (M-1b)', async () => {
    const first = renderAt('/gs/p1')
    await shown('BlockB1_CPPTS')
    first.unmount()
    listProjectNames.mockResolvedValue([
      { id: 'p1', name: 'BlockB1_CPPTS', code: 'BB1' },
      { id: 'p9', name: 'Giàn mới', code: 'GM' },
    ])
    renderAt('/gs/p9', 'p9')
    expect(await shown('Giàn mới')).toBeInTheDocument()
    expect(listProjectNames).toHaveBeenCalledTimes(2)
  })

  it('reads the list again after the session ends', async () => {
    const first = renderAt('/gs/p1')
    await shown('BlockB1_CPPTS')
    first.unmount()
    endSession()
    renderAt('/gs/p1')
    await waitFor(() => expect(listProjectNames).toHaveBeenCalledTimes(2))
  })

  it('names the project from the screen\'s own read while the list is on its way', async () => {
    listProjectNames.mockReturnValue(new Promise(() => {}))
    rememberProjectName('p1', 'BlockB1_CPPTS')
    renderAt('/gs/p1')
    expect(await shown('BlockB1_CPPTS')).toBeInTheDocument()
  })

  it('keeps the project on screen when the list cannot be read', async () => {
    listProjectNames.mockRejectedValue(new Error('Failed to fetch'))
    renderAt('/gs/p1')
    expect(await box()).toBeInTheDocument()
    expect(await shown('p1')).toBeInTheDocument()
  })
})
