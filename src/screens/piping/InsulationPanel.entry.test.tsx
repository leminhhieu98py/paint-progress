import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ActualChange } from '../../domain/piping/cam'
import type { CellValue } from '../../domain/piping/imports'
import type { PipingSettings, Spool, SpoolColumn } from '../../domain/piping/types'
import { renderApp } from '../../test/renderApp'
import { chooseOption } from '../../test/select'
import { setViewport } from '../../test/viewport'
import { InsulationPanel } from './InsulationPanel'
import type { PipingPanelProps } from './panelProps'

const api = vi.hoisted(() => ({
  listSpools: vi.fn(), listSpoolColumns: vi.fn(), replaceSpools: vi.fn(), setSpoolActuals: vi.fn(), listNotes: vi.fn(),
}))
vi.mock('../../lib/pipingApi', () => ({
  listSpools: (...a: unknown[]) => api.listSpools(...a),
  listSpoolColumns: (...a: unknown[]) => api.listSpoolColumns(...a),
  replaceSpools: (...a: unknown[]) => api.replaceSpools(...a),
  setSpoolActuals: (...a: unknown[]) => api.setSpoolActuals(...a),
  listNotes: (...a: unknown[]) => api.listNotes(...a),
  flattenActualUpdates: (updates: Array<{ spoolId: string; changes: Array<Omit<ActualChange, 'spoolId'>> }>) =>
    updates.flatMap((u) => u.changes.map((c) => ({ spoolId: u.spoolId, milestone: c.milestone, date: c.date }))),
}))
const read = vi.hoisted(() => vi.fn())
vi.mock('../../lib/piping/xlsx', () => ({ readWorkbookRows: (file: unknown) => read(file) }))
const download = vi.hoisted(() => vi.fn())
vi.mock('../../lib/projectReport', () => ({ downloadWorkbook: (...a: unknown[]) => download(...a) }))
const templates = vi.hoisted(() => ({ plan: vi.fn(), actual: vi.fn() }))
vi.mock('../../lib/piping/templates', () => ({
  buildSpoolPlanTemplate: (labels: string[]) => templates.plan(labels),
  buildSpoolActualTemplate: () => templates.actual(),
  templateFileName: (kind: string) => `${kind}.xlsx`,
}))
vi.mock('./insulation/InsulationChart', () => ({ InsulationChart: () => <div data-testid="insulation-chart" /> }))

const SETTINGS: PipingSettings = {
  projectId: 'p1', enabled: true, weekStartDate: '2026-09-28', totalTestPacks: null, lateThresholdDays: 7,
}
const TODAY = '2026-10-07'

const spool = (seq: number, over: Partial<Spool> = {}): Spool => ({
  id: `s${seq}`, seq, spoolNo: `SP-${seq}`, lineNo: 'L1', insuType: 'HC', drawingNo: 'D1', testPackageNo: 'TP1',
  paintingSystem: 'BD-02B', extra: {}, phPlan: '2026-10-01', ihPlan: null, iwPlan: null, phActual: null,
  ihActual: null, iwActual: null, ...over,
})

// s1 plain; s2 holds a PH actual (an overwrite); s3's IH is before the day (an order break);
// s4 already holds the day; s5 on another line. s6 shares SpoolNo SP-1 with s1 (R-11).
const SPOOLS: Spool[] = [
  spool(1),
  spool(2, { phActual: '2026-10-02' }),
  spool(3, { ihActual: '2026-10-03' }),
  spool(4, { phActual: TODAY }),
  spool(5, { lineNo: 'L2', testPackageNo: 'TP2' }),
  spool(6, { spoolNo: 'SP-1', lineNo: 'L2', testPackageNo: 'TP2' }),
]
const COLUMNS: SpoolColumn[] = [{ id: 'c1', label: 'Zone', sort: 1 }]

const props = (over: Partial<PipingPanelProps> = {}): PipingPanelProps => ({
  projectId: 'p1', settings: SETTINGS, mode: 'day', variant: 'admin', role: 'admin', todayKey: TODAY,
  refreshKey: 0, ...over,
})
const renderPanel = (over: Partial<PipingPanelProps> = {}) => renderApp(<InsulationPanel {...props(over)} />)
const asGs = { variant: 'gs', role: 'gs' } as const
const asViewer = { variant: 'gs', role: 'viewer' } as const

const ready = () => screen.findByRole('heading', { level: 2, name: 'Chi tiết' })
const dialog = () => screen.findByRole('dialog')
const facts = (root: HTMLElement) => within(within(root).getAllByTestId('key-facts')[0]).getAllByRole('listitem')
  .map((li) => li.textContent)

/** The file input of the upload button named `name`. */
function fileInputOf(name: RegExp): HTMLInputElement {
  const button = screen.getByRole('button', { name })
  return button.closest('.ant-upload')?.querySelector('input[type="file"]') as HTMLInputElement
}
const pick = (name: RegExp, file = 'file.xlsx') => userEvent.upload(
  fileInputOf(name),
  new File(['x'], file, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
)

const PLAN_HEADER = [
  'SpoolNo', 'LineNo', 'InsuType', 'DrawingNo', 'Test Package No', 'Painting System',
  'Painting Handover – Plan', 'Insulation Handover – Plan', 'Insulation Work – Plan', 'Zone',
]
const planRow = (spoolNo: string, ph: CellValue, ih: CellValue = null, zone: CellValue = null): CellValue[] =>
  [spoolNo, 'L1', 'HC', 'D1', 'TP1', 'BD-02B', ph, ih, null, zone]
const sheet = (rows: CellValue[][]) => [{ name: 'Insulation Plan', rows }]

let undoViewport: () => void
beforeEach(() => {
  undoViewport = setViewport(1280)
  for (const f of Object.values(api)) f.mockReset()
  api.listSpools.mockResolvedValue(SPOOLS)
  api.listSpoolColumns.mockResolvedValue(COLUMNS)
  api.replaceSpools.mockResolvedValue({ rowCount: 0 })
  api.listNotes.mockResolvedValue([])
  read.mockReset()
  download.mockReset()
  templates.plan.mockReset().mockResolvedValue(new Blob(['p']))
  templates.actual.mockReset().mockResolvedValue(new Blob(['a']))
})
afterEach(() => undoViewport())

describe('Insulation: role gating (spec §1, R-12)', () => {
  it('gives the admin the Plan import, the actual entry, the Actual import and Xoá Actual', async () => {
    renderPanel()
    await ready()
    expect(screen.getByRole('button', { name: /Import Plan/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Tải file mẫu' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cập nhật Actual' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Import Actual/ })).toBeInTheDocument()
    await chooseOption('Cấp hiển thị', 'Spool')
    expect(screen.getAllByRole('button', { name: 'Xoá Actual' }).length).toBeGreaterThan(0)
  })

  it('gives a foreman the actual entry and the Actual import, no Plan import and no clearing', async () => {
    renderPanel(asGs)
    await ready()
    expect(screen.queryByRole('button', { name: /Import Plan/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'Cập nhật Actual' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Import Actual/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Tải file mẫu Actual' })).toBeInTheDocument()
    await chooseOption('Cấp hiển thị', 'Spool')
    expect(screen.queryByRole('button', { name: 'Xoá Actual' })).toBeNull()
    expect(screen.queryByRole('columnheader', { name: 'Thao tác' })).toBeNull()
  })

  it('gives a viewer none of them', async () => {
    renderPanel(asViewer)
    await ready()
    for (const name of [/Import Plan/, /Cập nhật Actual/, /Import Actual/, /Tải file mẫu/]) {
      expect(screen.queryByRole('button', { name })).toBeNull()
    }
    await chooseOption('Cấp hiển thị', 'Spool')
    expect(screen.queryByRole('button', { name: 'Xoá Actual' })).toBeNull()
  })
})

describe('Insulation: Plan import (spec §6.2, §8, R-10, Q19A)', () => {
  it('offers the import in the empty state of a project with no spools', async () => {
    api.listSpools.mockResolvedValue([])
    renderPanel()
    expect(await screen.findByText('Chưa có spool nào')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Import Plan/ })).toBeInTheDocument()
  })

  it('downloads the template with the extra columns', async () => {
    renderPanel()
    await ready()
    await userEvent.click(screen.getByRole('button', { name: 'Tải file mẫu' }))
    await waitFor(() => expect(download).toHaveBeenCalledWith(expect.any(Blob), 'spool_plan.xlsx'))
    expect(templates.plan).toHaveBeenCalledWith(['Zone'])
  })

  it('previews added, changed and removed spools, flags and warns of the actuals lost, then replaces', async () => {
    // SP-1 twice (both kept: s1 and s6), SP-2 gone (it has an actual), SP-3, SP-4, SP-5 gone,
    // SP-7 new with IH before PH (a plan-order warning), SP-3's Zone set.
    read.mockResolvedValue(sheet([
      PLAN_HEADER,
      planRow('SP-1', '2026-10-01'),
      planRow('SP-1', '2026-10-01'),
      planRow('SP-3', '2026-10-01', null, 'A'),
      planRow('SP-4', '2026-10-01'),
      planRow('SP-7', '2026-10-09', '2026-10-08'),
    ]))
    renderPanel()
    await ready()
    await pick(/Import Plan/, 'plan.xlsx')
    const box = await dialog()
    expect(within(box).getByText('Xem trước Insulation Plan')).toBeInTheDocument()
    expect(facts(box)).toEqual(['1 thêm', '2 sửa', '2 xoá', '2 giữ nguyên'])
    // The duplicate SpoolNo and the plan-order break are listed, not blocking.
    expect(within(box).getByText(/SpoolNo "SP-1" lặp lại ở các dòng 2, 3/)).toBeInTheDocument()
    expect(within(box).getByText(/Dòng 6: Sai thứ tự: Painting Handover/)).toBeInTheDocument()
    const removed = within(box).getByText('SP-2').closest('tr') as HTMLElement
    expect(within(removed).getByText('có Actual')).toBeInTheDocument()
    const sp5 = within(box).getByText('SP-5').closest('tr') as HTMLElement
    expect(within(sp5).queryByText('có Actual')).toBeNull()
    expect(within(box).getByText('1 spool bị xoá cùng ngày Actual đã nhập: SP-2.')).toBeInTheDocument()
    const confirm = within(box).getByRole('button', { name: /Thay thế Plan/ })
    expect(confirm).toHaveClass('ant-btn-dangerous')

    api.listSpools.mockClear()
    await userEvent.click(confirm)
    // Deleting actuals is never one click: XOÁ is typed first.
    expect(api.replaceSpools).not.toHaveBeenCalled()
    await userEvent.type(await screen.findByLabelText('Gõ XOÁ để xác nhận'), 'XOÁ')
    const typed = screen.getAllByRole('dialog').at(-1) as HTMLElement
    await userEvent.click(within(typed).getByRole('button', { name: /Thay thế Plan/ }))
    await waitFor(() => expect(api.replaceSpools).toHaveBeenCalledTimes(1))
    const [project, rows, fileName, summary] = api.replaceSpools.mock.calls[0]
    expect(project).toBe('p1')
    expect(fileName).toBe('plan.xlsx')
    expect((rows as Array<{ spoolNo: string; extra: Record<string, string> }>).map((r) => r.spoolNo))
      .toEqual(['SP-1', 'SP-1', 'SP-3', 'SP-4', 'SP-7'])
    expect((rows as Array<{ extra: Record<string, string> }>)[2].extra).toEqual({ Zone: 'A' })
    // The preview's own counts sit apart from the ones the database writes into the log.
    expect(summary).toEqual({
      sheet: 'Insulation Plan', warnings: 2, client: { added: 1, changed: 2, removed: 2, removedWithActuals: 1 },
    })
    await waitFor(() => expect(api.listSpools).toHaveBeenCalledWith('p1'))
  })

  it('reads the spools afresh for the preview: an actual entered since the page opened is flagged', async () => {
    read.mockResolvedValue(sheet([PLAN_HEADER, ...['SP-1', 'SP-1', 'SP-2', 'SP-3', 'SP-4'].map((n) => planRow(n, '2026-10-01'))]))
    renderPanel()
    await ready()
    // Meanwhile a foreman entered SP-5's PH actual; the page still holds the old list.
    api.listSpools.mockResolvedValue(SPOOLS.map((s) => (s.id === 's5' ? { ...s, phActual: '2026-10-06' } : s)))
    await pick(/Import Plan/, 'plan.xlsx')
    const box = await dialog()
    const sp5 = (await within(box).findByText('SP-5')).closest('tr') as HTMLElement
    expect(within(sp5).getByText('có Actual')).toBeInTheDocument()
    expect(within(box).getByText('1 spool bị xoá cùng ngày Actual đã nhập: SP-5.')).toBeInTheDocument()
    expect(within(box).getByRole('button', { name: /Thay thế Plan/ })).toHaveClass('ant-btn-dangerous')
  })

  it('reads the notes afresh for the preview, says the removed spools\' notes go with them, and reads them again after', async () => {
    read.mockResolvedValue(sheet([PLAN_HEADER, ...['SP-1', 'SP-1', 'SP-2', 'SP-3', 'SP-4'].map((n) => planRow(n, '2026-10-01'))]))
    renderPanel()
    await ready()
    // Two notes were written on SP-5 (dropped by the file) since the page read them; one on SP-3 (kept).
    const spoolNote = (id: string, spoolId: string) => ({
      id, target: 'spool', day: null, spoolId, body: id, authorId: 'u1', createdAt: '2026-10-05T01:00:00Z',
      updatedBy: null, updatedAt: null, authorName: 'Linh', updatedByName: null,
    })
    api.listNotes.mockResolvedValue([spoolNote('n1', 's5'), spoolNote('n2', 's5'), spoolNote('n3', 's3')])
    await pick(/Import Plan/, 'plan.xlsx')
    const box = await dialog()
    const sp5 = (await within(box).findByText('SP-5')).closest('tr') as HTMLElement
    expect(within(sp5).getByText('có ghi chú')).toBeInTheDocument()
    expect(within(box).getByText('2 ghi chú sẽ bị xoá cùng spool: SP-5.')).toBeInTheDocument()
    const confirm = within(box).getByRole('button', { name: /Thay thế Plan/ })
    expect(confirm).toHaveClass('ant-btn-dangerous')

    const readsBefore = api.listNotes.mock.calls.length
    await userEvent.click(confirm)
    await userEvent.type(await screen.findByLabelText('Gõ XOÁ để xác nhận'), 'XOÁ')
    const typed = screen.getAllByRole('dialog').at(-1) as HTMLElement
    await userEvent.click(within(typed).getByRole('button', { name: /Thay thế Plan/ }))
    await waitFor(() => expect(api.replaceSpools).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(api.listNotes.mock.calls.length).toBeGreaterThan(readsBefore))
  })

  it('lists the row errors and writes nothing', async () => {
    read.mockResolvedValue(sheet([PLAN_HEADER, planRow('SP-1', '31/02/2026'), planRow('', '2026-10-01')]))
    renderPanel()
    await ready()
    await pick(/Import Plan/, 'bad.xlsx')
    const box = await dialog()
    expect(within(box).getByText('Không import được bad.xlsx')).toBeInTheDocument()
    expect(within(box).getByText('2 lỗi · chưa có dòng nào được import')).toBeInTheDocument()
    expect(within(box).queryByRole('button', { name: /Thay thế Plan/ })).toBeNull()
    expect(api.replaceSpools).not.toHaveBeenCalled()
  })
})

describe('Insulation: Cập nhật Actual (spec §6.3, Q18A)', () => {
  /** Opens the entry for LineNo L1 at Painting Handover, today, and runs the dry run. */
  async function previewLineL1() {
    await userEvent.click(screen.getByRole('button', { name: 'Cập nhật Actual' }))
    const box = await dialog()
    await chooseOption('Áp dụng cho', 'LineNo', box)
    await chooseOption('LineNo', 'L1', box)
    expect(within(box).getByRole('textbox', { name: 'Ngày' })).toHaveValue('07/10/2026')
    await userEvent.click(within(box).getByRole('button', { name: 'Xem trước' }))
    return box
  }
  const DRY_RUN = [
    { spoolId: 's1', spoolNo: 'SP-1', status: 'saved' },
    { spoolId: 's2', spoolNo: 'SP-2', status: 'overwrite_needed' },
    { spoolId: 's3', spoolNo: 'SP-3', status: 'order' },
    { spoolId: 's4', spoolNo: 'SP-4', status: 'unchanged' },
  ]
  const L1_CHANGES = ['s1', 's2', 's3', 's4'].map((spoolId) => ({ spoolId, milestone: 'ph', date: TODAY }))

  it('previews from the dry run: saved, overwritten old -> new, skipped with the reason, unchanged', async () => {
    api.setSpoolActuals.mockResolvedValueOnce(DRY_RUN)
    renderPanel(asGs)
    await ready()
    const box = await previewLineL1()
    await waitFor(() => expect(api.setSpoolActuals).toHaveBeenCalledWith('p1', L1_CHANGES, { dryRun: true }))
    expect(await within(box).findByText('LineNo L1 · Painting Handover · 07/10/2026 · 4 spool')).toBeInTheDocument()
    expect(facts(box)).toEqual(['1 spool lưu', '1 spool ghi đè', '1 spool bỏ qua', '1 spool không đổi'])
    const skipped = within(box).getByRole('region', { name: 'Spool bỏ qua' })
    expect(within(skipped).getByText('SP-3')).toBeInTheDocument()
    expect(within(skipped).getByText(
      'Sai thứ tự: Painting Handover (07/10/2026) sau Insulation Handover (03/10/2026)',
    )).toBeInTheDocument()
    const over = within(box).getByRole('region', { name: 'Ngày Actual bị ghi đè' })
    const row = within(over).getByText('SP-2').closest('tr') as HTMLElement
    expect(within(row).getByText('02/10/2026')).toBeInTheDocument()
    expect(within(row).getByText('07/10/2026')).toBeInTheDocument()
    expect(within(over).getByRole('checkbox', { name: 'Ghi đè ngày Actual của 1 spool' })).not.toBeChecked()
  })

  it('saves only the saved spools when the overwrite is not ticked, skipping the order breakers', async () => {
    api.setSpoolActuals.mockResolvedValueOnce(DRY_RUN).mockResolvedValueOnce([{ spoolId: 's1', spoolNo: 'SP-1', status: 'saved' }])
    renderPanel(asGs)
    await ready()
    const box = await previewLineL1()
    await waitFor(() => expect(facts(box)[0]).toBe('1 spool lưu'))
    api.listSpools.mockClear()
    await userEvent.click(within(box).getByRole('button', { name: 'Lưu' }))
    await waitFor(() => expect(api.setSpoolActuals).toHaveBeenCalledTimes(2))
    expect(api.setSpoolActuals).toHaveBeenLastCalledWith('p1', [L1_CHANGES[0]], { overwrite: false })
    expect(await screen.findByText('Đã lưu Actual cho 1 spool')).toBeInTheDocument()
    await waitFor(() => expect(api.listSpools).toHaveBeenCalledWith('p1'))
  })

  it('overwrites the stored dates only once the box is ticked, apart from the plain saves', async () => {
    api.setSpoolActuals.mockResolvedValueOnce(DRY_RUN)
      .mockResolvedValueOnce([{ spoolId: 's1', spoolNo: 'SP-1', status: 'saved' }])
      .mockResolvedValueOnce([{ spoolId: 's2', spoolNo: 'SP-2', status: 'saved' }])
    renderPanel()
    await ready()
    const box = await previewLineL1()
    await userEvent.click(await within(box).findByRole('checkbox', { name: 'Ghi đè ngày Actual của 1 spool' }))
    await userEvent.click(within(box).getByRole('button', { name: 'Lưu' }))
    // A spool the dry run saw blank is never written with the overwrite flag:
    // a date set there since the preview is not replaced unseen.
    await waitFor(() => expect(api.setSpoolActuals).toHaveBeenCalledTimes(3))
    expect(api.setSpoolActuals).toHaveBeenNthCalledWith(2, 'p1', [L1_CHANGES[0]], { overwrite: false })
    expect(api.setSpoolActuals).toHaveBeenNthCalledWith(3, 'p1', [L1_CHANGES[1]], { overwrite: true })
    expect(await screen.findByText('Đã lưu Actual cho 2 spool')).toBeInTheDocument()
  })

  it('reads the spools afresh before the dry run, so the old dates shown are the stored ones', async () => {
    api.setSpoolActuals.mockResolvedValueOnce(DRY_RUN)
    renderPanel(asGs)
    await ready()
    // SP-2's PH was changed since the page opened.
    api.listSpools.mockClear()
    api.listSpools.mockResolvedValue(SPOOLS.map((s) => (s.id === 's2' ? { ...s, phActual: '2026-10-04' } : s)))
    const box = await previewLineL1()
    const over = await within(box).findByRole('region', { name: 'Ngày Actual bị ghi đè' })
    const row = within(over).getByText('SP-2').closest('tr') as HTMLElement
    expect(within(row).getByText('04/10/2026')).toBeInTheDocument()
    expect(api.listSpools).toHaveBeenCalledWith('p1')
    expect(api.listSpools.mock.invocationCallOrder[0]).toBeLessThan(api.setSpoolActuals.mock.invocationCallOrder[0])
  })

  it('warns of the spools the write did not save after all (changed since the preview)', async () => {
    api.setSpoolActuals.mockResolvedValueOnce(DRY_RUN).mockResolvedValueOnce([
      { spoolId: 's1', spoolNo: 'SP-1', status: 'overwrite_needed' },
    ])
    renderPanel(asGs)
    await ready()
    const box = await previewLineL1()
    await waitFor(() => expect(facts(box)[0]).toBe('1 spool lưu'))
    await userEvent.click(within(box).getByRole('button', { name: 'Lưu' }))
    expect(await screen.findByText('1 spool không được lưu vì dữ liệu vừa thay đổi')).toBeInTheDocument()
  })

  it('keeps a refused write inside the dialog and reads nothing again', async () => {
    api.setSpoolActuals.mockResolvedValueOnce(DRY_RUN).mockRejectedValueOnce(new Error('Không có quyền'))
    renderPanel(asGs)
    await ready()
    const box = await previewLineL1()
    await waitFor(() => expect(facts(box)[0]).toBe('1 spool lưu'))
    api.listSpools.mockClear()
    await userEvent.click(within(box).getByRole('button', { name: 'Lưu' }))
    expect(await within(box).findByText('Không có quyền')).toBeInTheDocument()
    // Still on the preview, Lưu there to retry (jsdom keeps the spinner's leave motion in its name).
    expect(within(box).getByRole('button', { name: /Lưu/ })).toBeEnabled()
    expect(api.listSpools).not.toHaveBeenCalled()
  })

  it('applies one SpoolNo to every spool carrying it (R-11)', async () => {
    api.setSpoolActuals.mockResolvedValueOnce([
      { spoolId: 's1', spoolNo: 'SP-1', status: 'saved' }, { spoolId: 's6', spoolNo: 'SP-1', status: 'saved' },
    ])
    renderPanel(asGs)
    await ready()
    await userEvent.click(screen.getByRole('button', { name: 'Cập nhật Actual' }))
    const box = await dialog()
    await chooseOption('SpoolNo', 'SP-1', box)
    await chooseOption('Mốc', 'Insulation Work', box)
    await userEvent.click(within(box).getByRole('button', { name: 'Xem trước' }))
    await waitFor(() => expect(api.setSpoolActuals).toHaveBeenCalledWith('p1', [
      { spoolId: 's1', milestone: 'iw', date: TODAY }, { spoolId: 's6', milestone: 'iw', date: TODAY },
    ], { dryRun: true }))
    await waitFor(() => expect(facts(box)[0]).toBe('2 spool lưu'))
  })

  it('keeps Lưu off when nothing would be saved', async () => {
    api.setSpoolActuals.mockResolvedValueOnce([
      { spoolId: 's1', spoolNo: 'SP-1', status: 'order' }, { spoolId: 's2', spoolNo: 'SP-2', status: 'unchanged' },
      { spoolId: 's3', spoolNo: 'SP-3', status: 'order' }, { spoolId: 's4', spoolNo: 'SP-4', status: 'unchanged' },
    ])
    renderPanel(asGs)
    await ready()
    const box = await previewLineL1()
    await waitFor(() => expect(facts(box)[0]).toBe('0 spool lưu'))
    expect(within(box).getByRole('button', { name: 'Lưu' })).toBeDisabled()
  })

  it('runs the dry run and the write once however fast the buttons are hit', async () => {
    let finishDry: (v: unknown) => void = () => {}
    let finishSave: (v: unknown) => void = () => {}
    api.setSpoolActuals
      .mockImplementationOnce(() => new Promise((resolve) => { finishDry = resolve }))
      .mockImplementationOnce(() => new Promise((resolve) => { finishSave = resolve }))
    renderPanel(asGs)
    await ready()
    await userEvent.click(screen.getByRole('button', { name: 'Cập nhật Actual' }))
    const box = await dialog()
    await chooseOption('Áp dụng cho', 'LineNo', box)
    await chooseOption('LineNo', 'L1', box)
    const previewButton = within(box).getByRole('button', { name: 'Xem trước' })
    previewButton.click()
    previewButton.click()
    await waitFor(() => expect(api.setSpoolActuals).toHaveBeenCalledTimes(1))
    finishDry(DRY_RUN)
    const save = await within(box).findByRole('button', { name: 'Lưu' })
    save.click()
    save.click()
    expect(api.setSpoolActuals).toHaveBeenCalledTimes(2)
    finishSave([{ spoolId: 's1', spoolNo: 'SP-1', status: 'saved' }])
    expect(await screen.findByText('Đã lưu Actual cho 1 spool')).toBeInTheDocument()
    expect(api.setSpoolActuals).toHaveBeenCalledTimes(2)
  })

  it('offers no day after today', async () => {
    renderPanel(asGs)
    await ready()
    await userEvent.click(screen.getByRole('button', { name: 'Cập nhật Actual' }))
    const box = await dialog()
    await userEvent.click(within(box).getByRole('textbox', { name: 'Ngày' }))
    const tomorrow = await waitFor(() => {
      const cell = document.querySelector('td[title="2026-10-08"]')
      if (!cell) throw new Error('no picker cell')
      return cell
    })
    expect(tomorrow).toHaveClass('ant-picker-cell-disabled')
  })
})

describe('Insulation: Import Actual (spec §6.3, §8, R-11)', () => {
  const ACTUAL_HEADER = ['SpoolNo', 'Painting Handover – Actual', 'Insulation Handover – Actual', 'Insulation Work – Actual']

  it('lists the row errors (unknown SpoolNo, a day after today) and writes nothing', async () => {
    read.mockResolvedValue([{ name: 'Insulation Actual', rows: [
      ACTUAL_HEADER, ['SP-404', '2026-10-01', null, null], ['SP-5', '2026-10-09', null, null],
    ] }])
    renderPanel(asGs)
    await ready()
    await pick(/Import Actual/, 'actual.xlsx')
    const box = await dialog()
    expect(within(box).getByText('Không import được actual.xlsx')).toBeInTheDocument()
    expect(within(box).getByText('Không tìm thấy SpoolNo "SP-404"')).toBeInTheDocument()
    expect(within(box).getByText(/ngày 09\/10\/2026 sau hôm nay/)).toBeInTheDocument()
    expect(api.setSpoolActuals).not.toHaveBeenCalled()
  })

  it('refuses the file when the dry run finds an order break the screen did not see', async () => {
    read.mockResolvedValue([{ name: 'Insulation Actual', rows: [ACTUAL_HEADER, ['SP-5', '2026-10-01', null, null]] }])
    api.setSpoolActuals.mockResolvedValueOnce([{ spoolId: 's5', spoolNo: 'SP-5', status: 'order' }])
    renderPanel(asGs)
    await ready()
    await pick(/Import Actual/, 'actual.xlsx')
    const box = await dialog()
    expect(within(box).getByText('Không import được actual.xlsx')).toBeInTheDocument()
    expect(within(box).getByText(/SpoolNo "SP-5": Sai thứ tự/)).toBeInTheDocument()
    expect(api.setSpoolActuals).toHaveBeenCalledTimes(1)
  })

  it('previews a SpoolNo matching two spools as applied to both, overwrites after the tick, imports once', async () => {
    read.mockResolvedValue([{ name: 'Insulation Actual', rows: [
      ACTUAL_HEADER, ['SP-1', '2026-10-05', null, null], ['SP-2', '2026-10-06', null, null],
    ] }])
    const changes = [
      { spoolId: 's1', milestone: 'ph', date: '2026-10-05' },
      { spoolId: 's6', milestone: 'ph', date: '2026-10-05' },
      { spoolId: 's2', milestone: 'ph', date: '2026-10-06' },
    ]
    let finish: (v: unknown) => void = () => {}
    api.setSpoolActuals
      .mockResolvedValueOnce([
        { spoolId: 's1', spoolNo: 'SP-1', status: 'saved' }, { spoolId: 's2', spoolNo: 'SP-2', status: 'overwrite_needed' },
        { spoolId: 's6', spoolNo: 'SP-1', status: 'saved' },
      ])
      .mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    renderPanel(asGs)
    await ready()
    await pick(/Import Actual/, 'actual.xlsx')
    const box = await dialog()
    await waitFor(() => expect(api.setSpoolActuals).toHaveBeenCalledWith('p1', changes, {
      importFile: 'actual.xlsx', dryRun: true, fileRows: 2,
    }))
    expect(within(box).getByText('Xem trước Insulation Actual')).toBeInTheDocument()
    expect(within(box).getByText('Dòng 2: SpoolNo "SP-1" khớp 2 spool, áp dụng cho tất cả')).toBeInTheDocument()
    expect(facts(box)).toEqual(['2 spool lưu', '1 spool ghi đè', '0 spool bỏ qua', '0 spool không đổi'])
    const confirm = within(box).getByRole('button', { name: /Import Actual/ })
    expect(confirm).toBeDisabled()
    await userEvent.click(within(box).getByRole('checkbox', { name: 'Ghi đè ngày Actual của 1 spool' }))
    expect(confirm).toBeEnabled()
    confirm.click()
    confirm.click()
    expect(api.setSpoolActuals).toHaveBeenCalledTimes(2)
    expect(api.setSpoolActuals).toHaveBeenLastCalledWith('p1', changes, {
      importFile: 'actual.xlsx', fileRows: 2, overwrite: true,
    })
    finish([
      { spoolId: 's1', spoolNo: 'SP-1', status: 'saved' }, { spoolId: 's2', spoolNo: 'SP-2', status: 'saved' },
      { spoolId: 's6', spoolNo: 'SP-1', status: 'saved' },
    ])
    expect(await screen.findByText('Đã import Insulation Actual cho 3 spool')).toBeInTheDocument()
    expect(api.setSpoolActuals).toHaveBeenCalledTimes(2)
  })

  it('imports without the overwrite flag when no stored date is replaced, and reads the page again', async () => {
    read.mockResolvedValue([{ name: 'Insulation Actual', rows: [ACTUAL_HEADER, ['SP-5', '2026-10-01', null, null]] }])
    const change = [{ spoolId: 's5', milestone: 'ph', date: '2026-10-01' }]
    api.setSpoolActuals.mockResolvedValueOnce([{ spoolId: 's5', spoolNo: 'SP-5', status: 'saved' }])
      .mockResolvedValueOnce([{ spoolId: 's5', spoolNo: 'SP-5', status: 'saved' }])
    renderPanel(asGs)
    await ready()
    await pick(/Import Actual/, 'actual.xlsx')
    const box = await dialog()
    await waitFor(() => expect(facts(box)[0]).toBe('1 spool lưu'))
    expect(within(box).queryByRole('checkbox')).toBeNull()
    api.listSpools.mockClear()
    await userEvent.click(within(box).getByRole('button', { name: /Import Actual/ }))
    await waitFor(() => expect(api.setSpoolActuals).toHaveBeenLastCalledWith('p1', change, {
      importFile: 'actual.xlsx', fileRows: 1, overwrite: false,
    }))
    expect(await screen.findByText('Đã import Insulation Actual cho 1 spool')).toBeInTheDocument()
    await waitFor(() => expect(api.listSpools).toHaveBeenCalledWith('p1'))
  })

  it('offers no import when every date in the file is already stored', async () => {
    read.mockResolvedValue([{ name: 'Insulation Actual', rows: [ACTUAL_HEADER, ['SP-2', '2026-10-02', null, null]] }])
    renderPanel(asGs)
    await ready()
    await pick(/Import Actual/, 'actual.xlsx')
    const box = await dialog()
    expect(within(box).getByText('File không thay đổi ngày Actual nào.')).toBeInTheDocument()
    expect(facts(box)).toEqual(['0 spool lưu', '0 spool ghi đè', '0 spool bỏ qua', '1 spool không đổi'])
    expect(within(box).getByRole('button', { name: /Import Actual/ })).toBeDisabled()
    expect(api.setSpoolActuals).not.toHaveBeenCalled()
  })

  it('keeps a refused import inside the dialog and reads nothing again', async () => {
    read.mockResolvedValue([{ name: 'Insulation Actual', rows: [ACTUAL_HEADER, ['SP-5', '2026-10-01', null, null]] }])
    api.setSpoolActuals.mockResolvedValueOnce([{ spoolId: 's5', spoolNo: 'SP-5', status: 'saved' }])
      .mockRejectedValueOnce(new Error('Spool SP-5: Sai thứ tự. Không có dữ liệu nào được ghi.'))
    renderPanel(asGs)
    await ready()
    await pick(/Import Actual/, 'actual.xlsx')
    const box = await dialog()
    await waitFor(() => expect(facts(box)[0]).toBe('1 spool lưu'))
    api.listSpools.mockClear()
    await userEvent.click(within(box).getByRole('button', { name: /Import Actual/ }))
    expect(await within(box).findByText('Spool SP-5: Sai thứ tự. Không có dữ liệu nào được ghi.')).toBeInTheDocument()
    expect(within(box).getByRole('button', { name: /Import Actual/ })).toBeEnabled()
    expect(api.listSpools).not.toHaveBeenCalled()
  })

  it('reads the spools afresh for the file: a spool added since the page opened is found', async () => {
    read.mockResolvedValue([{ name: 'Insulation Actual', rows: [ACTUAL_HEADER, ['SP-8', '2026-10-01', null, null]] }])
    api.setSpoolActuals.mockResolvedValueOnce([{ spoolId: 's8', spoolNo: 'SP-8', status: 'saved' }])
    renderPanel(asGs)
    await ready()
    api.listSpools.mockResolvedValue([...SPOOLS, spool(8)])
    await pick(/Import Actual/, 'actual.xlsx')
    const box = await dialog()
    expect(within(box).getByText('Xem trước Insulation Actual')).toBeInTheDocument()
    await waitFor(() => expect(api.setSpoolActuals).toHaveBeenCalledWith('p1', [
      { spoolId: 's8', milestone: 'ph', date: '2026-10-01' },
    ], { importFile: 'actual.xlsx', dryRun: true, fileRows: 1 }))
  })

  it('lists 200 notes at most, then says how many more', async () => {
    // 201 SpoolNos, each carried by two spools: one R-11 note per row.
    const pairs = Array.from({ length: 201 }, (_, i) => [
      spool(100 + 2 * i, { spoolNo: `P-${i}` }), spool(101 + 2 * i, { spoolNo: `P-${i}` }),
    ]).flat()
    read.mockResolvedValue([{ name: 'Insulation Actual', rows: [
      ACTUAL_HEADER, ...Array.from({ length: 201 }, (_, i) => [`P-${i}`, '2026-10-01', null, null]),
    ] }])
    api.setSpoolActuals.mockResolvedValueOnce(pairs.map((p) => ({ spoolId: p.id, spoolNo: p.spoolNo, status: 'saved' })))
    renderPanel(asGs)
    await ready()
    api.listSpools.mockResolvedValue(pairs)
    await pick(/Import Actual/, 'actual.xlsx')
    const box = await dialog()
    expect(await within(box).findByText('và 1 cảnh báo khác')).toBeInTheDocument()
    expect(within(box).getAllByText(/khớp 2 spool, áp dụng cho tất cả/)).toHaveLength(200)
  })

  it('downloads the Actual template', async () => {
    renderPanel(asGs)
    await ready()
    await userEvent.click(screen.getByRole('button', { name: 'Tải file mẫu Actual' }))
    await waitFor(() => expect(download).toHaveBeenCalledWith(expect.any(Blob), 'spool_actual.xlsx'))
  })
})

describe('Insulation: Xoá Actual (spec §6.3, R-12)', () => {
  it('clears the chosen milestone after the confirmation, once', async () => {
    api.listSpools.mockResolvedValue([spool(1, { phActual: '2026-10-02', ihActual: '2026-10-04' })])
    let finish: (v: unknown) => void = () => {}
    api.setSpoolActuals.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    renderPanel()
    await ready()
    await chooseOption('Cấp hiển thị', 'Spool')
    await userEvent.click(screen.getByRole('button', { name: 'Xoá Actual' }))
    const box = await dialog()
    expect(within(box).getByText('Xoá ngày Actual của SP-1?')).toBeInTheDocument()
    await chooseOption('Mốc', 'Insulation Handover', box)
    expect(within(box).getByText('04/10/2026')).toBeInTheDocument()
    const ok = within(box).getByRole('button', { name: /Xoá/ })
    ok.click()
    ok.click()
    expect(api.setSpoolActuals).toHaveBeenCalledTimes(1)
    expect(api.setSpoolActuals).toHaveBeenCalledWith('p1', [{ spoolId: 's1', milestone: 'ih', date: null }])
    api.listSpools.mockClear()
    finish([{ spoolId: 's1', spoolNo: 'SP-1', status: 'saved' }])
    expect(await screen.findByText('Đã xoá Insulation Handover – Actual của SP-1')).toBeInTheDocument()
    await waitFor(() => expect(api.listSpools).toHaveBeenCalledWith('p1'))
  })

  it('has nothing to clear on a spool without actuals', async () => {
    api.listSpools.mockResolvedValue([spool(1)])
    renderPanel()
    await ready()
    await chooseOption('Cấp hiển thị', 'Spool')
    expect(screen.getByRole('button', { name: 'Xoá Actual' })).toBeDisabled()
  })
})
