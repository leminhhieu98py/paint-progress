import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderApp } from '../../test/renderApp'
import { expectLeft } from '../../test/alignment'
import { expectAllSmall } from '../../test/controls'
import { consequenceItems, expectHelperText, keyFactTexts, pageSubtitle, ruleTexts } from '../../test/copy'
import { palette } from '../../theme'
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
  id: 'w1', projectId: 'p1', seq: 1, name: 'Sơn', kind: 'bays', weight: 0.6, counts: true, manualProgress: 0, quantityLabel: 'Diện tích', unit: 'm²', ...over,
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
    // 0.6 + 0.4; Marking does not count and stays out of the sum. A KeyFact,
    // not a hand-made pill in the header (M5, HLT-01).
    expect(keyFactTexts()).toContain('Σ trọng số 1,00')
    expect(screen.queryByTestId('works-sum')).toBeNull()
    expect(screen.getByRole('button', { name: 'Lưu công việc' })).toBeEnabled()
  })

  it('shows the list\'s facts beside the card title as KeyFacts pills (HLT-01)', async () => {
    renderScreen()
    await screen.findByDisplayValue('Sơn')
    const card = screen.getByRole('heading', { name: 'Công việc của dự án' }).parentElement as HTMLElement
    expect(keyFactTexts(card)).toEqual(['3 công việc', '2 tính vào tổng', 'Σ trọng số 1,00'])
  })

  it('shows the deck matrix\'s facts beside its title as KeyFacts pills (HLT-01)', async () => {
    renderScreen()
    await screen.findByDisplayValue('Sơn')
    await userEvent.click(within(rowOf('Sơn')).getByRole('button', { name: 'Sàn tham gia' }))
    const matrix = await screen.findByTestId('work-decks-w1')
    await within(matrix).findByLabelText('Trọng số Cellar Deck')
    expect(keyFactTexts(matrix)).toEqual(['2 / 2 sàn', 'Σ trọng số sàn 1,00'])
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
    expect(keyFactTexts()).toContain('Σ trọng số 0,90')
    const fact = screen.getAllByTestId('key-fact').find((f) => f.textContent === 'Σ trọng số 0,90')
    expect(fact).toHaveStyle({ color: palette.warning })
    expect(screen.getByRole('button', { name: 'Lưu công việc' })).toBeDisabled()
  })

  it('drops a work from the sum when it stops counting', async () => {
    renderScreen()
    await screen.findByDisplayValue('Sơn')
    await userEvent.click(within(rowOf('Tháo giáo')).getByRole('switch', { name: 'Tính vào tổng' }))
    expect(keyFactTexts()).toContain('Σ trọng số 0,60')
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
    // One lead sentence, the consequence its own item (RUL-01).
    expect(within(dialog).getByText('Lưu các công việc sau:')).toBeInTheDocument()
    expect(consequenceItems(dialog)).toEqual(['Tiến độ dự án và báo cáo tính lại theo trọng số mới'])
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

  it('lets the admin type the quantity and unit of a work, and saves them (RV6-34)', async () => {
    renderScreen()
    await screen.findByDisplayValue('Sơn')
    const row = rowOf('Tháo giáo')
    const label = within(row).getByLabelText('Đại lượng')
    const unit = within(row).getByLabelText('Đơn vị')
    expect(label).toHaveValue('Diện tích')
    expect(unit).toHaveValue('m²')
    await userEvent.clear(label)
    await userEvent.type(label, 'Khối lượng')
    await userEvent.clear(unit)
    await userEvent.type(unit, 'tấn')

    await userEvent.click(screen.getByRole('button', { name: 'Lưu công việc' }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Lưu' }))

    await waitFor(() => expect(saveWorks).toHaveBeenCalledTimes(1))
    const [, works] = saveWorks.mock.calls[0] as [string, Work[]]
    expect(works.map((w) => [w.quantityLabel, w.unit])).toEqual([
      ['Diện tích', 'm²'], ['Khối lượng', 'tấn'], ['Diện tích', 'm²'],
    ])
  })

  it('starts a new work at Diện tích / m², and locks the save while either is blank (RV6-34)', async () => {
    renderScreen()
    await screen.findByDisplayValue('Sơn')
    await userEvent.click(screen.getByRole('button', { name: 'Thêm công việc' }))
    const labels = screen.getAllByLabelText('Đại lượng')
    const units = screen.getAllByLabelText('Đơn vị')
    expect(labels[3]).toHaveValue('Diện tích')
    expect(units[3]).toHaveValue('m²')
    await userEvent.type(screen.getAllByLabelText('Tên công việc')[3], 'Dọn dẹp')
    expect(screen.getByRole('button', { name: 'Lưu công việc' })).toBeEnabled()
    await userEvent.clear(units[3])
    expect(screen.getByRole('button', { name: 'Lưu công việc' })).toBeDisabled()
    await userEvent.type(units[3], 'm')
    expect(screen.getByRole('button', { name: 'Lưu công việc' })).toBeEnabled()
  })

  it('states its rules as helper text, one quantity and unit per work among them (RV6-34, RUL-01)', async () => {
    renderScreen()
    await screen.findByDisplayValue('Sơn')
    await userEvent.click(screen.getByRole('button', { name: /Quy tắc áp dụng/ }))
    expect(ruleTexts()).toEqual([
      'Lưu được khi tổng trọng số các công việc tính vào tổng bằng 1.',
      'Công việc không tính vào tổng vẫn có tiến độ riêng nhưng không vào % dự án.',
      'Lưu sàn tham gia được khi tổng trọng số các sàn tham gia bằng 1.',
      'Anh sửa được trọng số sàn mà “Chia theo m²” điền sẵn theo diện tích.',
      'Công việc nhập tay lấy tiến độ từ con số anh gõ.',
      'Mỗi công việc dùng một đại lượng và một đơn vị cho mọi sàn của nó.',
    ])
    expectHelperText(ruleTexts())
  })

  it('opens a bays work\'s decks, fills the weights by m² on request, and saves the ones that take part', async () => {
    renderScreen()
    await screen.findByDisplayValue('Sơn')
    await userEvent.click(within(rowOf('Sơn')).getByRole('button', { name: 'Sàn tham gia' }))

    await waitFor(() => expect(listWorkDecks).toHaveBeenCalledWith('w1'))
    const matrix = await screen.findByTestId('work-decks-w1')
    // Both decks in, at the weights on file -- with the comma the rest of
    // the app writes decimals with.
    expect(within(matrix).getByRole('switch', { name: 'Cellar Deck tham gia' })).toBeChecked()
    expect(within(matrix).getByLabelText('Trọng số Cellar Deck')).toHaveValue('0,5')

    // 1000 of 4000 m² and 3000 of 4000.
    await userEvent.click(within(matrix).getByRole('button', { name: 'Chia theo m²' }))
    expect(within(matrix).getByLabelText('Trọng số Cellar Deck')).toHaveValue('0,25')
    expect(within(matrix).getByLabelText('Trọng số Main Deck')).toHaveValue('0,75')

    await userEvent.click(within(matrix).getByRole('button', { name: 'Lưu sàn tham gia' }))
    const dialog = await screen.findByRole('dialog')
    // One lead sentence, each consequence its own item (RUL-01).
    expect(within(dialog).getByText('Lưu các sàn tham gia sau:')).toBeInTheDocument()
    // No deck leaves the work here, so nothing is lost and nothing is said.
    expect(consequenceItems(dialog)).toEqual([])
    expect(within(dialog).queryByText('bỏ ra')).toBeNull()
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

  it('names the decks a save takes out of the work, and what they lose, only when there are some (RUL-01)', async () => {
    renderScreen()
    await screen.findByDisplayValue('Sơn')
    await userEvent.click(within(rowOf('Sơn')).getByRole('button', { name: 'Sàn tham gia' }))
    const matrix = await screen.findByTestId('work-decks-w1')
    await within(matrix).findByLabelText('Trọng số Cellar Deck')
    await userEvent.click(within(matrix).getByRole('switch', { name: 'Main Deck tham gia' }))
    await userEvent.click(within(matrix).getByRole('button', { name: 'Chia theo m²' }))
    await userEvent.click(within(matrix).getByRole('button', { name: 'Lưu sàn tham gia' }))
    const dialog = await screen.findByRole('dialog')
    // The deck that goes is a row of its own, marked so.
    expect(within(dialog).getByText('Main Deck')).toBeInTheDocument()
    expect(within(dialog).getByText('bỏ ra')).toBeInTheDocument()
    expect(consequenceItems(dialog)).toEqual(['Sàn bị bỏ ra khỏi công việc mất lớp sơn và vị trí ô của công việc đó'])
  })

  it('knows after a save which decks are in the work, when the matrix stays open for the next save (I6)', async () => {
    listWorkDecks.mockResolvedValue([{ deckId: 'd1', weight: 1 }])
    renderScreen()
    await screen.findByDisplayValue('Sơn')
    await userEvent.click(within(rowOf('Sơn')).getByRole('button', { name: 'Sàn tham gia' }))
    const matrix = await screen.findByTestId('work-decks-w1')
    await within(matrix).findByLabelText('Trọng số Cellar Deck')
    const saveOnce = async () => {
      await userEvent.click(within(matrix).getByRole('button', { name: 'Chia theo m²' }))
      // A regex: jsdom never ends the spinner's leave motion, so its icon stays in the name.
      await userEvent.click(within(matrix).getByRole('button', { name: /Lưu sàn tham gia$/ }))
      return screen.findByRole('dialog')
    }
    const confirm = async (dialog: HTMLElement) => {
      const calls = saveWorkDecks.mock.calls.length
      // The re-read after the save fails, so the matrix is not closed by it.
      listWorks.mockRejectedValueOnce(new Error('Failed to fetch'))
      await userEvent.click(within(dialog).getByRole('button', { name: 'Lưu' }))
      await waitFor(() => expect(saveWorkDecks).toHaveBeenCalledTimes(calls + 1))
      await waitFor(() => expect(within(matrix).getByRole('button', { name: /Lưu sàn tham gia/ })).not.toHaveClass('ant-btn-loading'))
      expect(screen.getByTestId('work-decks-w1')).toBe(matrix)
    }

    // Main Deck in, saved.
    await userEvent.click(within(matrix).getByRole('switch', { name: 'Main Deck tham gia' }))
    await confirm(await saveOnce())

    // Out again: it is in the work now, so it leaves it, and says what it loses.
    await userEvent.click(within(matrix).getByRole('switch', { name: 'Main Deck tham gia' }))
    let dialog = await saveOnce()
    expect(within(dialog).getByText('bỏ ra')).toBeInTheDocument()
    expect(consequenceItems(dialog)).toEqual(['Sàn bị bỏ ra khỏi công việc mất lớp sơn và vị trí ô của công việc đó'])
    await confirm(dialog)

    // Saved again unchanged: nothing leaves a work it has already left.
    dialog = await saveOnce()
    expect(within(dialog).queryByText('bỏ ra')).toBeNull()
    expect(consequenceItems(dialog)).toEqual([])
  })

  it('reads work weights and a manual % typed with a decimal comma', async () => {
    // antd's InputNumber with no decimalSeparator deletes the comma: "0,25"
    // became 25 and was clamped to 1, and "12,5" % became 125, clamped to 100.
    renderScreen()
    await screen.findByDisplayValue('Sơn')
    const son = within(rowOf('Sơn')).getByLabelText('Trọng số')
    await userEvent.clear(son)
    await userEvent.type(son, '0,25')
    const thao = within(rowOf('Tháo giáo')).getByLabelText('Trọng số')
    await userEvent.clear(thao)
    await userEvent.type(thao, '0,75')
    const pct = within(rowOf('Marking')).getByLabelText('Tiến độ (%)')
    await userEvent.clear(pct)
    await userEvent.type(pct, '12,5')
    await userEvent.tab()
    expect(keyFactTexts()).toContain('Σ trọng số 1,00')

    await userEvent.click(screen.getByRole('button', { name: 'Lưu công việc' }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Lưu' }))

    await waitFor(() => expect(saveWorks).toHaveBeenCalledTimes(1))
    const [, works] = saveWorks.mock.calls[0] as [string, Work[]]
    expect(works.map((w) => w.weight)).toEqual([0.25, 0.75, 0])
    expect(works[2].manualProgress).toBeCloseTo(0.125, 12)
  })

  it('reads deck weights typed with a decimal comma', async () => {
    renderScreen()
    await screen.findByDisplayValue('Sơn')
    await userEvent.click(within(rowOf('Sơn')).getByRole('button', { name: 'Sàn tham gia' }))
    const matrix = await screen.findByTestId('work-decks-w1')
    const cd = within(matrix).getByLabelText('Trọng số Cellar Deck')
    await userEvent.clear(cd)
    await userEvent.type(cd, '0,3')
    const md = within(matrix).getByLabelText('Trọng số Main Deck')
    await userEvent.clear(md)
    await userEvent.type(md, '0,7')
    await userEvent.tab()

    await userEvent.click(within(matrix).getByRole('button', { name: 'Lưu sàn tham gia' }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Lưu' }))
    await waitFor(() => expect(saveWorkDecks).toHaveBeenCalledWith('w1', [
      { deckId: 'd1', weight: 0.3 }, { deckId: 'd2', weight: 0.7 },
    ]))
  })

  it('deletes a work only behind its typed name, and reloads', async () => {
    renderScreen()
    await screen.findByDisplayValue('Sơn')
    await userEvent.click(within(rowOf('Tháo giáo')).getByRole('button', { name: 'Xóa công việc' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Xóa công việc Tháo giáo?')).toBeInTheDocument()
    const ok = within(dialog).getByRole('button', { name: /Xóa công việc/ })
    expect(ok).toBeDisabled()
    // What survives, in the admin's words: no table name (CPY-01).
    expect(within(dialog).getByText('Mất vĩnh viễn theo công việc:')).toBeInTheDocument()
    expect(consequenceItems(dialog)).toEqual(['Không khôi phục được', 'Lịch sử cập nhật vẫn giữ tên công việc này'])
    expect(within(dialog).queryByText(/cell_events/)).not.toBeInTheDocument()
    await userEvent.type(within(dialog).getByLabelText('Gõ đúng tên để xác nhận'), 'Tháo giáo')
    await userEvent.click(ok)

    await waitFor(() => expect(deleteWork).toHaveBeenCalledWith('w2'))
    expect(await screen.findByText('Đã xóa công việc Tháo giáo')).toBeInTheDocument()
    await waitFor(() => expect(listWorks).toHaveBeenCalledTimes(2))
  })

  it('has no subtitle: the project is in the Dự án select, the formula in the rules (CPY-01, CPY-03)', async () => {
    renderScreen()
    await screen.findByDisplayValue('Sơn')
    expect(pageSubtitle()).toBeNull()
    expect(screen.queryByText(/tiến độ dự án =/)).not.toBeInTheDocument()
  })

  it('puts the project select in the filter bar under the title, with no visible label (FLT-01)', async () => {
    renderScreen()
    await screen.findByDisplayValue('Sơn')
    const bar = screen.getByRole('search', { name: 'Bộ lọc' })
    expect(within(bar).getByRole('combobox', { name: 'Dự án' })).toBeInTheDocument()
    expect(bar.querySelector('label')).toBeNull()
    expect(within(bar).queryByRole('button', { name: /Thêm công việc/ })).toBeNull()
  })

  it('has no subtitle before a project is chosen either (CPY-03)', async () => {
    listProjectNames.mockResolvedValue([])
    renderScreen('/admin/works')
    expect(await screen.findByRole('heading', { level: 1, name: 'Công việc' })).toBeInTheDocument()
    expect(pageSubtitle()).toBeNull()
    expect(screen.queryByText('Chọn một dự án để xem các công việc của nó')).not.toBeInTheDocument()
  })

  it('says so when the project has no works yet', async () => {
    listWorks.mockResolvedValue([])
    loadProjectModel.mockResolvedValue({ models: [], decks: [], audit: {} })
    renderScreen()
    expect(await screen.findByText('Dự án chưa có công việc nào')).toBeInTheDocument()
  })
})

describe('WorksScreen — alignment (UI-06)', () => {
  it('gives the work name room, the table scrolling sideways rather than clipping it (M18)', async () => {
    renderScreen()
    await screen.findByDisplayValue('Sơn')
    const header = screen.getByRole('columnheader', { name: 'Tên công việc' })
    const index = [...(header.parentElement as HTMLElement).children].indexOf(header)
    const table = header.closest('table') as HTMLElement
    expect(table).toHaveStyle({ width: 'max-content' })
    expect(table.querySelectorAll('colgroup col')[index]).toHaveStyle({ width: '260px' })
  })

  it('marks the manual progress % as a suffix, with no deprecated addon warning (M17)', async () => {
    const warn = vi.spyOn(console, 'error').mockImplementation(() => {})
    const warn2 = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      renderScreen()
      const pct = await within(await waitFor(() => rowOf('Marking'))).findByLabelText('Tiến độ (%)')
      const box = pct.closest('.ant-input-number-affix-wrapper') as HTMLElement
      expect(within(box).getByText('%')).toHaveClass('ant-input-number-suffix')
      const said = [...warn.mock.calls, ...warn2.mock.calls].flat().join(' ')
      expect(said).not.toMatch(/addonAfter/)
    } finally {
      warn.mockRestore()
      warn2.mockRestore()
    }
  })

  it('names its drag handle column for a screen reader, not with an empty header (M20)', async () => {
    renderScreen()
    await screen.findByDisplayValue('Sơn')
    const handle = screen.getByRole('columnheader', { name: 'Kéo để sắp xếp' })
    expect(within(handle).getByText('Kéo để sắp xếp')).toHaveStyle({ position: 'absolute', width: '1px' })
  })

  it('keeps the typed quantity label and unit left, beside the name', async () => {
    renderScreen()
    await screen.findByDisplayValue('Sơn')
    const th = (label: string) => screen.getByRole('columnheader', { name: label })
    for (const label of ['Tên công việc', 'Đại lượng', 'Đơn vị']) expectLeft(th(label))
    expectLeft(within(rowOf('Sơn')).getAllByLabelText('Đơn vị')[0].closest('td'))
    expect(th('Trọng số')).toHaveStyle({ textAlign: 'center' })
  })
})

describe('WorksScreen — one control height per row (CTL-01)', () => {
  it('sizes every field and button in a work row small', async () => {
    renderScreen()
    await screen.findByDisplayValue('Sơn')
    expectAllSmall(rowOf('Sơn'))
  })

  it('sizes the deck weight field in the matrix small', async () => {
    renderScreen()
    await screen.findByDisplayValue('Sơn')
    await userEvent.click(within(rowOf('Sơn')).getByRole('button', { name: 'Sàn tham gia' }))
    const matrix = await screen.findByTestId('work-decks-w1')
    const weight = (await within(matrix).findAllByRole('spinbutton'))[0]
    expectAllSmall(weight.closest('tr') as HTMLElement)
  })
})

describe('WorksScreen — the deck weight matrix is one set (UI-06)', () => {
  it('shows every deck on one page: the weights must balance, and a pager would hide some of them', async () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      ...DECKS[0], id: `d${i + 1}`, seq: i + 1, name: `Sàn ${i + 1}`, code: `S${i + 1}`,
    }))
    listDecks.mockResolvedValue(many)
    listWorkDecks.mockResolvedValue(many.map((d) => ({ deckId: d.id, weight: 1 / 12 })))
    renderScreen()
    await screen.findByDisplayValue('Sơn')
    await userEvent.click(within(rowOf('Sơn')).getByRole('button', { name: 'Sàn tham gia' }))
    const matrix = within(await screen.findByTestId('work-decks-w1'))
    await waitFor(() => expect(matrix.getAllByRole('switch')).toHaveLength(12))
    expect(screen.getByTestId('work-decks-w1').querySelector('.ant-pagination')).toBeNull()
  })
})
