import { App as AntApp } from 'antd'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EMPTY_EFFORT, type Cell, type DeckEvent, type Stage, type WorkModel } from '../../domain/types'
import type { StoredStagePlan } from '../../lib/kpiApi'
import { KpiScreen } from './KpiScreen'
import type { DeckKpiColorRow, DeckKpiColors } from './DeckKpiColorTable'
import type { KpiEntry } from './KpiDashboard'
import type { StagePlanRow } from './StagePlanTable'

const loadProjectModel = vi.hoisted(() => vi.fn())
const listProjectEvents = vi.hoisted(() => vi.fn())
const listProjectNames = vi.hoisted(() => vi.fn())
const listStagePlans = vi.hoisted(() => vi.fn())
const saveStagePlan = vi.hoisted(() => vi.fn())
const clearStagePlanArea = vi.hoisted(() => vi.fn())
const setDeckKpiColors = vi.hoisted(() => vi.fn())
const navigate = vi.hoisted(() => vi.fn())

vi.mock('../../lib/progressApi', () => ({
  loadProjectModel: (id: string) => loadProjectModel(id),
  listProjectEvents: (id: string) => listProjectEvents(id),
}))
vi.mock('../../lib/projectsApi', () => ({
  listProjectNames: () => listProjectNames(),
}))
vi.mock('../../lib/kpiApi', () => ({
  listStagePlans: (id: string) => listStagePlans(id),
  saveStagePlan: (row: unknown) => saveStagePlan(row),
  clearStagePlanArea: (id: string) => clearStagePlanArea(id),
}))
vi.mock('../../lib/decksApi', () => ({
  setDeckKpiColors: (id: string, colors: unknown) => setDeckKpiColors(id, colors),
}))
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => navigate }
})

// Both children are covered by their own suites. What this file checks is the
// assembly between them: which coats reach the chart, which reach the entry
// table, and what the computed area comes out as -- so the stand-ins print
// exactly that and nothing else.
vi.mock('./KpiDashboard', () => ({
  KpiDashboard: ({ entries, decks }: { entries: KpiEntry[]; decks: DeckKpiColorRow[] }) => (
    <div data-testid="kpi-dashboard">
      {`CHART ${decks.map((d) => `${d.name}=${d.kpiPlanColor ?? '-'}/${d.kpiActualColor ?? '-'}`).join(',')} | `}
      {entries
        .map((e) => `${e.deckName}/${e.plan.stageName}@${e.plan.startDate} tt=${e.computedAreaM2} th=${e.actual.length}`)
        .join(' ; ')}
    </div>
  ),
}))
vi.mock('./DeckKpiColorTable', () => ({
  DeckKpiColorTable: ({
    decks,
    onChange,
  }: {
    decks: DeckKpiColorRow[]
    onChange: (deckId: string, colors: DeckKpiColors) => void
  }) => (
    <div data-testid="deck-color-table">
      {`MÀU ${decks.map((d) => `${d.name}=${d.kpiPlanColor ?? '-'}/${d.kpiActualColor ?? '-'}`).join(' ; ')}`}
      <button type="button" onClick={() => onChange(decks[0].id, { plan: '#123abc', actual: null })}>
        đổi màu thử
      </button>
    </div>
  ),
}))
vi.mock('./StagePlanTable', () => ({
  StagePlanTable: ({
    rows,
    computedAreaFor,
    onSave,
    onClearArea,
  }: {
    rows: StagePlanRow[]
    computedAreaFor: (row: StagePlanRow, startDate: string | null) => number
    onSave: (row: StagePlanRow, w: { startDate: string; endDate: string; plannedAreaM2: number | null }) => void
    onClearArea: (stageId: string) => void
  }) => (
    <div data-testid="plan-table">
      {`BẢNG ${rows.map((r) => `${r.stageName}${r.plan === null ? '(trống)' : '(đã có)'}=${computedAreaFor(r, '2026-09-20')}`).join(' ; ')}`}
      <button
        type="button"
        onClick={() => onSave(rows[0], { startDate: '2026-09-01', endDate: '2026-09-12', plannedAreaM2: null })}
      >
        lưu thử
      </button>
      <button type="button" onClick={() => onClearArea(rows[0].stageId)}>xoá ghi đè</button>
    </div>
  ),
}))

const STAGES: Stage[] = [
  { id: 's1', seq: 1, name: 'Lớp 1', color: '#fadb14', weight: 0.5 },
  { id: 's2', seq: 2, name: 'Lớp 2', color: '#bfbfbf', weight: 0.5 },
]

const cell = (code: string, stageId: string | null): Cell => ({
  id: code, code, x: 0, y: 0, w: 0, h: 0, areaM2: 250, stageId,
})

/** One bays work over one deck of 1000 m², two bays at coat 1, two untouched. */
const MODELS: WorkModel[] = [
  {
    work: { id: 'w1', projectId: 'p1', seq: 1, name: 'Sơn', kind: 'bays', weight: 1, counts: true, manualProgress: 0 },
    decks: [{
      deck: {
        id: 'd1', code: 'AD', name: 'Sàn A', totalAreaM2: 1000,
        cells: [cell('R1C1', 's1'), cell('R1C2', 's1'), cell('R1C3', null), cell('R1C4', null)],
      },
      stages: STAGES,
      weight: 1,
    }],
  },
  // A manual work has no bays and no coats, so it has nothing to plan.
  {
    work: { id: 'wm', projectId: 'p1', seq: 2, name: 'Marking', kind: 'manual', weight: 0, counts: false, manualProgress: 0.2 },
    decks: [],
  },
]

const MODEL = {
  models: MODELS,
  decks: [{ id: 'd1', name: 'Sàn A', kpiPlanColor: '#aaaaaa', kpiActualColor: null }],
  audit: {},
}

const ev = (over: Partial<Omit<DeckEvent, 'effort'>> = {}): DeckEvent => ({
  id: 1, deckName: 'Sàn A', cellCode: 'R1C1', cellAreaM2: 250, workName: 'Sơn',
  toStageName: 'Lớp 1', at: '2026-09-02T03:00:00Z', byId: 'u1', note: '',
  reportNote: null, reportHidden: false, effortEditedAt: null, effortEditedByName: null,
  effort: { ...EMPTY_EFFORT },
  ...over,
})

const EVENTS: DeckEvent[] = [
  ev({ id: 1, cellCode: 'R1C1' }),
  ev({ id: 2, cellCode: 'R1C2', at: '2026-09-03T03:00:00Z' }),
  // Another deck's history must not reach this deck's scope.
  ev({ id: 3, deckName: 'Sàn B', cellCode: 'R9C9' }),
]

const PLANS: StoredStagePlan[] = [{
  stageId: 's1', workId: 'w1', deckId: 'd1', workName: 'Sơn', stageName: 'Lớp 1',
  startDate: '2026-09-01', endDate: '2026-09-12', plannedAreaM2: null,
}]

beforeEach(() => {
  loadProjectModel.mockReset()
  listProjectEvents.mockReset()
  listProjectNames.mockReset()
  listStagePlans.mockReset()
  saveStagePlan.mockReset()
  clearStagePlanArea.mockReset()
  setDeckKpiColors.mockReset()
  navigate.mockReset()
  loadProjectModel.mockResolvedValue(MODEL)
  listProjectEvents.mockResolvedValue(EVENTS)
  listStagePlans.mockResolvedValue(PLANS)
  saveStagePlan.mockResolvedValue(undefined)
  clearStagePlanArea.mockResolvedValue(undefined)
  setDeckKpiColors.mockResolvedValue(undefined)
  listProjectNames.mockResolvedValue([
    { id: 'p1', name: 'Giàn A', code: 'GA' }, { id: 'p2', name: 'Giàn B', code: 'GB' },
  ])
})

const { MemoryRouter, Route, Routes } = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')

const renderAdmin = (path = '/admin/kpi') =>
  render(
    <AntApp>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/admin/kpi" element={<KpiScreen variant="admin" />} />
        </Routes>
      </MemoryRouter>
    </AntApp>,
  )

const renderField = () =>
  render(
    <AntApp>
      <MemoryRouter initialEntries={['/gs/p2/kpi']}>
        <Routes>
          <Route path="/gs/:projectId/kpi" element={<KpiScreen variant="gs" />} />
        </Routes>
      </MemoryRouter>
    </AntApp>,
  )

describe('KpiScreen (admin)', () => {
  it('opens on the first project and makes its three reads', async () => {
    renderAdmin()
    await screen.findByTestId('kpi-dashboard')
    expect(loadProjectModel).toHaveBeenCalledWith('p1')
    expect(listProjectEvents).toHaveBeenCalledWith('p1')
    expect(listStagePlans).toHaveBeenCalledWith('p1')
    expect(screen.getByText(/Giàn A · kế hoạch so với thực hiện/)).toBeInTheDocument()
  })

  it('honours ?project= when it names a project that exists', async () => {
    renderAdmin('/admin/kpi?project=p2')
    await screen.findByTestId('kpi-dashboard')
    expect(listStagePlans).toHaveBeenCalledWith('p2')
    expect(listStagePlans).not.toHaveBeenCalledWith('p1')
  })

  it('puts every coat in the entry table, planned or not', async () => {
    // A coat with no window still gets a row: the table is where an unplanned
    // coat is visible, and an absent row would read as "no such coat".
    renderAdmin()
    const table = await screen.findByTestId('plan-table')
    expect(table.textContent).toContain('Lớp 1(đã có)')
    expect(table.textContent).toContain('Lớp 2(trống)')
  })

  it('puts only the planned coats on the chart', async () => {
    // RV5-26 divides by the summed planned area of the coats in scope. An
    // unplanned coat adds nothing to that denominator, so its actual m² would
    // push the actual curve above a plan that never included it.
    renderAdmin()
    const chart = await screen.findByTestId('kpi-dashboard')
    expect(chart.textContent).toContain('Sàn A/Lớp 1@2026-09-01')
    expect(chart.textContent).not.toContain('Lớp 2')
  })

  it('computes the remaining area for the start date, off the deck state', async () => {
    // 500 of 1000 m² is at coat 1, so 500 is left for coat 1 and the whole
    // 1000 for coat 2. The start date is in the future here, so this is the
    // cell_states path -- the same figure computeDeckProgress produces.
    renderAdmin()
    const table = await screen.findByTestId('plan-table')
    expect(table.textContent).toContain('Lớp 1(đã có)=500')
    expect(table.textContent).toContain('Lớp 2(trống)=1000')
  })

  it('keeps another deck\'s events out of this deck\'s actual', async () => {
    renderAdmin()
    const chart = await screen.findByTestId('kpi-dashboard')
    // Two bays reached Lớp 1, on two different days: two actual rows. The
    // Sàn B event contributes nothing.
    expect(chart.textContent).toContain('th=2')
  })

  it('saves a window and reloads', async () => {
    renderAdmin()
    await screen.findByTestId('plan-table')
    await userEvent.click(screen.getByRole('button', { name: 'lưu thử' }))

    await waitFor(() => expect(saveStagePlan).toHaveBeenCalledWith({
      stageId: 's1', workId: 'w1', deckId: 'd1',
      startDate: '2026-09-01', endDate: '2026-09-12', plannedAreaM2: null,
    }))
    // Reloaded, so the row the admin just wrote is read back rather than
    // assumed: four reads in total across the two loads.
    await waitFor(() => expect(listStagePlans).toHaveBeenCalledTimes(2))
  })

  it('clears an override and reloads', async () => {
    renderAdmin()
    await screen.findByTestId('plan-table')
    await userEvent.click(screen.getByRole('button', { name: 'xoá ghi đè' }))

    await waitFor(() => expect(clearStagePlanArea).toHaveBeenCalledWith('s1'))
    await waitFor(() => expect(listStagePlans).toHaveBeenCalledTimes(2))
  })

  it('reports a failed save without losing the screen', async () => {
    saveStagePlan.mockRejectedValueOnce(new Error('không có quyền sửa'))
    renderAdmin()
    await screen.findByTestId('plan-table')
    await userEvent.click(screen.getByRole('button', { name: 'lưu thử' }))

    expect(await screen.findByText('không có quyền sửa')).toBeInTheDocument()
    expect(screen.getByTestId('plan-table')).toBeInTheDocument()
  })

  // ---------------------------------------------------------------------
  // RV6-28 -- the per-deck colour table, between the plan table and the chart
  // ---------------------------------------------------------------------

  it('hands the colour table every deck with its stored colours, between the plan table and the chart', async () => {
    renderAdmin()
    const colors = await screen.findByTestId('deck-color-table')
    expect(colors.textContent).toContain('MÀU Sàn A=#aaaaaa/-')
    const table = screen.getByTestId('plan-table')
    const chart = screen.getByTestId('kpi-dashboard')
    expect(table.compareDocumentPosition(colors) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(colors.compareDocumentPosition(chart) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('writes a colour change and reloads so the chart reflects it', async () => {
    renderAdmin()
    await screen.findByTestId('deck-color-table')
    await userEvent.click(screen.getByRole('button', { name: 'đổi màu thử' }))

    await waitFor(() => expect(setDeckKpiColors).toHaveBeenCalledWith('d1', { plan: '#123abc', actual: null }))
    await waitFor(() => expect(loadProjectModel).toHaveBeenCalledTimes(2))
  })

  it('reports a failed colour write without losing the screen', async () => {
    setDeckKpiColors.mockRejectedValueOnce(new Error('không có quyền sửa màu'))
    renderAdmin()
    await screen.findByTestId('deck-color-table')
    await userEvent.click(screen.getByRole('button', { name: 'đổi màu thử' }))

    expect(await screen.findByText('không có quyền sửa màu')).toBeInTheDocument()
    expect(screen.getByTestId('deck-color-table')).toBeInTheDocument()
    expect(loadProjectModel).toHaveBeenCalledTimes(1)
  })

  it('reports a failed read and retries on request', async () => {
    listStagePlans.mockRejectedValueOnce(new Error('mất kết nối'))
    renderAdmin()
    expect(await screen.findByText('Không tải được số liệu KPI')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Thử lại' }))
    expect(await screen.findByTestId('kpi-dashboard')).toBeInTheDocument()
  })
})

describe('KpiScreen (gs)', () => {
  it('shows the chart alone: the plan dates are the admin\'s (RV5-28)', async () => {
    renderField()
    expect(await screen.findByTestId('kpi-dashboard')).toBeInTheDocument()
    // No entry table for the field, in either role that reaches this route.
    expect(screen.queryByTestId('plan-table')).toBeNull()
    // And no colour table either (RV6-28: admin only); the colours still reach
    // the chart through `decks`.
    expect(screen.queryByTestId('deck-color-table')).toBeNull()
  })

  it('still hands the chart the deck colours, so the field sees the admin\'s choice (RV6-29)', async () => {
    renderField()
    const chart = await screen.findByTestId('kpi-dashboard')
    expect(chart.textContent).toContain('CHART Sàn A=#aaaaaa/-')
  })

  it('reads the project from the path and offers the way back to the drawing', async () => {
    renderField()
    await screen.findByTestId('kpi-dashboard')
    expect(listStagePlans).toHaveBeenCalledWith('p2')
    expect(listProjectNames).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Về bản vẽ' }))
    expect(navigate).toHaveBeenCalledWith('/gs/p2')
  })
})
