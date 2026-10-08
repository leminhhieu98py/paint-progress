import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CellValue } from '../../domain/piping/imports'
import type { ManpowerGroup, ManpowerValue, PipingSettings } from '../../domain/piping/types'
import type { ManpowerActualEntry } from '../../lib/pipingApi'
import { expectHelperText, expectNoSpecIds, keyFactTexts, ruleTexts } from '../../test/copy'
import { renderApp } from '../../test/renderApp'
import { setViewport } from '../../test/viewport'
import { ManpowerPanel } from './ManpowerPanel'
import type { PipingPanelProps } from './panelProps'

const api = vi.hoisted(() => ({
  listManpowerGroups: vi.fn(),
  listManpowerPlan: vi.fn(),
  replaceManpowerPlan: vi.fn(),
  listManpowerActual: vi.fn(),
  setManpowerActual: vi.fn(),
  listNotes: vi.fn(),
}))
vi.mock('../../lib/pipingApi', () => ({
  listManpowerGroups: (...a: unknown[]) => api.listManpowerGroups(...a),
  listManpowerPlan: (...a: unknown[]) => api.listManpowerPlan(...a),
  replaceManpowerPlan: (...a: unknown[]) => api.replaceManpowerPlan(...a),
  listManpowerActual: (...a: unknown[]) => api.listManpowerActual(...a),
  setManpowerActual: (...a: unknown[]) => api.setManpowerActual(...a),
  listNotes: (...a: unknown[]) => api.listNotes(...a),
}))

/** The file reader stands in: a test hands over the sheets a workbook would read as. */
const xlsx = vi.hoisted(() => ({ read: vi.fn() }))
vi.mock('../../lib/piping/xlsx', () => ({
  readWorkbookRows: (file: unknown) => xlsx.read(file),
}))
const templates = vi.hoisted(() => ({ build: vi.fn() }))
vi.mock('../../lib/piping/templates', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/piping/templates')>()),
  buildManpowerPlanTemplate: (names: string[]) => templates.build(names),
}))
const download = vi.hoisted(() => vi.fn())
vi.mock('../../lib/projectReport', () => ({
  downloadWorkbook: (...a: unknown[]) => download(...a),
}))

// jsdom gives Recharts no size; the stand-in prints what reaches the chart.
vi.mock('./manpower/ManpowerChart', () => ({
  ManpowerChart: ({ data, groups, mode }: {
    data: Array<Record<string, unknown>>
    groups: Array<{ name: string }>
    mode: string
  }) => (
    <div data-testid="manpower-chart" data-mode={mode} data-groups={groups.map((g) => g.name).join(',')}>
      {data.map((p) => `${String(p.key)}:${String(p.planTotal)}/${String(p.actualTotal)}`).join(' ')}
    </div>
  ),
}))

const SETTINGS: PipingSettings = {
  projectId: 'p1', enabled: true, weekStartDate: '2026-09-28', totalTestPacks: 1022, lateThresholdDays: 7,
}

const GROUPS: ManpowerGroup[] = [
  { id: 'g2', name: 'Insulation', sort: 2, hidden: false },
  { id: 'g1', name: 'Reinstatement', sort: 1, hidden: false },
  { id: 'g3', name: 'Marking', sort: 3, hidden: true },
]

const PLAN: ManpowerValue[] = [
  { groupId: 'g1', day: '2026-10-01', value: 10 },
  { groupId: 'g2', day: '2026-10-01', value: 4 },
  { groupId: 'g1', day: '2026-10-02', value: 12 },
  { groupId: 'g3', day: '2026-10-02', value: 2 },
]

const cell = (over: Partial<ManpowerActualEntry>): ManpowerActualEntry => ({
  groupId: 'g1', day: '2026-10-01', value: 1, createdBy: 'u2', createdAt: '2026-10-01T03:00:00Z', editedBy: null,
  editedAt: null, createdByName: 'Trần Văn GS', editedByName: null, ...over,
})

const ACTUAL: ManpowerActualEntry[] = [
  cell({ groupId: 'g1', day: '2026-10-01', value: 8 }),
  cell({ groupId: 'g3', day: '2026-10-02', value: 3 }),
  cell({ groupId: 'g2', day: '2026-10-03', value: 0, createdAt: '2026-10-03T04:00:00Z' }),
  cell({
    groupId: 'g1', day: '2026-10-03', value: 6, createdAt: '2026-10-03T04:00:00Z',
    editedBy: 'u1', editedAt: '2026-10-04T02:30:00Z', editedByName: 'Đoàn Linh',
  }),
]

const props = (over: Partial<PipingPanelProps> = {}): PipingPanelProps => ({
  projectId: 'p1', settings: SETTINGS, mode: 'day', variant: 'admin', role: 'admin', todayKey: '2026-10-07',
  refreshKey: 0, ...over,
})

const renderPanel = (over: Partial<PipingPanelProps> = {}) => renderApp(<ManpowerPanel {...props(over)} />)

const asGs = { variant: 'gs', role: 'gs' } as const
const asViewer = { variant: 'gs', role: 'viewer' } as const

const AVERAGE_INFO = 'Mỗi nhóm lấy trung bình các ngày có số liệu đến hôm nay, rồi cộng các nhóm'

const loaded = () => screen.findByTestId('manpower-chart')
const dialog = () => screen.getByRole('dialog')
const dateInput = () => screen.getByLabelText('Ngày')
const groupInput = (name: string) => screen.getByRole('spinbutton', { name })
const saveButton = () => screen.getByRole('button', { name: 'Lưu nhân lực' })
const historyTable = () => within(screen.getByTestId('manpower-history')).getByRole('table')
const historyRows = () => within(historyTable()).getAllByRole('row').slice(1)

const pickDay = async (text: string) => {
  await userEvent.clear(dateInput())
  await userEvent.type(dateInput(), `${text}{Enter}`)
}

const sheet = (rows: CellValue[][]) => [{ name: 'Sheet1', rows }]
const upload = async () => {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement
  await userEvent.upload(input, new File(['x'], 'plan.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  }))
}

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset()
  api.listManpowerGroups.mockResolvedValue(GROUPS)
  api.listManpowerPlan.mockResolvedValue(PLAN)
  api.listManpowerActual.mockResolvedValue(ACTUAL)
  api.setManpowerActual.mockResolvedValue(1)
  api.listNotes.mockResolvedValue([])
  api.replaceManpowerPlan.mockResolvedValue({ logId: 'l1', summary: {} })
  xlsx.read.mockReset()
  templates.build.mockReset()
  templates.build.mockResolvedValue(new Blob(['t']))
  download.mockReset()
})

describe('ManpowerPanel: summary and chart (spec §3, §5)', () => {
  it('reads the groups, plan and actual, and states the averages up to today in vi-VN', async () => {
    renderPanel()
    await loaded()
    expect(api.listManpowerGroups).toHaveBeenCalledWith('p1')
    expect(api.listManpowerPlan).toHaveBeenCalledWith('p1')
    expect(api.listManpowerActual).toHaveBeenCalledWith('p1')
    expect(screen.getByRole('heading', { level: 2, name: 'Manpower' })).toBeInTheDocument()
    // Per group, the mean of its days with a value, summed: Plan (10 + 12) / 2 + 4 + 2; Actual (8 + 6) / 2 + 0 + 3.
    expect(keyFactTexts()[0]).toBe('trung bình đến hôm nay Plan 17 · Actual 10')
    expect(screen.getByLabelText(AVERAGE_INFO)).toBeInTheDocument()
  })

  it('states the same averages as the week chart, a plan day after today left out', async () => {
    api.listManpowerPlan.mockResolvedValue([...PLAN, { groupId: 'g1', day: '2026-10-09', value: 50 }])
    renderPanel({ mode: 'week' })
    const chart = await loaded()
    // Every value up to today falls in the week of 28/09: the pill reads that bucket.
    expect(chart.textContent).toBe('2026-09-28:17/10 2026-10-05:50/null')
    expect(keyFactTexts()[0]).toBe('trung bình đến hôm nay Plan 17 · Actual 10')
  })

  it('says trung bình in the card title in week view only', async () => {
    const { rerender } = renderPanel({ mode: 'week' })
    await loaded()
    expect(screen.getByRole('heading', { level: 2, name: 'Manpower (trung bình tuần)' })).toBeInTheDocument()
    rerender(<ManpowerPanel {...props({ mode: 'day' })} />)
    expect(await screen.findByRole('heading', { level: 2, name: 'Manpower' })).toBeInTheDocument()
  })

  it('charts each day with the totals, a hidden group with history included (R-8)', async () => {
    renderPanel()
    const chart = await loaded()
    expect(chart).toHaveAttribute('data-mode', 'day')
    expect(chart).toHaveAttribute('data-groups', 'Reinstatement,Insulation,Marking')
    const points = (chart.textContent ?? '').split(' ')
    expect(points[0]).toBe('2026-10-01:14/8')
    expect(points[1]).toBe('2026-10-02:14/3')
    expect(points[2]).toBe('2026-10-03:null/6')
    expect(points.at(-1)).toBe('2026-10-07:null/null')
  })

  it('averages the days that have a value in week view (R-2)', async () => {
    renderPanel({ mode: 'week' })
    const chart = await loaded()
    expect(chart).toHaveAttribute('data-mode', 'week')
    // Plan: Reinstatement (10 + 12) / 2 + Insulation 4 + Marking 2; Actual: (8 + 6) / 2 + 0 + 3.
    expect(chart.textContent).toBe('2026-09-28:17/10 2026-10-05:null/null')
  })

  it('leaves a hidden group without data out of the chart', async () => {
    api.listManpowerPlan.mockResolvedValue(PLAN.filter((v) => v.groupId !== 'g3'))
    api.listManpowerActual.mockResolvedValue(ACTUAL.filter((v) => v.groupId !== 'g3'))
    renderPanel()
    expect(await loaded()).toHaveAttribute('data-groups', 'Reinstatement,Insulation')
  })

  it('shows an empty state with neither plan nor actual', async () => {
    api.listManpowerPlan.mockResolvedValue([])
    api.listManpowerActual.mockResolvedValue([])
    renderPanel()
    expect(await screen.findByText('Chưa có Plan hoặc nhân lực Manpower')).toBeInTheDocument()
    expect(screen.queryByTestId('manpower-chart')).toBeNull()
    expect(keyFactTexts()[0]).toBe('trung bình đến hôm nay Plan - · Actual -')
  })

  it('says a failed read and retries it', async () => {
    api.listManpowerActual.mockRejectedValueOnce(new Error('Mất kết nối'))
    renderPanel()
    expect(await screen.findByText('Không tải được Manpower')).toBeInTheDocument()
    expect(screen.getByText('Mất kết nối')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Thử lại' }))
    await loaded()
  })

  it('reads again when Cấu hình changed something', async () => {
    const { rerender } = renderPanel()
    await loaded()
    rerender(<ManpowerPanel {...props({ refreshKey: 1 })} />)
    await waitFor(() => expect(api.listManpowerGroups).toHaveBeenCalledTimes(2))
  })
})

describe('ManpowerPanel: entry (spec §5, R-7, R-8)', () => {
  it('offers a foreman today with one empty input per visible group, a hidden group left out', async () => {
    renderPanel(asGs)
    await loaded()
    expect(dateInput()).toHaveValue('07/10/2026')
    expect(groupInput('Reinstatement')).toHaveValue('')
    expect(groupInput('Insulation')).toHaveValue('')
    expect(screen.queryByRole('spinbutton', { name: /Marking/ })).toBeNull()
    expect(saveButton()).toBeDisabled()
  })

  it('shows a foreman the values a day has, read-only, and says why', async () => {
    renderPanel(asGs)
    await loaded()
    await pickDay('03/10/2026')
    expect(groupInput('Reinstatement')).toHaveValue('6')
    expect(groupInput('Reinstatement')).toBeDisabled()
    expect(groupInput('Insulation')).toHaveValue('0')
    expect(groupInput('Insulation')).toBeDisabled()
    expect(screen.getByLabelText('Ô đã có giá trị chỉ admin sửa được')).toBeInTheDocument()
    expect(saveButton()).toBeDisabled()
  })

  it('lets a foreman fill only the empty cells, sending nothing else', async () => {
    renderPanel(asGs)
    await loaded()
    await pickDay('01/10/2026')
    expect(groupInput('Reinstatement')).toBeDisabled()
    await userEvent.type(groupInput('Insulation'), '2,5')
    await userEvent.click(saveButton())
    await waitFor(() => expect(api.setManpowerActual).toHaveBeenCalledWith('p1', '2026-10-01', [{ groupId: 'g2', value: 2.5 }]))
    await waitFor(() => expect(api.listManpowerActual).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('Đã lưu nhân lực ngày 01/10/2026')).toBeInTheDocument()
  })

  it('lets the admin overwrite and clear any cell, a cleared one deleted', async () => {
    renderPanel()
    await loaded()
    await pickDay('03/10/2026')
    expect(groupInput('Reinstatement')).toBeEnabled()
    expect(screen.queryByLabelText('Ô đã có giá trị chỉ admin sửa được')).toBeNull()
    await userEvent.clear(groupInput('Reinstatement'))
    await userEvent.type(groupInput('Reinstatement'), '7')
    await userEvent.clear(groupInput('Insulation'))
    await userEvent.click(saveButton())
    // A cleared cell is a delete: confirmed first, the cell and its old value listed.
    expect(within(dialog()).getByText('Xoá 1 ô nhân lực ngày 03/10/2026?')).toBeInTheDocument()
    expect(within(dialog()).getByText('Insulation')).toBeInTheDocument()
    expect(api.setManpowerActual).not.toHaveBeenCalled()
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Lưu' }))
    await waitFor(() => expect(api.setManpowerActual).toHaveBeenCalledWith('p1', '2026-10-03', [
      { groupId: 'g1', value: 7 },
      { groupId: 'g2', value: null },
    ]))
  })

  it('saves an admin overwrite without a confirmation, and sends nothing for an unchanged value', async () => {
    renderPanel()
    await loaded()
    await pickDay('03/10/2026')
    await userEvent.clear(groupInput('Reinstatement'))
    await userEvent.type(groupInput('Reinstatement'), '6')
    expect(saveButton()).toBeDisabled()
    await userEvent.clear(groupInput('Reinstatement'))
    await userEvent.type(groupInput('Reinstatement'), '9')
    await userEvent.click(saveButton())
    expect(screen.queryByRole('dialog')).toBeNull()
    await waitFor(() => expect(api.setManpowerActual).toHaveBeenCalledWith('p1', '2026-10-03', [{ groupId: 'g1', value: 9 }]))
  })

  it('cancels an admin clear when the confirmation is dismissed', async () => {
    renderPanel()
    await loaded()
    await pickDay('03/10/2026')
    await userEvent.clear(groupInput('Insulation'))
    await userEvent.click(saveButton())
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Huỷ' }))
    expect(api.setManpowerActual).not.toHaveBeenCalled()
    // The cleared input stays as typed, so the admin can type the value back.
    expect(groupInput('Insulation')).toHaveValue('')
  })

  it('lets the admin edit a hidden group, marked as hidden; a foreman never sees it', async () => {
    renderPanel()
    await loaded()
    await pickDay('02/10/2026')
    expect(groupInput('Marking (ẩn)')).toHaveValue('3')
    await userEvent.clear(groupInput('Marking (ẩn)'))
    await userEvent.type(groupInput('Marking (ẩn)'), '4')
    await userEvent.click(saveButton())
    await waitFor(() => expect(api.setManpowerActual).toHaveBeenCalledWith('p1', '2026-10-02', [{ groupId: 'g3', value: 4 }]))
  })

  it('never offers a day after today', async () => {
    renderPanel(asGs)
    await loaded()
    await userEvent.click(dateInput())
    expect(document.querySelector('td[title="2026-10-08"]')).toHaveClass('ant-picker-cell-disabled')
    expect(document.querySelector('td[title="2026-10-07"]')).not.toHaveClass('ant-picker-cell-disabled')
  })

  it('saves once however often the button is hit while the save runs', async () => {
    let finish: (n: number) => void = () => {}
    api.setManpowerActual.mockImplementation(() => new Promise<number>((resolve) => { finish = resolve }))
    renderPanel(asGs)
    await loaded()
    await userEvent.type(groupInput('Reinstatement'), '4{Enter}{Enter}')
    await userEvent.dblClick(screen.getByRole('button', { name: /Lưu nhân lực/ }))
    expect(api.setManpowerActual).toHaveBeenCalledTimes(1)
    finish(1)
    await waitFor(() => expect(api.listManpowerActual).toHaveBeenCalledTimes(2))
    expect(api.setManpowerActual).toHaveBeenCalledTimes(1)
  })

  it('shows the database message as is', async () => {
    api.setManpowerActual.mockRejectedValue(new Error('Nhóm "Insulation" ngày 07/10/2026 đã có giá trị (3); chỉ admin được sửa'))
    renderPanel(asGs)
    await loaded()
    await userEvent.type(groupInput('Insulation'), '1')
    await userEvent.click(saveButton())
    expect(await screen.findByText('Nhóm "Insulation" ngày 07/10/2026 đã có giá trị (3); chỉ admin được sửa')).toBeInTheDocument()
  })

  it('reads the day again after a refusal, so a cell filled meanwhile locks with its value', async () => {
    const message = 'Nhóm "Insulation" ngày 07/10/2026 đã có giá trị (3); chỉ admin được sửa'
    api.setManpowerActual.mockRejectedValue(new Error(message))
    renderPanel(asGs)
    await loaded()
    api.listManpowerActual.mockResolvedValue([...ACTUAL, cell({ groupId: 'g2', day: '2026-10-07', value: 3 })])
    await userEvent.type(groupInput('Insulation'), '1')
    await userEvent.click(saveButton())
    await waitFor(() => expect(groupInput('Insulation')).toHaveValue('3'))
    expect(groupInput('Insulation')).toBeDisabled()
    expect(screen.getByText(message)).toBeInTheDocument()
    expect(api.listManpowerActual).toHaveBeenCalledTimes(2)
  })

  it('folds its rules away as helper text, with no spec id on screen', async () => {
    renderPanel(asGs)
    await loaded()
    await userEvent.click(screen.getByRole('button', { name: /Quy tắc áp dụng/ }))
    expectHelperText(ruleTexts())
    expectNoSpecIds()
  })

  it('gives a viewer no input, no row action and no import', async () => {
    renderPanel(asViewer)
    await loaded()
    expect(screen.queryByRole('button', { name: 'Lưu nhân lực' })).toBeNull()
    expect(screen.queryByRole('spinbutton')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Sửa nhân lực' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Xoá nhân lực' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Nhập Plan/ })).toBeNull()
    expect(historyRows()).toHaveLength(3)
  })
})

describe('ManpowerPanel: actual history', () => {
  it('lists days newest first, each group, the total and who edited, a hidden group with data included', async () => {
    renderPanel(asGs)
    await loaded()
    const headers = within(historyTable()).getAllByRole('columnheader').map((h) => h.textContent)
    expect(headers.slice(0, 5)).toEqual(['Ngày', 'Reinstatement', 'Insulation', 'Marking (ẩn)', 'Tổng'])
    const rows = historyRows()
    expect(rows[0]).toHaveTextContent(/^03\/10\/202660-6/)
    expect(rows[0]).toHaveTextContent('Trần Văn GS')
    expect(rows[0]).toHaveTextContent('Đoàn Linh')
    expect(rows[0]).toHaveTextContent('09:30 04/10/2026')
    expect(rows[1]).toHaveTextContent(/^02\/10\/2026--33/)
    expect(rows[2]).toHaveTextContent(/^01\/10\/20268--8/)
    expect(screen.queryByRole('button', { name: 'Sửa nhân lực' })).toBeNull()
  })

  it('lets the admin edit a day in the entry form', async () => {
    renderPanel()
    await loaded()
    await userEvent.click(within(historyRows()[0]).getByRole('button', { name: 'Sửa nhân lực' }))
    expect(dateInput()).toHaveValue('03/10/2026')
    expect(groupInput('Reinstatement')).toHaveValue('6')
    expect(groupInput('Insulation')).toHaveValue('0')
  })

  it('lets the admin delete a day after a confirmation, a hidden group included', async () => {
    renderPanel()
    await loaded()
    await userEvent.click(within(historyRows()[1]).getByRole('button', { name: 'Xoá nhân lực' }))
    expect(within(dialog()).getByText('Xoá nhân lực ngày 02/10/2026?')).toBeInTheDocument()
    expect(api.setManpowerActual).not.toHaveBeenCalled()
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Xoá' }))
    await waitFor(() => expect(api.setManpowerActual).toHaveBeenCalledWith('p1', '2026-10-02', [{ groupId: 'g3', value: null }]))
    await waitFor(() => expect(api.listManpowerActual).toHaveBeenCalledTimes(2))
  })

  it('deletes every cell of the day, visible and hidden groups alike, in group order', async () => {
    api.listManpowerActual.mockResolvedValue([...ACTUAL, cell({ groupId: 'g3', day: '2026-10-03', value: 1 })])
    renderPanel()
    await loaded()
    await userEvent.click(within(historyRows()[0]).getByRole('button', { name: 'Xoá nhân lực' }))
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Xoá' }))
    await waitFor(() => expect(api.setManpowerActual).toHaveBeenCalledWith('p1', '2026-10-03', [
      { groupId: 'g1', value: null },
      { groupId: 'g2', value: null },
      { groupId: 'g3', value: null },
    ]))
  })
})

describe('ManpowerPanel: layout', () => {
  let restoreViewport = () => {}
  afterEach(() => restoreViewport())
  const antTable = () => screen.getByTestId('manpower-history').querySelector('.ant-table') as HTMLElement

  it('scrolls the history sideways on a phone with the day column pinned (MOB-01)', async () => {
    restoreViewport = setViewport(390)
    renderPanel(asGs)
    await loaded()
    expect(antTable()).toHaveClass('ant-table-scroll-horizontal')
    const pinned = antTable().querySelectorAll('thead th.ant-table-cell-fix-left')
    expect(pinned).toHaveLength(1)
    expect(pinned[0]).toHaveTextContent(/^Ngày$/)
  })

  it('pins nothing from 768 px', async () => {
    restoreViewport = setViewport(1280)
    renderPanel(asGs)
    await loaded()
    expect(antTable()).not.toHaveClass('ant-table-has-fix-left')
  })
})

describe('ManpowerPanel: Plan import (spec §8, R-14)', () => {
  it('offers the template and the import to the admin only', async () => {
    renderPanel(asGs)
    await loaded()
    expect(screen.queryByRole('button', { name: 'Tải file mẫu' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Nhập Plan/ })).toBeNull()
  })

  it('downloads a template naming every group, hidden ones included, in order', async () => {
    renderPanel()
    await loaded()
    await userEvent.click(screen.getByRole('button', { name: 'Tải file mẫu' }))
    await waitFor(() => expect(download).toHaveBeenCalledWith(expect.any(Blob), 'Mau_Manpower_Plan.xlsx'))
    expect(templates.build).toHaveBeenCalledWith(['Reinstatement', 'Insulation', 'Marking'])
  })

  it('refuses a file with an unknown group column and writes nothing', async () => {
    xlsx.read.mockResolvedValue(sheet([['Date', 'Reinstatement', 'Painting'], ['01/10/2026', 10, 3]]))
    renderPanel()
    await loaded()
    await upload()
    expect(await screen.findByText('Không import được plan.xlsx')).toBeInTheDocument()
    expect(within(dialog()).getByText(/Nhóm chưa có trong Cấu hình: Painting/)).toBeInTheDocument()
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Đóng' }))
    expect(api.replaceManpowerPlan).not.toHaveBeenCalled()
  })

  it('previews the diff by day and group, then replaces the plan on confirm', async () => {
    xlsx.read.mockResolvedValue(sheet([
      ['Date', 'Reinstatement', 'Insulation', 'Marking'],
      ['01/10/2026', 10, 5, null],
      ['03/10/2026', 7, null, null],
    ]))
    renderPanel()
    await loaded()
    await upload()
    expect(await screen.findByText('Xem trước Manpower Plan')).toBeInTheDocument()
    expect(keyFactTexts(dialog())).toEqual(['1 thêm', '1 sửa', '2 xoá', '1 giữ nguyên'])
    const line = (label: string) => within(dialog()).getByText(label).closest('tr') as HTMLElement
    expect(line('01/10/2026 · Insulation')).toHaveTextContent(/Sửa.*4.*5/)
    expect(line('03/10/2026 · Reinstatement')).toHaveTextContent(/Thêm.*-.*7/)
    expect(line('02/10/2026 · Marking')).toHaveTextContent(/Xoá.*2.*-/)
    // Two days in the file, not three values.
    expect(within(dialog()).getByText(/thay toàn bộ bằng 2 dòng của file/)).toBeInTheDocument()
    expect(api.replaceManpowerPlan).not.toHaveBeenCalled()

    await userEvent.click(within(dialog()).getByRole('button', { name: 'Thay thế Plan' }))
    await waitFor(() => expect(api.replaceManpowerPlan).toHaveBeenCalledWith(
      'p1',
      [
        { groupId: 'g1', day: '2026-10-01', value: 10 },
        { groupId: 'g2', day: '2026-10-01', value: 5 },
        { groupId: 'g1', day: '2026-10-03', value: 7 },
      ],
      'plan.xlsx',
      { sheet: 'Sheet1', warnings: 0 },
    ))
    await waitFor(() => expect(api.listManpowerPlan).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('Đã import Manpower Plan')).toBeInTheDocument()
  })

  it('shows the plan as imported, folded away, a day per row', async () => {
    renderPanel(asViewer)
    await loaded()
    const heading = screen.getByRole('heading', { level: 2, name: 'Plan' })
    const card = heading.closest('section') as HTMLElement
    expect(keyFactTexts(card)).toEqual(['2 ngày'])
    expect(within(card).queryByRole('table')).toBeNull()
    await userEvent.click(heading)
    const rows = within(within(card).getByRole('table')).getAllByRole('row').slice(1)
    expect(rows[0]).toHaveTextContent(/^01\/10\/2026104-14/)
    expect(rows[1]).toHaveTextContent(/^02\/10\/202612-214/)
  })
})

describe('ManpowerPanel: admin notes (spec §9)', () => {
  const note = (id: string, target: string, createdAt: string) => ({
    id, target, day: '2026-10-02', spoolId: null, body: `Nội dung ${id}`, authorId: 'u1', createdAt,
    updatedBy: null, updatedAt: null, authorName: 'Đoàn Linh', updatedByName: null,
  })

  it('marks the days with notes and opens a day\'s thread newest first', async () => {
    api.listNotes.mockResolvedValue([
      note('n1', 'manpower_day', '2026-10-02T01:00:00Z'),
      note('n2', 'manpower_day', '2026-10-02T05:00:00Z'),
      note('n3', 'reinstatement_day', '2026-10-02T06:00:00Z'),
    ])
    renderPanel()
    await loaded()
    expect(api.listNotes).toHaveBeenCalledWith('p1')
    const oct2 = historyRows()[1]
    await userEvent.click(await within(oct2).findByRole('button', { name: 'Ghi chú (2)' }))
    const drawer = screen.getByText('Ghi chú Manpower 02/10/2026').closest('.ant-drawer-content') as HTMLElement
    expect(within(drawer).getAllByTestId('piping-note-body').map((b) => b.textContent)).toEqual(['Nội dung n2', 'Nội dung n1'])
    expect(within(historyRows()[0]).getByRole('button', { name: 'Ghi chú' })).toBeInTheDocument()
  })

  it('lists a noted day with no row under Ghi chú theo ngày', async () => {
    api.listNotes.mockResolvedValue([
      { ...note('n1', 'manpower_day', '2026-10-02T01:00:00Z'), day: '2026-10-06', body: 'Nghỉ lễ' },
      note('n3', 'reinstatement_day', '2026-10-02T06:00:00Z'),
    ])
    renderPanel()
    await loaded()
    const card = screen.getByRole('heading', { level: 2, name: 'Nhân lực đã nhập' }).parentElement as HTMLElement
    await userEvent.click(within(card).getByRole('button', { name: 'Ghi chú theo ngày' }))
    const drawer = screen.getByText('Ghi chú theo ngày Manpower').closest('.ant-drawer-content') as HTMLElement
    const noted = within(drawer).getByRole('list', { name: 'Ngày có ghi chú' })
    expect(within(noted).getAllByRole('button').map((b) => b.textContent)).toEqual(['06/10/2026 (1)'])
    await userEvent.click(within(noted).getByRole('button', { name: '06/10/2026 (1)' }))
    expect(within(drawer).getByText('Nghỉ lễ')).toBeInTheDocument()
  })

  it.each([['a foreman', asGs], ['a viewer', asViewer]])('never reads or shows notes for %s', async (_who, as) => {
    renderPanel(as)
    await loaded()
    expect(historyRows()).toHaveLength(3)
    expect(screen.queryByRole('button', { name: /Ghi chú/ })).toBeNull()
    expect(api.listNotes).not.toHaveBeenCalled()
  })
})
