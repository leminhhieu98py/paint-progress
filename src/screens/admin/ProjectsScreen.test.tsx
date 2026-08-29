import { screen, waitFor } from '@testing-library/react'
import dayjs from 'dayjs'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderApp } from '../../test/renderApp'
import { ProjectsScreen } from './ProjectsScreen'

const latestProgressEvent = vi.hoisted(() => vi.fn())
vi.mock('../../lib/progressApi', () => ({
  latestProgressEvent: () => latestProgressEvent(),
}))

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
  latestProgressEvent.mockReset()
  latestProgressEvent.mockResolvedValue(null)
  // Two projects, and every counter deliberately distinct from every other
  // number on the screen: the header totals (8 decks, 1.531 bays, 38.380,95
  // m²) must not be assertable by accident against a table cell.
  listProjects.mockResolvedValue([
    {
      id: 'p1', name: 'BB1 - CPPTS', code: 'BB1',
      deckCount: 5, decksWithDrawing: 4, cellCount: 917,
      totalAreaM2: 19978.2, progress: 0.4846,
    },
    {
      id: 'p2', name: 'Rạng Đông RD-2', code: 'RD2',
      deckCount: 3, decksWithDrawing: 3, cellCount: 614,
      totalAreaM2: 18402.75, progress: 0.712,
    },
  ])
})

function UrlEcho() {
  const { pathname, search } = useLocation()
  return <div data-testid="url">{pathname + search}</div>
}

/**
 * Wrapped in a router because opening a project IS navigation now: the row
 * hands its own id to the decks screen through the query string.
 */
function renderScreen() {
  return renderApp(
    <MemoryRouter initialEntries={['/admin/projects']}>
      <UrlEcho />
      <Routes>
        <Route path="/admin/projects" element={<ProjectsScreen />} />
        <Route path="/admin/decks" element={<div>màn sàn</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('ProjectsScreen row navigation', () => {
  it('opens the clicked project\'s decks, naming the project in the URL', async () => {
    renderScreen()
    await userEvent.click(await screen.findByText('Rạng Đông RD-2'))
    expect(screen.getByTestId('url')).toHaveTextContent('/admin/decks?project=p2')
  })

  it('does not navigate when the row\'s edit button is pressed', async () => {
    // The button sits inside the row. Without stopping the bubble, editing a
    // project would open its decks behind the modal -- and closing the modal
    // would leave the admin on a screen they never asked for.
    renderScreen()
    await screen.findByText('BB1 - CPPTS')
    await userEvent.click(screen.getAllByRole('button', { name: 'Sửa' })[0])
    expect(screen.getByTestId('url')).toHaveTextContent('/admin/projects')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})

describe('ProjectsScreen header counters', () => {
  it('totals area, decks and bays across every project', async () => {
    renderScreen()
    expect(await screen.findByText('38.380,95')).toBeInTheDocument()
    expect(screen.getByText('8')).toBeInTheDocument()
    expect(screen.getByText('1.531')).toBeInTheDocument()
  })

  it('says how many decks still have no drawing attached', async () => {
    // A deck with no drawing has no bays to tap, so this is the number that
    // says how much of the project is actually recordable today.
    renderScreen()
    expect(await screen.findByText('7 sàn đã có bản vẽ')).toBeInTheDocument()
  })

  it('shows the newest stage change with who made it and where', async () => {
    latestProgressEvent.mockResolvedValue({
      at: new Date('2026-08-28T09:42:00').toISOString(),
      cellCode: 'R7C11',
      toStageName: 'Coat 3',
      byName: 'Lê Trung Hiếu',
      byUsername: 'gs.hieu',
    })
    renderScreen()
    expect(await screen.findByText('gs.hieu · R7C11 → Coat 3')).toBeInTheDocument()
  })

  it('names the not-started case rather than printing an empty arrow', async () => {
    latestProgressEvent.mockResolvedValue({
      at: new Date('2026-08-28T09:42:00').toISOString(),
      cellCode: 'R7C11',
      toStageName: null,
      byName: null,
      byUsername: 'gs.hieu',
    })
    renderScreen()
    expect(await screen.findByText('gs.hieu · R7C11 → Chưa bắt đầu')).toBeInTheDocument()
  })

  it('shows a clock time for something recorded today, a date for anything older', async () => {
    // "09:42" on a three-week-old event reads as though the site is busy.
    latestProgressEvent.mockResolvedValue({
      at: dayjs().hour(7).minute(5).second(0).toISOString(),
      cellCode: 'R1C1', toStageName: 'Coat 2', byName: null, byUsername: 'gs.tuan',
    })
    const { unmount } = renderScreen()
    expect(await screen.findByText('07:05')).toBeInTheDocument()
    unmount()

    latestProgressEvent.mockResolvedValue({
      at: dayjs().subtract(21, 'day').hour(7).minute(5).second(0).toISOString(),
      cellCode: 'R1C1', toStageName: 'Coat 2', byName: null, byUsername: 'gs.tuan',
    })
    renderScreen()
    expect(
      await screen.findByText(dayjs().subtract(21, 'day').format('DD.MM') + ' · 07:05'),
    ).toBeInTheDocument()
  })

  it('says so plainly when nobody has recorded anything yet', async () => {
    renderScreen()
    expect(await screen.findByText('Chưa có ghi nhận nào')).toBeInTheDocument()
  })

  it('still renders the projects when the event read fails', async () => {
    // The counters are a nicety; the project list is the screen. A failed
    // audit read must not blank the table the admin came for.
    latestProgressEvent.mockRejectedValue(new Error('permission denied for table cell_events'))
    renderScreen()
    expect(await screen.findByText('BB1 - CPPTS')).toBeInTheDocument()
  })
})

describe('ProjectsScreen', () => {
  it('lists projects with their rollups', async () => {
    renderScreen()
    expect(await screen.findByText('BB1 - CPPTS')).toBeInTheDocument()
    expect(screen.getByText('5')).toBeInTheDocument()
    expect(screen.getByText('19.978,20')).toBeInTheDocument()
    expect(screen.getByText('48,46%')).toBeInTheDocument()
  })

  it('creates a project and refreshes', async () => {
    createProject.mockResolvedValue('p2')
    renderScreen()
    await screen.findByText('BB1 - CPPTS')

    await userEvent.click(screen.getByRole('button', { name: 'Tạo dự án' }))
    await userEvent.type(screen.getByLabelText('Tên dự án'), 'Lạc Đà Vàng')
    await userEvent.type(screen.getByLabelText('Mã dự án'), 'LDV')
    await userEvent.click(screen.getByRole('button', { name: 'Tạo' }))

    await waitFor(() =>
      expect(createProject).toHaveBeenCalledWith({ name: 'Lạc Đà Vàng', code: 'LDV' }),
    )
    expect(listProjects).toHaveBeenCalledTimes(2)
    // The list re-sorts on refresh, so a new row does not reliably appear where
    // the admin was looking. The toast is what confirms the write landed.
    expect(await screen.findByText('Đã tạo dự án')).toBeInTheDocument()
  })

  it('surfaces a create failure without closing the form', async () => {
    createProject.mockRejectedValue(new Error('duplicate key value violates unique constraint'))
    renderScreen()
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
    renderScreen()
    await screen.findByText('BB1 - CPPTS')
    // First row, explicitly: with two projects an unscoped query would pick
    // whichever button the DOM order happened to yield.
    await userEvent.click(screen.getAllByRole('button', { name: 'Sửa' })[0])
    expect(screen.getByLabelText('Tên dự án')).toHaveValue('BB1 - CPPTS')
    expect(screen.getByRole('button', { name: 'Lưu' })).toBeInTheDocument()
  })

  it('surfaces a list failure', async () => {
    listProjects.mockRejectedValue(new Error('permission denied for table projects'))
    renderScreen()
    expect(await screen.findByText(/permission denied/)).toBeInTheDocument()
  })
})
