import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CellValue } from '../../domain/piping/imports'
import type { PipingSettings, ReinstatementPlanRow } from '../../domain/piping/types'
import type { ReinstatementEntry } from '../../lib/pipingApi'
import { expectHelperText, expectNoSpecIds, keyFactTexts, ruleTexts } from '../../test/copy'
import { renderApp } from '../../test/renderApp'
import { setViewport } from '../../test/viewport'
import type { PipingPanelProps } from './panelProps'
import { ReinstatementPanel } from './ReinstatementPanel'

const api = vi.hoisted(() => ({
  listReinstatementPlan: vi.fn(),
  replaceReinstatementPlan: vi.fn(),
  listReinstatementEntries: vi.fn(),
  addReinstatementEntry: vi.fn(),
  updateReinstatementEntry: vi.fn(),
  deleteReinstatementEntry: vi.fn(),
  listNotes: vi.fn(),
  addNote: vi.fn(),
}))
vi.mock('../../lib/pipingApi', () => ({
  listReinstatementPlan: (...a: unknown[]) => api.listReinstatementPlan(...a),
  replaceReinstatementPlan: (...a: unknown[]) => api.replaceReinstatementPlan(...a),
  listReinstatementEntries: (...a: unknown[]) => api.listReinstatementEntries(...a),
  addReinstatementEntry: (...a: unknown[]) => api.addReinstatementEntry(...a),
  updateReinstatementEntry: (...a: unknown[]) => api.updateReinstatementEntry(...a),
  deleteReinstatementEntry: (...a: unknown[]) => api.deleteReinstatementEntry(...a),
  listNotes: (...a: unknown[]) => api.listNotes(...a),
  addNote: (...a: unknown[]) => api.addNote(...a),
}))

/** The file reader stands in: a test hands over the sheets a workbook would read as. */
const xlsx = vi.hoisted(() => ({ read: vi.fn() }))
vi.mock('../../lib/piping/xlsx', () => ({
  readWorkbookRows: (file: unknown) => xlsx.read(file),
}))
const templates = vi.hoisted(() => ({ build: vi.fn() }))
vi.mock('../../lib/piping/templates', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/piping/templates')>()),
  buildReinstatementPlanTemplate: () => templates.build(),
}))
const download = vi.hoisted(() => vi.fn())
vi.mock('../../lib/projectReport', () => ({
  downloadWorkbook: (...a: unknown[]) => download(...a),
}))

// jsdom gives Recharts no size; the stand-in prints what reaches the chart.
vi.mock('./charts', () => ({
  ReinstatementChart: ({ data, mode }: { data: Array<Record<string, unknown>>; mode: string }) => (
    <div data-testid="reinstatement-chart" data-mode={mode}>
      {data.map((p) => `${String(p.key)}:${String(p.plan)}/${String(p.actual)}/${String(p.planCum)}/${String(p.actualCum)}`).join(' ')}
    </div>
  ),
}))

const SETTINGS: PipingSettings = {
  projectId: 'p1', enabled: true, weekStartDate: '2026-09-28', totalTestPacks: 1022, lateThresholdDays: 7,
}

const PLAN: ReinstatementPlanRow[] = [
  { day: '2026-10-01', planQty: 100 },
  { day: '2026-10-02', planQty: 150 },
]

const entry = (over: Partial<ReinstatementEntry>): ReinstatementEntry => ({
  id: 'e', day: '2026-10-01', qty: 1, createdBy: 'u2', createdAt: '2026-10-01T03:00:00Z', editedBy: null,
  editedAt: null, createdByName: 'Trần Văn GS', editedByName: null, ...over,
})

const ENTRIES: ReinstatementEntry[] = [
  entry({ id: 'e1', day: '2026-10-01', qty: 200 }),
  entry({
    id: 'e2', day: '2026-10-03', qty: 35, createdAt: '2026-10-03T04:00:00Z',
    editedBy: 'u1', editedAt: '2026-10-04T02:30:00Z', editedByName: 'Đoàn Linh',
  }),
]

const props = (over: Partial<PipingPanelProps> = {}): PipingPanelProps => ({
  projectId: 'p1', settings: SETTINGS, mode: 'day', variant: 'admin', role: 'admin', todayKey: '2026-10-07',
  refreshKey: 0, ...over,
})

const renderPanel = (over: Partial<PipingPanelProps> = {}) => renderApp(<ReinstatementPanel {...props(over)} />)

const asGs = { variant: 'gs', role: 'gs' } as const
const asViewer = { variant: 'gs', role: 'viewer' } as const

/** The chart, once the data is in. */
const loaded = () => screen.findByTestId('reinstatement-chart')
const dialog = () => screen.getByRole('dialog')
const qtyInput = (root: HTMLElement = document.body) => within(root).getByRole('spinbutton', { name: 'Số lượng' })
const dateInput = (root: HTMLElement = document.body) => within(root).getByLabelText('Ngày')
const entriesTable = () => within(screen.getByTestId('reinstatement-entries')).getByRole('table')
const dataRows = () => within(entriesTable()).getAllByRole('row').slice(1)

const sheet = (rows: CellValue[][]) => [{ name: 'Sheet1', rows }]
const xlsxFile = () => new File(['x'], 'plan.xlsx', {
  type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
})
const upload = async () => {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement
  await userEvent.upload(input, xlsxFile())
}

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset()
  api.listReinstatementPlan.mockResolvedValue(PLAN)
  api.listReinstatementEntries.mockResolvedValue(ENTRIES)
  api.addReinstatementEntry.mockResolvedValue('e3')
  api.updateReinstatementEntry.mockResolvedValue(undefined)
  api.deleteReinstatementEntry.mockResolvedValue(undefined)
  api.listNotes.mockResolvedValue([])
  api.replaceReinstatementPlan.mockResolvedValue({ logId: 'l1', summary: {} })
  xlsx.read.mockReset()
  templates.build.mockReset()
  templates.build.mockResolvedValue(new Blob(['t']))
  download.mockReset()
})

describe('ReinstatementPanel: summary and chart (spec §4)', () => {
  it('reads the project plan and entries and sums them against total Test Pack in vi-VN', async () => {
    renderPanel()
    await loaded()
    expect(api.listReinstatementPlan).toHaveBeenCalledWith('p1')
    expect(api.listReinstatementEntries).toHaveBeenCalledWith('p1')
    expect(screen.getByRole('heading', { level: 2, name: 'Reinstatement' })).toBeInTheDocument()
    expect(keyFactTexts()).toContain('235/1.022 – 22,99% TestPack')
  })

  it('shows - for a total that is not set, with a warning that tells the admin where to set it', async () => {
    renderPanel({ settings: { ...SETTINGS, totalTestPacks: null } })
    await loaded()
    expect(keyFactTexts()).toContain('235/- – - TestPack')
    expect(screen.getByLabelText('Nhập tổng Test Pack trong Cấu hình')).toBeInTheDocument()
  })

  it('tells a foreman the total is not set yet', async () => {
    renderPanel({ ...asGs, settings: { ...SETTINGS, totalTestPacks: null } })
    await loaded()
    expect(screen.getByLabelText('Admin chưa nhập tổng Test Pack')).toBeInTheDocument()
  })

  it('charts plan and actual per day, cumulative lines ending at plan end and today', async () => {
    renderPanel()
    const chart = await loaded()
    expect(chart).toHaveAttribute('data-mode', 'day')
    const points = (chart.textContent ?? '').split(' ')
    expect(points[0]).toBe('2026-10-01:100/200/100/200')
    expect(points[1]).toBe('2026-10-02:150/0/250/200')
    expect(points[2]).toBe('2026-10-03:null/35/null/235')
    expect(points.at(-1)).toBe('2026-10-07:null/0/null/235')
  })

  it('charts weeks in week view', async () => {
    renderPanel({ mode: 'week' })
    const chart = await loaded()
    expect(chart).toHaveAttribute('data-mode', 'week')
    expect(chart.textContent).toBe('2026-09-28:250/235/250/235 2026-10-05:null/0/null/235')
  })

  it('shows an empty state with neither plan nor entries', async () => {
    api.listReinstatementPlan.mockResolvedValue([])
    api.listReinstatementEntries.mockResolvedValue([])
    renderPanel()
    expect(await screen.findByText('Chưa có Plan hoặc số lượng Reinstatement')).toBeInTheDocument()
    expect(screen.queryByTestId('reinstatement-chart')).toBeNull()
  })

  it('says a failed read and retries it', async () => {
    api.listReinstatementEntries.mockRejectedValueOnce(new Error('Mất kết nối'))
    renderPanel()
    expect(await screen.findByText('Không tải được Reinstatement')).toBeInTheDocument()
    expect(screen.getByText('Mất kết nối')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Thử lại' }))
    await loaded()
  })

  it('reads again when Cấu hình changed something', async () => {
    const { rerender } = renderPanel()
    await loaded()
    rerender(<ReinstatementPanel {...props({ refreshKey: 1 })} />)
    await waitFor(() => expect(api.listReinstatementEntries).toHaveBeenCalledTimes(2))
  })
})

describe('ReinstatementPanel: Thêm số lượng (spec §4, Q9A, Q10A)', () => {
  it('offers the form to a foreman with today as the day, the button waiting for a quantity', async () => {
    renderPanel(asGs)
    await loaded()
    expect(dateInput()).toHaveValue('07/10/2026')
    expect(screen.getByRole('button', { name: 'Thêm số lượng' })).toBeDisabled()
  })

  it('folds its rules away as helper text, with no spec id on screen', async () => {
    renderPanel(asGs)
    await loaded()
    await userEvent.click(screen.getByRole('button', { name: /Quy tắc áp dụng/ }))
    expectHelperText(ruleTexts())
    expectNoSpecIds()
  })

  it('refuses a quantity over total Test Pack on screen, before any write', async () => {
    renderPanel(asGs)
    await loaded()
    await userEvent.type(qtyInput(), '900')
    await userEvent.click(screen.getByRole('button', { name: 'Thêm số lượng' }))
    expect(await screen.findByText('Vượt tổng Test Pack (đã có 235 / 1.022)')).toBeInTheDocument()
    expect(api.addReinstatementEntry).not.toHaveBeenCalled()
  })

  it('refuses when total Test Pack is not set', async () => {
    renderPanel({ ...asGs, settings: { ...SETTINGS, totalTestPacks: null } })
    await loaded()
    await userEvent.type(qtyInput(), '5')
    await userEvent.click(screen.getByRole('button', { name: 'Thêm số lượng' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Admin chưa nhập tổng Test Pack')
    expect(api.addReinstatementEntry).not.toHaveBeenCalled()
  })

  it('adds a vi decimal on a past day, then reads the list again', async () => {
    renderPanel(asGs)
    await loaded()
    await userEvent.clear(dateInput())
    await userEvent.type(dateInput(), '05/10/2026{Enter}')
    await userEvent.type(qtyInput(), '2,5')
    await userEvent.click(screen.getByRole('button', { name: 'Thêm số lượng' }))
    await waitFor(() => expect(api.addReinstatementEntry).toHaveBeenCalledWith('p1', '2026-10-05', 2.5))
    await waitFor(() => expect(api.listReinstatementEntries).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('Đã thêm số lượng')).toBeInTheDocument()
  })

  it('adds once however often Enter or the button is hit while the save runs', async () => {
    let finish: (id: string) => void = () => {}
    api.addReinstatementEntry.mockImplementation(() => new Promise<string>((resolve) => { finish = resolve }))
    renderPanel(asGs)
    await loaded()
    await userEvent.type(qtyInput(), '3{Enter}{Enter}')
    await userEvent.dblClick(screen.getByRole('button', { name: /Thêm số lượng/ }))
    expect(api.addReinstatementEntry).toHaveBeenCalledTimes(1)
    finish('e3')
    await waitFor(() => expect(api.listReinstatementEntries).toHaveBeenCalledTimes(2))
    expect(api.addReinstatementEntry).toHaveBeenCalledTimes(1)
  })

  it('shows the database message as is', async () => {
    api.addReinstatementEntry.mockRejectedValue(new Error('Vượt tổng Test Pack (đã có 1.020 / 1.022)'))
    renderPanel(asGs)
    await loaded()
    await userEvent.type(qtyInput(), '1')
    await userEvent.click(screen.getByRole('button', { name: 'Thêm số lượng' }))
    expect(await screen.findByText('Vượt tổng Test Pack (đã có 1.020 / 1.022)')).toBeInTheDocument()
  })

  it('offers the form to the admin too', async () => {
    renderPanel()
    await loaded()
    expect(screen.getByRole('button', { name: 'Thêm số lượng' })).toBeInTheDocument()
  })

  it('gives a viewer no form, no row action and no import', async () => {
    renderPanel(asViewer)
    await loaded()
    expect(screen.queryByRole('button', { name: 'Thêm số lượng' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Sửa số lượng' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Xoá số lượng' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Import Plan/ })).toBeNull()
    expect(dataRows()).toHaveLength(2)
  })
})

describe('ReinstatementPanel: entries (spec §4, Q8C)', () => {
  it('lists entries newest first with who entered them, when, and who edited them', async () => {
    renderPanel(asGs)
    await loaded()
    const rows = dataRows()
    expect(rows[0]).toHaveTextContent('03/10/2026')
    expect(rows[0]).toHaveTextContent('35')
    expect(rows[0]).toHaveTextContent('Trần Văn GS')
    expect(rows[0]).toHaveTextContent('11:00 03/10/2026')
    expect(rows[0]).toHaveTextContent('Đoàn Linh')
    expect(rows[1]).toHaveTextContent('01/10/2026')
    expect(rows[1]).toHaveTextContent('200')
    // A foreman reads; only the admin edits or deletes.
    expect(screen.queryByRole('button', { name: 'Sửa số lượng' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Xoá số lượng' })).toBeNull()
  })

  it('lets the admin edit an entry, checked against the cap without the entry itself', async () => {
    renderPanel()
    await loaded()
    await userEvent.click(within(dataRows()[0]).getByRole('button', { name: 'Sửa số lượng' }))
    expect(qtyInput(dialog())).toHaveValue('35')
    expect(dateInput(dialog())).toHaveValue('03/10/2026')

    await userEvent.clear(qtyInput(dialog()))
    await userEvent.type(qtyInput(dialog()), '900')
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Lưu' }))
    expect(await within(dialog()).findByText('Vượt tổng Test Pack (đã có 200 / 1.022)')).toBeInTheDocument()
    expect(api.updateReinstatementEntry).not.toHaveBeenCalled()

    await userEvent.clear(qtyInput(dialog()))
    await userEvent.type(qtyInput(dialog()), '40')
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Lưu' }))
    await waitFor(() => expect(api.updateReinstatementEntry).toHaveBeenCalledWith('e2', { day: '2026-10-03', qty: 40 }))
    await waitFor(() => expect(api.listReinstatementEntries).toHaveBeenCalledTimes(2))
  })

  it('lets the admin lower an entry or move its day while the project is over the cap, and refuses a raise', async () => {
    // Entered 235 against a total the admin since lowered to 200.
    renderPanel({ settings: { ...SETTINGS, totalTestPacks: 200 } })
    await loaded()
    const openEdit = async () => {
      await userEvent.click(within(dataRows()[0]).getByRole('button', { name: 'Sửa số lượng' }))
      return screen.getByRole('dialog')
    }

    let edit = await openEdit()
    await userEvent.clear(qtyInput(edit))
    await userEvent.type(qtyInput(edit), '30')
    await userEvent.click(within(edit).getByRole('button', { name: 'Lưu' }))
    await waitFor(() => expect(api.updateReinstatementEntry).toHaveBeenCalledWith('e2', { day: '2026-10-03', qty: 30 }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    edit = await openEdit()
    await userEvent.clear(dateInput(edit))
    await userEvent.type(dateInput(edit), '02/10/2026{Enter}')
    await userEvent.click(within(edit).getByRole('button', { name: 'Lưu' }))
    await waitFor(() => expect(api.updateReinstatementEntry).toHaveBeenLastCalledWith('e2', { day: '2026-10-02', qty: 35 }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    edit = await openEdit()
    await userEvent.clear(qtyInput(edit))
    await userEvent.type(qtyInput(edit), '36')
    await userEvent.click(within(edit).getByRole('button', { name: 'Lưu' }))
    expect(await within(edit).findByText('Vượt tổng Test Pack (đã có 200 / 200)')).toBeInTheDocument()
    expect(api.updateReinstatementEntry).toHaveBeenCalledTimes(2)
  })

  it('keeps a refused edit open with the database message', async () => {
    api.updateReinstatementEntry.mockRejectedValue(new Error('Không lưu được: dữ liệu này không còn tồn tại, hoặc bạn không có quyền sửa.'))
    renderPanel()
    await loaded()
    await userEvent.click(within(dataRows()[0]).getByRole('button', { name: 'Sửa số lượng' }))
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Lưu' }))
    expect(await within(dialog()).findByText(/Không lưu được/)).toBeInTheDocument()
  })

  it('lets the admin delete an entry after a confirmation', async () => {
    renderPanel()
    await loaded()
    await userEvent.click(within(dataRows()[1]).getByRole('button', { name: 'Xoá số lượng' }))
    expect(within(dialog()).getByText('Xoá số lượng ngày 01/10/2026?')).toBeInTheDocument()
    expect(api.deleteReinstatementEntry).not.toHaveBeenCalled()
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Xoá' }))
    await waitFor(() => expect(api.deleteReinstatementEntry).toHaveBeenCalledWith('e1'))
    await waitFor(() => expect(api.listReinstatementEntries).toHaveBeenCalledTimes(2))
  })
})

describe('ReinstatementPanel: layout', () => {
  let restoreViewport = () => {}
  afterEach(() => restoreViewport())
  const antTable = () => screen.getByTestId('reinstatement-entries').querySelector('.ant-table') as HTMLElement

  it('scrolls the entries sideways on a phone, headers on one line, the day column pinned (MOB-01)', async () => {
    restoreViewport = setViewport(390)
    renderPanel(asGs)
    await loaded()
    expect(antTable()).toHaveClass('ant-table-scroll-horizontal')
    expect(antTable().querySelector('table')?.getAttribute('style')).toContain('width: max-content')
    const pinned = antTable().querySelectorAll('thead th.ant-table-cell-fix-left')
    expect(pinned).toHaveLength(1)
    expect(pinned[0]).toHaveTextContent(/^Ngày$/)
  })

  it('pins nothing from 768 px', async () => {
    restoreViewport = setViewport(1280)
    renderPanel(asGs)
    await loaded()
    expect(antTable()).toHaveClass('ant-table-scroll-horizontal')
    expect(antTable()).not.toHaveClass('ant-table-has-fix-left')
  })

  it('gives a foreman no empty action slot in the card header', async () => {
    renderPanel(asGs)
    await loaded()
    const header = screen.getByRole('heading', { level: 2, name: 'Reinstatement' }).parentElement as HTMLElement
    expect(header.lastElementChild).toHaveAttribute('data-testid', 'key-facts')
  })
})

describe('ReinstatementPanel: Plan import (spec §8)', () => {
  it('offers the template and the import to the admin only', async () => {
    renderPanel(asGs)
    await loaded()
    expect(screen.queryByRole('button', { name: 'Tải file mẫu' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Import Plan/ })).toBeNull()
  })

  it('downloads the template', async () => {
    renderPanel()
    await loaded()
    await userEvent.click(screen.getByRole('button', { name: 'Tải file mẫu' }))
    await waitFor(() => expect(download).toHaveBeenCalledWith(expect.any(Blob), 'Mau_Reinstatement_Plan.xlsx'))
  })

  it('lists the row errors of a bad file and writes nothing', async () => {
    xlsx.read.mockResolvedValue(sheet([['Date', 'Plan Qty'], ['01/10/2026', 100], ['abc', 5]]))
    renderPanel()
    await loaded()
    await upload()
    expect(await screen.findByText('Không import được plan.xlsx')).toBeInTheDocument()
    const row = within(dialog()).getByText('Ngày không hợp lệ: "abc"').closest('tr') as HTMLElement
    expect(row).toHaveTextContent('3')
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Đóng' }))
    expect(api.replaceReinstatementPlan).not.toHaveBeenCalled()
  })

  it('says a file it cannot open', async () => {
    xlsx.read.mockRejectedValue(new Error('File lớn hơn 5 MB'))
    renderPanel()
    await loaded()
    await upload()
    expect(await screen.findByText('File lớn hơn 5 MB')).toBeInTheDocument()
    expect(api.replaceReinstatementPlan).not.toHaveBeenCalled()
  })

  it('previews the diff with counts and old → new, then replaces the plan on confirm', async () => {
    xlsx.read.mockResolvedValue(sheet([['Date', 'Plan Qty'], ['02/10/2026', 175], ['03/10/2026', 50]]))
    renderPanel()
    await loaded()
    await upload()
    expect(await screen.findByText('Xem trước Reinstatement Plan')).toBeInTheDocument()
    expect(keyFactTexts(dialog())).toEqual(['1 thêm', '1 sửa', '1 xoá', '0 giữ nguyên'])
    const line = (day: string) => within(dialog()).getByText(day).closest('tr') as HTMLElement
    expect(line('02/10/2026')).toHaveTextContent(/Sửa.*150.*175/)
    expect(line('03/10/2026')).toHaveTextContent(/Thêm.*-.*50/)
    expect(line('01/10/2026')).toHaveTextContent(/Xoá.*100.*-/)
    expect(api.replaceReinstatementPlan).not.toHaveBeenCalled()

    await userEvent.click(within(dialog()).getByRole('button', { name: 'Thay thế Plan' }))
    await waitFor(() => expect(api.replaceReinstatementPlan).toHaveBeenCalledWith(
      'p1',
      [{ day: '2026-10-02', planQty: 175 }, { day: '2026-10-03', planQty: 50 }],
      'plan.xlsx',
      { sheet: 'Sheet1', warnings: 0 },
    ))
    await waitFor(() => expect(api.listReinstatementPlan).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('Đã import Reinstatement Plan')).toBeInTheDocument()
  })

  it('keeps the preview open with the message when the replace is refused', async () => {
    xlsx.read.mockResolvedValue(sheet([['Date', 'Plan Qty'], ['02/10/2026', 175]]))
    api.replaceReinstatementPlan.mockRejectedValue(new Error('Bạn không có quyền thực hiện thao tác này'))
    renderPanel()
    await loaded()
    await upload()
    await screen.findByText('Xem trước Reinstatement Plan')
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Thay thế Plan' }))
    expect(await within(dialog()).findByText('Bạn không có quyền thực hiện thao tác này')).toBeInTheDocument()
  })
})

describe('ReinstatementPanel: admin notes (spec §9)', () => {
  const NOTE = {
    id: 'n1', target: 'reinstatement_day', day: '2026-10-03', spoolId: null, body: 'Mưa, nghỉ chiều',
    authorId: 'u1', createdAt: '2026-10-03T09:00:00Z', updatedBy: null, updatedAt: null, authorName: 'Đoàn Linh',
    updatedByName: null,
  }
  const OTHER_TAB = { ...NOTE, id: 'n2', target: 'manpower_day', body: 'Ghi chú Manpower' }

  it('marks the days with notes and opens a day\'s thread, the same day on Manpower apart', async () => {
    api.listNotes.mockResolvedValue([NOTE, OTHER_TAB])
    renderPanel()
    await loaded()
    expect(api.listNotes).toHaveBeenCalledWith('p1')
    const [oct3, oct1] = dataRows()
    expect(await within(oct3).findByRole('button', { name: 'Ghi chú (1)' })).toBeInTheDocument()
    expect(within(oct1).getByRole('button', { name: 'Ghi chú' })).toBeInTheDocument()
    await userEvent.click(within(oct3).getByRole('button', { name: 'Ghi chú (1)' }))
    const drawer = screen.getByText('Ghi chú Reinstatement 03/10/2026').closest('.ant-drawer-content') as HTMLElement
    expect(within(drawer).getByText('Mưa, nghỉ chiều')).toBeInTheDocument()
    expect(within(drawer).queryByText('Ghi chú Manpower')).toBeNull()
  })

  it('puts one note button on a day with several entries, on its first row', async () => {
    api.listNotes.mockResolvedValue([NOTE])
    api.listReinstatementEntries.mockResolvedValue([
      ...ENTRIES, entry({ id: 'e3', day: '2026-10-03', qty: 5, createdAt: '2026-10-03T08:00:00Z' }),
    ])
    renderPanel()
    await loaded()
    const rows = dataRows()
    expect(rows).toHaveLength(3)
    expect(await within(rows[0]).findByRole('button', { name: 'Ghi chú (1)' })).toBeInTheDocument()
    expect(within(rows[1]).queryByRole('button', { name: /Ghi chú/ })).toBeNull()
    expect(screen.getAllByRole('button', { name: /^Ghi chú/ })).toHaveLength(2)
  })

  it('adds a note on a day and reads the notes again', async () => {
    api.addNote.mockResolvedValue(NOTE)
    renderPanel()
    await loaded()
    await userEvent.click(within(dataRows()[1]).getByRole('button', { name: 'Ghi chú' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Ghi chú mới' }), 'Thiếu vật tư')
    await userEvent.click(screen.getByRole('button', { name: 'Thêm ghi chú' }))
    expect(api.addNote).toHaveBeenCalledWith('p1', { target: 'reinstatement_day', day: '2026-10-01' }, 'Thiếu vật tư')
    await waitFor(() => expect(api.listNotes).toHaveBeenCalledTimes(2))
  })

  it.each([['a foreman', asGs], ['a viewer', asViewer]])('never reads or shows notes for %s', async (_who, as) => {
    renderPanel(as)
    await loaded()
    expect(dataRows()).toHaveLength(2)
    expect(screen.queryByRole('button', { name: /Ghi chú/ })).toBeNull()
    expect(api.listNotes).not.toHaveBeenCalled()
  })
})
