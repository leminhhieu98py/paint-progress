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

  it('surfaces a list failure', async () => {
    listProjects.mockRejectedValue(new Error('permission denied for table projects'))
    render(<ProjectsScreen />)
    expect(await screen.findByText(/permission denied/)).toBeInTheDocument()
  })
})
