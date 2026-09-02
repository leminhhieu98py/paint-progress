import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderApp } from '../../test/renderApp'
import type { Work, WorkModel } from '../../domain/types'
import { WorksScreen } from './WorksScreen'

const listProjectNames = vi.hoisted(() => vi.fn())
const listDecks = vi.hoisted(() => vi.fn())
const listWorks = vi.hoisted(() => vi.fn())
const saveWorks = vi.hoisted(() => vi.fn())
const deleteWork = vi.hoisted(() => vi.fn())
const listWorkDecks = vi.hoisted(() => vi.fn())
const saveWorkDecks = vi.hoisted(() => vi.fn())
const loadProjectModel = vi.hoisted(() => vi.fn())

vi.mock('../../lib/projectsApi', () => ({ listProjectNames: () => listProjectNames() }))
vi.mock('../../lib/decksApi', () => ({ listDecks: (p: string) => listDecks(p) }))
vi.mock('../../lib/worksApi', () => ({
  listWorks: (p: string) => listWorks(p),
  saveWorks: (p: string, w: unknown) => saveWorks(p, w),
  deleteWork: (id: string) => deleteWork(id),
  listWorkDecks: (id: string) => listWorkDecks(id),
  saveWorkDecks: (id: string, rows: unknown) => saveWorkDecks(id, rows),
}))
vi.mock('../../lib/progressApi', () => ({ loadProjectModel: (p: string) => loadProjectModel(p) }))

const work = (over: Partial<Work> = {}): Work => ({
  id: 'w1', projectId: 'p1', seq: 1, name: 'Sơn', kind: 'bays', weight: 0.6, counts: true, manualProgress: 0, ...over,
})
const WORKS: Work[] = [
  work(),
  work({ id: 'w2', seq: 2, name: 'Tháo giáo', weight: 0.4 }),
  work({ id: 'w3', seq: 3, name: 'Marking', kind: 'manual', weight: 0, counts: false, manualProgress: 0.12 }),
]
const DECKS = [
  { id: 'd1', projectId: 'p1', seq: 1, name: 'Cellar Deck', code: 'CD', imagePath: null, imageW: null, imageH: null, drawingName: null, drawingPage: null, totalAreaM2: 1000, areaSource: 'guides', cellCount: 10 },
  { id: 'd2', projectId: 'p1', seq: 2, name: 'Main Deck', code: 'MD', imagePath: null, imageW: null, imageH: null, drawingName: null, drawingPage: null, totalAreaM2: 3000, areaSource: 'guides', cellCount: 20 },
]
/** Sơn: CD at 40% with D 0.5, MD untouched with D 0.5 -> P_w = 0.2. */
const MODELS: WorkModel[] = [
  {
    work: WORKS[0],
    decks: [
      {
        deck: { id: 'd1', code: 'CD', name: 'Cellar Deck', totalAreaM2: 1000,
          cells: [{ id: 'c1', code: 'R1C1', x: 0, y: 0, w: 1, h: 1, areaM2: 400, stageId: 's1' }] },
        stages: [{ id: 's1', seq: 1, name: 'Coat 1', color: '#111111', weight: 1 }],
        weight: 0.5,
      },
      { deck: { id: 'd2', code: 'MD', name: 'Main Deck', totalAreaM2: 3000, cells: [] }, stages: [], weight: 0.5 },
    ],
  },
  { work: WORKS[1], decks: [] },
  { work: WORKS[2], decks: [] },
]

beforeEach(() => {
  for (const m of [listProjectNames, listDecks, listWorks, saveWorks, deleteWork, listWorkDecks, saveWorkDecks, loadProjectModel]) m.mockReset()
  listProjectNames.mockResolvedValue([{ id: 'p1', name: 'BB1', code: 'BB1' }, { id: 'p2', name: 'RD2', code: 'RD2' }])
  listDecks.mockResolvedValue(DECKS)
  listWorks.mockResolvedValue(WORKS)
  saveWorks.mockResolvedValue(undefined)
  deleteWork.mockResolvedValue(undefined)
  listWorkDecks.mockResolvedValue([{ deckId: 'd1', weight: 0.5 }, { deckId: 'd2', weight: 0.5 }])
  saveWorkDecks.mockResolvedValue(undefined)
  loadProjectModel.mockResolvedValue({ models: MODELS, decks: [], audit: {} })
})

const renderScreen = (entry = '/admin/works?project=p1') =>
  renderApp(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/admin/works" element={<WorksScreen />} />
      </Routes>
    </MemoryRouter>,
  )

const rowOf = (name: string) => screen.getByDisplayValue(name).closest('tr') as HTMLElement

describe('WorksScreen', () => {
  it('lists the works of the project named in the URL, with the counted weights summed', async () => {
    renderScreen()
    await screen.findByDisplayValue('Sơn')
    expect(listWorks).toHaveBeenCalledWith('p1')
    expect(screen.getByDisplayValue('Tháo giáo')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Marking')).toBeInTheDocument()
    // 0.6 + 0.4; Marking does not count and stays out of the sum.
    expect(screen.getByTestId('works-sum')).toHaveTextContent('1,00')
    expect(screen.getByRole('button', { name: 'Lưu công việc' })).toBeEnabled()
  })

  it('shows a bays work\'s computed progress and lets a manual work\'s be typed', async () => {
    renderScreen()
    await screen.findByDisplayValue('Sơn')
    // Sơn: 0.5·0.4 + 0.5·0 from the model.
    expect(within(rowOf('Sơn')).getByText('20,00%')).toBeInTheDocument()
    // Marking: the admin's number, as a percentage field.
    expect(within(rowOf('Marking')).getByLabelText('Tiến độ (%)')).toHaveValue('12')
  })

  it('locks the save while the counted weights do not sum to 1', async () => {
    renderScreen()
    await screen.findByDisplayValue('Sơn')
    const weight = within(rowOf('Tháo giáo')).getByLabelText('Trọng số')
    await userEvent.clear(weight)
    await userEvent.type(weight, '0.3')
    await userEvent.tab()
    expect(screen.getByTestId('works-sum')).toHaveTextContent('0,90')
    expect(screen.getByRole('button', { name: 'Lưu công việc' })).toBeDisabled()
  })

  it('drops a work from the sum when it stops counting', async () => {
    renderScreen()
    await screen.findByDisplayValue('Sơn')
    await userEvent.click(within(rowOf('Tháo giáo')).getByRole('switch', { name: 'Tính vào tổng' }))
    expect(screen.getByTestId('works-sum')).toHaveTextContent('0,60')
    expect(screen.getByRole('button', { name: 'Lưu công việc' })).toBeDisabled()
  })

  it('asks before saving, then writes the whole list and says so', async () => {
    renderScreen()
    await screen.findByDisplayValue('Sơn')
    const pct = within(rowOf('Marking')).getByLabelText('Tiến độ (%)')
    await userEvent.clear(pct)
    await userEvent.type(pct, '19')
    await userEvent.tab()

    await userEvent.click(screen.getByRole('button', { name: 'Lưu công việc' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/Lưu công việc/)).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Lưu' }))

    await waitFor(() => expect(saveWorks).toHaveBeenCalledTimes(1))
    const [projectId, works] = saveWorks.mock.calls[0] as [string, Work[]]
    expect(projectId).toBe('p1')
    expect(works.map((w) => [w.id, w.seq, w.weight, w.counts])).toEqual([['w1', 1, 0.6, true], ['w2', 2, 0.4, true], ['w3', 3, 0, false]])
    expect(works[2].manualProgress).toBeCloseTo(0.19, 12)
    expect(await screen.findByText('Đã lưu công việc')).toBeInTheDocument()
  })

  it('adds an editable row for a new work, counted and weightless until the admin says otherwise', async () => {
    renderScreen()
    await screen.findByDisplayValue('Sơn')
    await userEvent.click(screen.getByRole('button', { name: 'Thêm công việc' }))
    const names = screen.getAllByLabelText('Tên công việc')
    expect(names).toHaveLength(4)
    expect(names[3]).toHaveValue('')
    // A fourth row at weight 0 leaves the sum at 1,00; it is the name that is missing.
    expect(screen.getByRole('button', { name: 'Lưu công việc' })).toBeDisabled()
    await userEvent.type(names[3], 'Dọn dẹp')
    expect(screen.getByRole('button', { name: 'Lưu công việc' })).toBeEnabled()
  })

  it('opens a bays work\'s decks, fills the weights by m² on request, and saves the ones that take part', async () => {
    renderScreen()
    await screen.findByDisplayValue('Sơn')
    await userEvent.click(within(rowOf('Sơn')).getByRole('button', { name: 'Sàn tham gia' }))

    await waitFor(() => expect(listWorkDecks).toHaveBeenCalledWith('w1'))
    const matrix = await screen.findByTestId('work-decks-w1')
    // Both decks in, at the weights on file.
    expect(within(matrix).getByRole('switch', { name: 'Cellar Deck tham gia' })).toBeChecked()
    expect(within(matrix).getByLabelText('Trọng số Cellar Deck')).toHaveValue('0.5')

    // 1000 of 4000 m² and 3000 of 4000.
    await userEvent.click(within(matrix).getByRole('button', { name: 'Chia theo m²' }))
    expect(within(matrix).getByLabelText('Trọng số Cellar Deck')).toHaveValue('0.25')
    expect(within(matrix).getByLabelText('Trọng số Main Deck')).toHaveValue('0.75')

    await userEvent.click(within(matrix).getByRole('button', { name: 'Lưu sàn tham gia' }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Lưu' }))
    await waitFor(() => expect(saveWorkDecks).toHaveBeenCalledWith('w1', [
      { deckId: 'd1', weight: 0.25 }, { deckId: 'd2', weight: 0.75 },
    ]))
    expect(await screen.findByText('Đã lưu sàn tham gia')).toBeInTheDocument()
  })

  it('leaves out a deck switched off, and locks the save while the rest do not sum to 1', async () => {
    renderScreen()
    await screen.findByDisplayValue('Sơn')
    await userEvent.click(within(rowOf('Sơn')).getByRole('button', { name: 'Sàn tham gia' }))
    const matrix = await screen.findByTestId('work-decks-w1')
    await userEvent.click(within(matrix).getByRole('switch', { name: 'Main Deck tham gia' }))
    // CD alone at 0.5 does not sum to 1.
    expect(within(matrix).getByRole('button', { name: 'Lưu sàn tham gia' })).toBeDisabled()
    await userEvent.click(within(matrix).getByRole('button', { name: 'Chia theo m²' }))
    // Shares among the decks that take part: CD alone -> 1.
    expect(within(matrix).getByLabelText('Trọng số Cellar Deck')).toHaveValue('1')
    expect(within(matrix).getByRole('button', { name: 'Lưu sàn tham gia' })).toBeEnabled()
  })

  it('deletes a work only behind its typed name, and reloads', async () => {
    renderScreen()
    await screen.findByDisplayValue('Sơn')
    await userEvent.click(within(rowOf('Tháo giáo')).getByRole('button', { name: 'Xóa công việc' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Xóa công việc Tháo giáo?')).toBeInTheDocument()
    const ok = within(dialog).getByRole('button', { name: /Xóa công việc/ })
    expect(ok).toBeDisabled()
    await userEvent.type(within(dialog).getByLabelText('Gõ đúng tên để xác nhận'), 'Tháo giáo')
    await userEvent.click(ok)

    await waitFor(() => expect(deleteWork).toHaveBeenCalledWith('w2'))
    expect(await screen.findByText('Đã xóa công việc Tháo giáo')).toBeInTheDocument()
    await waitFor(() => expect(listWorks).toHaveBeenCalledTimes(2))
  })

  it('says so when the project has no works yet', async () => {
    listWorks.mockResolvedValue([])
    loadProjectModel.mockResolvedValue({ models: [], decks: [], audit: {} })
    renderScreen()
    expect(await screen.findByText('Dự án chưa có công việc nào')).toBeInTheDocument()
  })
})
