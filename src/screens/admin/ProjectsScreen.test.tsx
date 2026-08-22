import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ProjectsScreen } from './ProjectsScreen'

const listProjects = vi.hoisted(() => vi.fn())
const createProject = vi.hoisted(() => vi.fn())
const updateProject = vi.hoisted(() => vi.fn())
vi.mock('../../lib/projectsApi', () => ({
  listProjects: () => listProjects(),
  createProject: (i: unknown) => createProject(i),
  updateProject: (id: string, i: unknown) => updateProject(id, i),
}))
vi.mock('./StageConfigPanel', () => ({
  StageConfigPanel: ({ projectId, onSaved }: { projectId: string; onSaved?: () => void }) => (
    <div>
      stages:{projectId}
      <button onClick={() => onSaved?.()}>stage saved</button>
    </div>
  ),
}))

beforeEach(() => {
  listProjects.mockReset()
  createProject.mockReset()
  listProjects.mockResolvedValue([
    { id: 'p1', name: 'BB1 - CPPTS', code: 'BB1', deckCount: 5, totalAreaM2: 19978.2, progress: 0.4846 },
  ])
})

describe('ProjectsScreen', () => {
  it('lists projects with their rollups', async () => {
    render(<ProjectsScreen />)
    expect(await screen.findByText('BB1 - CPPTS')).toBeInTheDocument()
    expect(screen.getByText('5')).toBeInTheDocument()
    expect(screen.getByText('19.978,20')).toBeInTheDocument()
    expect(screen.getByText('48,46%')).toBeInTheDocument()
  })

  it('creates a project and refreshes', async () => {
    createProject.mockResolvedValue('p2')
    render(<ProjectsScreen />)
    await screen.findByText('BB1 - CPPTS')

    await userEvent.click(screen.getByRole('button', { name: 'Tạo dự án' }))
    await userEvent.type(screen.getByLabelText('Tên dự án'), 'Lạc Đà Vàng')
    await userEvent.type(screen.getByLabelText('Mã dự án'), 'LDV')
    await userEvent.click(screen.getByRole('button', { name: 'Tạo' }))

    await waitFor(() =>
      expect(createProject).toHaveBeenCalledWith({ name: 'Lạc Đà Vàng', code: 'LDV' }),
    )
    expect(listProjects).toHaveBeenCalledTimes(2)
  })

  it('surfaces a create failure without closing the form', async () => {
    createProject.mockRejectedValue(new Error('duplicate key value violates unique constraint'))
    render(<ProjectsScreen />)
    await screen.findByText('BB1 - CPPTS')

    await userEvent.click(screen.getByRole('button', { name: 'Tạo dự án' }))
    await userEvent.type(screen.getByLabelText('Tên dự án'), 'X')
    await userEvent.type(screen.getByLabelText('Mã dự án'), 'BB1')
    await userEvent.click(screen.getByRole('button', { name: 'Tạo' }))

    expect(await screen.findByText(/duplicate key/)).toBeInTheDocument()
    expect(screen.getByLabelText('Tên dự án')).toHaveValue('X')
    expect(screen.getByLabelText('Mã dự án')).toHaveValue('BB1')
  })

  it('edits a project through the same form', async () => {
    render(<ProjectsScreen />)
    await screen.findByText('BB1 - CPPTS')
    await userEvent.click(screen.getByRole('button', { name: 'Sửa' }))
    expect(screen.getByLabelText('Tên dự án')).toHaveValue('BB1 - CPPTS')
    expect(screen.getByRole('button', { name: 'Lưu' })).toBeInTheDocument()
  })

  it('reveals the stage panel for the expanded row', async () => {
    render(<ProjectsScreen />)
    await screen.findByText('BB1 - CPPTS')
    await userEvent.click(screen.getByRole('button', { name: /expand/i }))
    expect(await screen.findByText('stages:p1')).toBeInTheDocument()
  })

  it('re-fetches the project list after the stage panel saves, so the row does not keep showing a stale rollup', async () => {
    // DecksScreen already re-fetches through its editor's onClose; a stage
    // removal changes true progress the same way a deck edit does, and
    // before this the row kept showing the pre-save rollup until the admin
    // navigated away and back.
    render(<ProjectsScreen />)
    await screen.findByText('BB1 - CPPTS')
    await userEvent.click(screen.getByRole('button', { name: /expand/i }))
    await screen.findByText('stages:p1')

    await userEvent.click(screen.getByRole('button', { name: 'stage saved' }))

    await waitFor(() => expect(listProjects).toHaveBeenCalledTimes(2))
  })

  it('surfaces a list failure', async () => {
    listProjects.mockRejectedValue(new Error('permission denied for table projects'))
    render(<ProjectsScreen />)
    expect(await screen.findByText(/permission denied/)).toBeInTheDocument()
  })
})
