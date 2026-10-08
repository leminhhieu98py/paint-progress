import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Unit } from '../../domain/piping/types'
import type { PipingReportInput } from '../../lib/piping/report'
import { renderApp } from '../../test/renderApp'
import { setViewport } from '../../test/viewport'
import { InsulationUnitProvider, useInsulationUnit } from './insulationUnit'
import type { PipingPanelProps, PipingRole } from './panelProps'
import { PipingExportAction } from './PipingExportAction'

const api = vi.hoisted(() => ({
  listReinstatementPlan: vi.fn(),
  listReinstatementEntries: vi.fn(),
  listManpowerGroups: vi.fn(),
  listManpowerPlan: vi.fn(),
  listManpowerActual: vi.fn(),
  listSpools: vi.fn(),
  listNotes: vi.fn(),
}))
vi.mock('../../lib/pipingApi', () => api)
const loadGsProjectIdentity = vi.hoisted(() => vi.fn())
vi.mock('../../lib/gsApi', () => ({ loadGsProjectIdentity: (id: string) => loadGsProjectIdentity(id) }))
const renderChartPng = vi.hoisted(() => vi.fn())
vi.mock('./report/chartImage', () => ({ renderChartPng: (spec: unknown) => renderChartPng(spec) }))
const downloadWorkbook = vi.hoisted(() => vi.fn())
vi.mock('../../lib/projectReport', () => ({ downloadWorkbook: (b: Blob, n: string) => downloadWorkbook(b, n) }))
const buildPipingReport = vi.hoisted(() => vi.fn())
vi.mock('../../lib/piping/report', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/piping/report')>()),
  buildPipingReport: (input: PipingReportInput) => buildPipingReport(input),
}))

const PNG = { base64: 'AAAA', width: 1000, height: 400 }
const BLOB = new Blob(['xlsx'])

const panel = (over: Partial<PipingPanelProps> = {}): PipingPanelProps => ({
  projectId: 'p1',
  settings: {
    projectId: 'p1', enabled: true, weekStartDate: '2026-09-28', totalTestPacks: 100, lateThresholdDays: 7,
  },
  mode: 'week',
  variant: 'admin',
  role: 'admin',
  todayKey: '2026-10-02',
  refreshKey: 0,
  ...over,
})

const fieldPanel = (role: PipingRole) => panel({ variant: 'gs', role })

let undoViewport = () => {}

beforeEach(() => {
  undoViewport = setViewport(1280)
  for (const fn of Object.values(api)) fn.mockReset()
  api.listReinstatementPlan.mockResolvedValue([{ day: '2026-09-30', planQty: 10 }])
  api.listReinstatementEntries.mockResolvedValue([{ id: 'e1', day: '2026-09-30', qty: 4 }])
  api.listManpowerGroups.mockResolvedValue([{ id: 'g1', name: 'Reinstatement', sort: 1, hidden: false }])
  api.listManpowerPlan.mockResolvedValue([{ groupId: 'g1', day: '2026-09-30', value: 3 }])
  api.listManpowerActual.mockResolvedValue([{ groupId: 'g1', day: '2026-09-30', value: 2 }])
  api.listSpools.mockResolvedValue([{
    id: 's1', seq: 1, spoolNo: 'SP-1', lineNo: 'L1', insuType: null, drawingNo: null, testPackageNo: 'TP1',
    paintingSystem: null, extra: {}, phPlan: '2026-09-30', ihPlan: null, iwPlan: null,
    phActual: null, ihActual: null, iwActual: null,
  }])
  api.listNotes.mockResolvedValue([{ id: 'n1', target: 'spool', spoolId: 's1', body: 'x' }])
  loadGsProjectIdentity.mockReset().mockResolvedValue({ code: 'DH', name: 'Đại Hùng' })
  renderChartPng.mockReset().mockResolvedValue(PNG)
  downloadWorkbook.mockReset()
  buildPipingReport.mockReset().mockResolvedValue(BLOB)
})

afterEach(() => undoViewport())

const exportButton = () => screen.getByRole('button', { name: 'Xuất báo cáo' })
const reportInput = (): PipingReportInput => buildPipingReport.mock.calls[0][0]

describe('PipingExportAction (spec §10)', () => {
  it('stays in place, disabled, while the page has no panel', () => {
    renderApp(<PipingExportAction panel={null} />)
    expect(exportButton()).toBeDisabled()
  })

  it('admin: reads everything, notes included, builds in the current view and downloads <code>_Piping_<day>.xlsx', async () => {
    renderApp(<PipingExportAction panel={panel()} />)
    await userEvent.click(exportButton())
    await waitFor(() => expect(downloadWorkbook).toHaveBeenCalledWith(BLOB, 'DH_Piping_2026-10-02.xlsx'))
    expect(loadGsProjectIdentity).toHaveBeenCalledWith('p1')
    expect(api.listNotes).toHaveBeenCalledWith('p1')
    const input = reportInput()
    expect(input).toMatchObject({
      project: { code: 'DH', name: 'Đại Hùng' },
      mode: 'week',
      unit: 'spoolNo',
      todayKey: '2026-10-02',
      includeNotes: true,
      notes: [{ id: 'n1' }],
      settings: { weekStartDate: '2026-09-28', totalTestPacks: 100, lateThresholdDays: 7 },
    })
    expect(input.reinstatement.actual).toEqual([{ id: 'e1', day: '2026-09-30', qty: 4 }])
    expect(input.charts).toEqual({ reinstatement: PNG, manpower: PNG, insulation: PNG })
    expect(renderChartPng.mock.calls.map(([spec]) => spec.kind)).toEqual(['reinstatement', 'manpower', 'insulation'])
    expect(renderChartPng.mock.calls[0][0]).toMatchObject({ mode: 'week' })
    expect(renderChartPng.mock.calls[2][0].keys).toHaveLength(6)
    expect(await screen.findByText('Đã xuất báo cáo Piping')).toBeInTheDocument()
  })

  it.each(['gs', 'viewer'] as const)('%s: never reads the notes, and the report has none', async (role) => {
    setViewport(1024)
    renderApp(<PipingExportAction panel={fieldPanel(role)} />)
    await userEvent.click(exportButton())
    await waitFor(() => expect(downloadWorkbook).toHaveBeenCalled())
    expect(api.listNotes).not.toHaveBeenCalled()
    expect(reportInput()).toMatchObject({ includeNotes: false, notes: [] })
  })

  it('writes the file without a chart that failed to render, and skips a chart with no data', async () => {
    api.listSpools.mockResolvedValue([])
    renderChartPng.mockImplementation(async (spec: { kind: string }) => {
      if (spec.kind === 'reinstatement') throw new Error('canvas')
      return PNG
    })
    renderApp(<PipingExportAction panel={panel()} />)
    await userEvent.click(exportButton())
    await waitFor(() => expect(downloadWorkbook).toHaveBeenCalled())
    expect(reportInput().charts).toEqual({ reinstatement: 'failed', manpower: PNG })
    expect(renderChartPng.mock.calls.map(([spec]) => spec.kind)).toEqual(['reinstatement', 'manpower'])
  })

  it('runs one export at a time: a second click while it runs does nothing', async () => {
    let finish: (b: Blob) => void = () => {}
    buildPipingReport.mockReturnValue(new Promise<Blob>((resolve) => { finish = resolve }))
    renderApp(<PipingExportAction panel={panel()} />)
    await userEvent.click(exportButton())
    await waitFor(() => expect(buildPipingReport).toHaveBeenCalledTimes(1))
    await userEvent.click(exportButton())
    expect(loadGsProjectIdentity).toHaveBeenCalledTimes(1)
    finish(BLOB)
    await waitFor(() => expect(downloadWorkbook).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(exportButton()).not.toHaveClass('ant-btn-loading'))
  })

  it('says why when a read fails, and downloads nothing', async () => {
    api.listSpools.mockRejectedValue(new Error('Mất kết nối'))
    renderApp(<PipingExportAction panel={panel()} />)
    await userEvent.click(exportButton())
    expect(await screen.findByText('Không xuất được báo cáo: Mất kết nối')).toBeInTheDocument()
    expect(downloadWorkbook).not.toHaveBeenCalled()
    expect(exportButton()).toBeEnabled()
  })

  it('writes the Insulation unit on screen', async () => {
    function UnitPicker({ unit }: { unit: Unit }) {
      const [, setUnit] = useInsulationUnit('p1')
      return <button type="button" onClick={() => setUnit(unit)}>pick</button>
    }
    renderApp(
      <InsulationUnitProvider>
        <UnitPicker unit="lineNo" />
        <PipingExportAction panel={panel()} />
      </InsulationUnitProvider>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'pick' }))
    await userEvent.click(exportButton())
    await waitFor(() => expect(buildPipingReport).toHaveBeenCalled())
    expect(reportInput().unit).toBe('lineNo')
  })

  it('on a phone, a field user finds it in one ⋯ menu with its icon and text (GS-09)', async () => {
    setViewport(390)
    renderApp(<PipingExportAction panel={fieldPanel('gs')} />)
    expect(screen.queryByRole('button', { name: 'Xuất báo cáo' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Thêm thao tác' }))
    const item = await screen.findByRole('menuitem', { name: /Xuất báo cáo/ })
    expect(item.querySelector('.anticon-file-excel')).not.toBeNull()
    await userEvent.click(item)
    await waitFor(() => expect(downloadWorkbook).toHaveBeenCalledWith(BLOB, 'DH_Piping_2026-10-02.xlsx'))
  })
})
