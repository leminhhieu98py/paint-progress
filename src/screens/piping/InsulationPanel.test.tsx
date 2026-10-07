import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PipingSettings, Spool, SpoolColumn } from '../../domain/piping/types'
import { expectNoSpecIds, keyFactTexts } from '../../test/copy'
import { renderApp } from '../../test/renderApp'
import { chooseOption, optionTitles } from '../../test/select'
import { setViewport } from '../../test/viewport'
import { InsulationPanel } from './InsulationPanel'
import type { PipingPanelProps } from './panelProps'

const api = vi.hoisted(() => ({ listSpools: vi.fn(), listSpoolColumns: vi.fn() }))
vi.mock('../../lib/pipingApi', () => ({
  listSpools: (...a: unknown[]) => api.listSpools(...a),
  listSpoolColumns: (...a: unknown[]) => api.listSpoolColumns(...a),
}))

// jsdom gives Recharts no size; the stand-in prints what reaches the chart:
// the view, the lines shown, and each bucket's Painting Handover counts.
// It counts its mounts too: a new mount is a fresh Brush.
const chartMounts = vi.hoisted(() => ({ count: 0 }))
vi.mock('./insulation/InsulationChart', async () => {
  const { useEffect } = await import('react')
  return {
    InsulationChart: ({ data, keys, mode }: { data: Array<Record<string, unknown>>; keys: string[]; mode: string }) => {
      useEffect(() => {
        chartMounts.count += 1
      }, [])
      return (
        <div data-testid="insulation-chart" data-mode={mode} data-keys={keys.join(',')}>
          {data.map((p) => `${String(p.key)}:${String(p.phPlan)}/${String(p.phActual)}`).join(' ')}
        </div>
      )
    },
  }
})

const SETTINGS: PipingSettings = {
  projectId: 'p1', enabled: true, weekStartDate: '2026-09-28', totalTestPacks: null, lateThresholdDays: 7,
}

const spool = (seq: number, over: Partial<Spool> = {}): Spool => ({
  id: `s${seq}`, seq, spoolNo: `SP-${seq}`, lineNo: 'L1', insuType: 'HC', drawingNo: 'D1', testPackageNo: 'TP1',
  paintingSystem: 'BD-02B', extra: {}, phPlan: null, ihPlan: null, iwPlan: null, phActual: null, ihActual: null,
  iwActual: null, ...over,
})

const SPOOLS: Spool[] = [
  spool(1, { phPlan: '2026-10-01', ihPlan: '2026-10-05', iwPlan: '2026-10-10', phActual: '2026-10-02', ihActual: '2026-10-06' }),
  spool(2, { spoolNo: 'SP-1', phPlan: '2026-10-03', phActual: '2026-10-04' }),
  spool(3, { lineNo: 'L2', testPackageNo: 'TP2', phPlan: '2026-10-09', ihPlan: '2026-10-08' }),
  spool(4, { lineNo: null, testPackageNo: null, phActual: '2026-10-06' }),
]
const COLUMNS: SpoolColumn[] = [{ id: 'c1', label: 'Zone', sort: 1 }]

const props = (over: Partial<PipingPanelProps> = {}): PipingPanelProps => ({
  projectId: 'p1', settings: SETTINGS, mode: 'day', variant: 'admin', role: 'admin', todayKey: '2026-10-07',
  refreshKey: 0, ...over,
})
const renderPanel = (over: Partial<PipingPanelProps> = {}) => renderApp(<InsulationPanel {...props(over)} />)

const asGs = { variant: 'gs', role: 'gs' } as const
const asViewer = { variant: 'gs', role: 'viewer' } as const

const chart = () => screen.findByTestId('insulation-chart')
const bucket = (key: string) => screen.getByTestId('insulation-chart').textContent?.split(' ').find((b) => b.startsWith(`${key}:`))
const show = (name: 'Plan' | 'Actual' | 'Plan & Actual') => chooseOption('Đường hiển thị', name)
const selected = (name: string) =>
  screen.getByRole('combobox', { name }).closest('.ant-select')?.querySelector('.ant-select-selection-item')?.textContent
const header = (name: string) => screen.getByRole('heading', { level: 2, name }).parentElement as HTMLElement

let undoViewport: () => void
beforeEach(() => {
  undoViewport = setViewport(1280)
  chartMounts.count = 0
  api.listSpools.mockReset()
  api.listSpoolColumns.mockReset()
  api.listSpools.mockResolvedValue(SPOOLS)
  api.listSpoolColumns.mockResolvedValue(COLUMNS)
})
afterEach(() => undoViewport())

describe('InsulationPanel: summary (spec §6.4)', () => {
  it('reads the project spools and extra columns and sums each milestone per spool row', async () => {
    renderPanel()
    await chart()
    expect(api.listSpools).toHaveBeenCalledWith('p1')
    expect(api.listSpoolColumns).toHaveBeenCalledWith('p1')
    expect(screen.getByRole('heading', { level: 2, name: 'Insulation' })).toBeInTheDocument()
    expect(keyFactTexts()).toEqual(expect.arrayContaining([
      '4 spool', 'Painting Handover 3/4 SpoolNo', 'Insulation Handover 1/4 SpoolNo', 'Insulation Work 0/4 SpoolNo',
    ]))
    expectNoSpecIds()
  })

  it('warns the admin of duplicate SpoolNo and plan-order issues, naming them', async () => {
    renderPanel()
    await chart()
    expect(keyFactTexts()).toEqual(expect.arrayContaining(['1 SpoolNo trùng', '1 spool sai thứ tự Plan']))
    expect(screen.getByLabelText('SpoolNo trùng: SP-1 (2 dòng)')).toBeInTheDocument()
    expect(screen.getByLabelText(
      'Ngày Plan không theo thứ tự Painting Handover, Insulation Handover, Insulation Work: SP-3',
    )).toBeInTheDocument()
  })

  it('names at most ten and counts the rest', async () => {
    const many = Array.from({ length: 24 }, (_, i) => spool(i + 1, { spoolNo: `D-${Math.floor(i / 2) + 1}` }))
    api.listSpools.mockResolvedValue(many)
    renderPanel()
    await screen.findByText('Chưa có ngày Plan hoặc Actual')
    expect(keyFactTexts()).toContain('12 SpoolNo trùng')
    expect(screen.getByLabelText(
      'SpoolNo trùng: D-1 (2 dòng), D-2 (2 dòng), D-3 (2 dòng), D-4 (2 dòng), D-5 (2 dòng), D-6 (2 dòng), '
      + 'D-7 (2 dòng), D-8 (2 dòng), D-9 (2 dòng), D-10 (2 dòng) và 2 SpoolNo khác',
    )).toBeInTheDocument()
  })

  it.each([['gs', asGs], ['viewer', asViewer]] as const)('shows a %s no review warnings', async (_n, role) => {
    renderPanel(role)
    await chart()
    expect(keyFactTexts().join('|')).not.toMatch(/trùng|sai thứ tự/)
    expect(keyFactTexts()).toContain('Painting Handover 3/4 SpoolNo')
  })
})

describe('InsulationPanel: chart (spec §6.4, Q20A)', () => {
  it('offers the six units, SpoolNo first and chosen', async () => {
    renderPanel()
    await chart()
    expect(await optionTitles('Đơn vị đếm')).toEqual([
      'SpoolNo', 'LineNo', 'InsuType', 'DrawingNo', 'Test Package No', 'Painting System',
    ])
  })

  it('counts spool rows for SpoolNo and complete groups for another unit', async () => {
    renderPanel()
    await chart()
    // By today (07/10): two spools planned Painting Handover, three reached it.
    expect(bucket('2026-10-07')).toBe('2026-10-07:2/3')
    // The plan runs to its last day (10/10); the actual stops at today.
    expect(bucket('2026-10-10')).toBe('2026-10-10:3/null')
    await chooseOption('Đơn vị đếm', 'LineNo')
    // L1 is done once both its spools are; L2 is not; a spool without a line is no line.
    expect(keyFactTexts()).toEqual(expect.arrayContaining([
      'Painting Handover 1/2 LineNo', 'Insulation Handover 0/2 LineNo', 'Insulation Work 0/2 LineNo',
    ]))
    expect(bucket('2026-10-07')).toBe('2026-10-07:1/1')
  })

  it('shows all six lines, then Plan only, then Actual only', async () => {
    renderPanel()
    expect(await chart()).toHaveAttribute('data-keys', 'phPlan,phActual,ihPlan,ihActual,iwPlan,iwActual')
    expect(selected('Đường hiển thị')).toBe('Plan & Actual')
    expect(await optionTitles('Đường hiển thị')).toEqual(['Plan', 'Actual', 'Plan & Actual'])
    await show('Plan')
    expect(screen.getByTestId('insulation-chart')).toHaveAttribute('data-keys', 'phPlan,ihPlan,iwPlan')
    await show('Actual')
    expect(screen.getByTestId('insulation-chart')).toHaveAttribute('data-keys', 'phActual,ihActual,iwActual')
  })

  it('runs the plan to its end and the actual to today, by week in week view', async () => {
    renderPanel({ mode: 'week' })
    const c = await chart()
    expect(c).toHaveAttribute('data-mode', 'week')
    // Weeks from 28/09, cumulative to each week's last day; the plan ends in the week of 05/10 (10/10).
    expect(c.textContent).toBe('2026-09-28:2/2 2026-10-05:3/3')
  })

  it('draws the chart afresh when the unit, the lines or the view change, so a zoom never outlives its axis', async () => {
    const { rerender } = renderPanel()
    await chart()
    expect(chartMounts.count).toBe(1)
    await chooseOption('Đơn vị đếm', 'LineNo')
    expect(chartMounts.count).toBe(2)
    await show('Plan')
    expect(chartMounts.count).toBe(3)
    rerender(<InsulationPanel {...props({ mode: 'week' })} />)
    await waitFor(() => expect(chartMounts.count).toBe(4))
  })

  it('agrees with the Package rows: a package done in the facts is one with a reached date', async () => {
    renderPanel()
    await chart()
    await chooseOption('Đơn vị đếm', 'Test Package No')
    // TP1 (spools 1, 2) reached Painting Handover on 04/10; TP2 has not; spool 4 is in no package.
    expect(keyFactTexts()).toContain('Painting Handover 1/2 Test Package No')
    const rows = within(within(screen.getByTestId('spool-detail')).getByRole('table')).getAllByRole('row')
      .filter((r) => r.closest('tbody') !== null)
      .map((r) => within(r).getAllByRole('cell').map((c) => c.textContent))
    const packages = rows.filter((c) => c[0] !== '-')
    expect(packages).toHaveLength(2)
    expect(packages.filter((c) => c[4] !== '-').map((c) => c[0])).toEqual(['TP1'])
    expect(keyFactTexts()).toContain('2 Test Package')
  })

  it('on a phone moves the unit and the lines into a row of the body', async () => {
    undoViewport()
    undoViewport = setViewport(390)
    renderPanel(asGs)
    await chart()
    expect(within(header('Insulation')).queryByRole('combobox')).toBeNull()
    const row = screen.getAllByTestId('control-row')[0]
    expect(within(row).getByRole('combobox', { name: 'Đơn vị đếm' })).toBeInTheDocument()
    expect(within(row).getByRole('combobox', { name: 'Đường hiển thị' })).toBeInTheDocument()
  })

  it('says there is nothing to chart while no spool has a date, still listing the spools', async () => {
    api.listSpools.mockResolvedValue([spool(1), spool(2)])
    renderPanel()
    expect(await screen.findByText('Chưa có ngày Plan hoặc Actual')).toBeInTheDocument()
    expect(screen.queryByTestId('insulation-chart')).toBeNull()
    expect(screen.getByRole('heading', { level: 2, name: 'Chi tiết' })).toBeInTheDocument()
  })
})

describe('InsulationPanel: detail and states', () => {
  it('lists the spools with the extra columns and the admin flags', async () => {
    renderPanel()
    await chart()
    await chooseOption('Cấp hiển thị', 'Spool')
    const table = within(screen.getByTestId('spool-detail')).getByRole('table')
    expect(within(table).getByRole('columnheader', { name: 'Zone' })).toBeInTheDocument()
    expect(within(table).getAllByText('SpoolNo trùng')).toHaveLength(2)
    expect(within(table).getByText('Sai thứ tự Plan')).toBeInTheDocument()
  })

  it('tells the admin to import the Plan when there are no spools yet', async () => {
    api.listSpools.mockResolvedValue([])
    renderPanel()
    expect(await screen.findByText('Chưa có spool nào')).toBeInTheDocument()
    expect(screen.getByText('Nhập Plan Insulation để thêm spool')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Chi tiết' })).toBeNull()
  })

  it('tells a foreman the admin has not imported the Plan yet', async () => {
    api.listSpools.mockResolvedValue([])
    renderPanel(asGs)
    expect(await screen.findByText('Chưa có spool nào')).toBeInTheDocument()
    expect(screen.getByText('Admin chưa nhập Plan Insulation')).toBeInTheDocument()
  })

  it('says a failed read and retries it', async () => {
    api.listSpools.mockRejectedValueOnce(new Error('mất mạng'))
    renderPanel()
    expect(await screen.findByText('Không tải được Insulation')).toBeInTheDocument()
    expect(screen.getByText('mất mạng')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Thử lại' }))
    await chart()
    expect(api.listSpools).toHaveBeenCalledTimes(2)
  })

  it('reads again when Cấu hình changed something', async () => {
    const { rerender } = renderPanel()
    await chart()
    rerender(<InsulationPanel {...props({ refreshKey: 1 })} />)
    await waitFor(() => expect(api.listSpoolColumns).toHaveBeenCalledTimes(2))
  })
})
