import { App as AntApp } from 'antd'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EMPTY_EFFORT, type Cell, type DeckEvent, type Stage, type WorkModel } from '../../domain/types'
import type { StoredStagePlan } from '../../lib/kpiApi'
import { pageSubtitle } from '../../test/copy'
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
const listDecks = vi.hoisted(() => vi.fn())

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
  listDecks: (id: string) => listDecks(id),
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
  KpiDashboard: ({ entries, decks, emptyDescription, filters }: {
    entries: KpiEntry[]; decks: DeckKpiColorRow[]; emptyDescription?: string; filters: { deckId: string; coat: string }
  }) => (
    <div data-testid="kpi-dashboard">
      {`PHẠM VI ${filters.deckId || 'tất cả'}/${filters.coat || 'tất cả'} | `}
      {emptyDescription !== undefined && `GỢI Ý ${emptyDescription} | `}
      {`CHART ${decks.map((d) => `${d.name}=${d.kpiPlanColor ?? '-'}/${d.kpiActualColor ?? '-'}`).join(',')} | `}
      {entries
        .map((e) => `${e.deckName}/${e.plan.stageName}@${e.plan.startDate} tt=${e.computedAreaM2} th=${e.actual.length} đv=${e.unit}`)
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
      {`BẢNG ${rows.map((r) => `${r.stageName}${r.plan === null ? '(trống)' : '(đã có)'}=${computedAreaFor(r, '2026-09-20')} đv=${r.quantityLabel}/${r.unit}`).join(' ; ')}`}
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
    work: { id: 'w1', projectId: 'p1', seq: 1, name: 'Sơn', kind: 'bays', weight: 1, counts: true, manualProgress: 0, quantityLabel: 'Diện tích', unit: 'm²' },
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
    work: { id: 'wm', projectId: 'p1', seq: 2, name: 'Marking', kind: 'manual', weight: 0, counts: false, manualProgress: 0.2, quantityLabel: 'Diện tích', unit: 'm²' },
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
  listDecks.mockReset()
  // Another project's decks, read only while it is the DRAFT project (FLT-02).
  listDecks.mockResolvedValue([{ id: 'd9', name: 'Sàn Z' }])
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

/** The one filter bar under the title (FLT-01). */
const bar = () => screen.getByRole('search', { name: 'Bộ lọc' })
const before = (a: Element, b: Element) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0

describe('KpiScreen — one filter bar (FLT-01)', () => {
  it('holds Dự án, Sàn and Công đoạn in one bar under the title, in that order, unlabelled', async () => {
    renderAdmin()
    await screen.findByTestId('kpi-dashboard')
    const project = within(bar()).getByRole('combobox', { name: 'Dự án' })
    const deck = within(bar()).getByRole('combobox', { name: 'Sàn' })
    const coat = within(bar()).getByRole('combobox', { name: 'Công đoạn' })
    expect(before(project, deck) && before(deck, coat)).toBe(true)
    expect(bar().querySelector('label')).toBeNull()
  })

  it('narrows the chart by the deck picked in the bar, once Tìm is pressed (FLT-02)', async () => {
    renderAdmin()
    await screen.findByTestId('kpi-dashboard')
    await userEvent.click(within(bar()).getByRole('combobox', { name: 'Sàn' }))
    await userEvent.click(await screen.findByTitle('Sàn A'))
    expect(screen.getByText(/PHẠM VI tất cả\/tất cả/)).toBeInTheDocument()
    await userEvent.click(within(bar()).getByRole('button', { name: 'Tìm' }))
    expect(await screen.findByText(/PHẠM VI d1\/tất cả/)).toBeInTheDocument()
  })

  it('queries nothing while two filters change, then exactly once on Tìm (FLT-02)', async () => {
    renderAdmin()
    await screen.findByTestId('kpi-dashboard')
    await userEvent.click(within(bar()).getByRole('combobox', { name: 'Sàn' }))
    await userEvent.click(await screen.findByTitle('Sàn A'))
    await userEvent.click(within(bar()).getByRole('combobox', { name: 'Dự án' }))
    await userEvent.click(await screen.findByTitle('Giàn B (GB)'))
    expect(loadProjectModel).toHaveBeenCalledTimes(1)
    expect(listProjectEvents).toHaveBeenCalledTimes(1)
    await userEvent.click(within(bar()).getByRole('button', { name: 'Tìm' }))
    await waitFor(() => expect(loadProjectModel).toHaveBeenCalledTimes(2))
    expect(loadProjectModel).toHaveBeenLastCalledWith('p2')
    expect(listProjectEvents).toHaveBeenCalledTimes(2)
  })

  it('offers the draft project\'s decks, and drops a draft deck that project does not have (FLT-02)', async () => {
    renderAdmin()
    await screen.findByTestId('kpi-dashboard')
    await userEvent.click(within(bar()).getByRole('combobox', { name: 'Sàn' }))
    await userEvent.click(await screen.findByTitle('Sàn A'))
    await userEvent.click(within(bar()).getByRole('combobox', { name: 'Dự án' }))
    await userEvent.click(await screen.findByTitle('Giàn B (GB)'))
    await waitFor(() => expect(listDecks).toHaveBeenCalledWith('p2'))
    await waitFor(() => expect(within(bar()).getByTitle('Tất cả sàn')).toBeInTheDocument())
    await userEvent.click(within(bar()).getByRole('combobox', { name: 'Sàn' }))
    expect(await screen.findByTitle('Sàn Z')).toBeInTheDocument()
  })

  it('puts the defaults back and applies them on Đặt lại (FLT-02)', async () => {
    renderAdmin()
    await screen.findByTestId('kpi-dashboard')
    await userEvent.click(within(bar()).getByRole('combobox', { name: 'Sàn' }))
    await userEvent.click(await screen.findByTitle('Sàn A'))
    await userEvent.click(within(bar()).getByRole('button', { name: 'Tìm' }))
    expect(await screen.findByText(/PHẠM VI d1\/tất cả/)).toBeInTheDocument()
    await userEvent.click(within(bar()).getByRole('button', { name: 'Đặt lại' }))
    expect(await screen.findByText(/PHẠM VI tất cả\/tất cả/)).toBeInTheDocument()
  })

  it('holds the field\'s draft until Tìm too (FLT-02)', async () => {
    renderField()
    await screen.findByTestId('kpi-dashboard')
    await userEvent.click(within(bar()).getByRole('combobox', { name: 'Sàn' }))
    await userEvent.click(await screen.findByTitle('Sàn A'))
    expect(screen.getByText(/PHẠM VI tất cả\/tất cả/)).toBeInTheDocument()
    await userEvent.click(within(bar()).getByRole('button', { name: 'Tìm' }))
    expect(await screen.findByText(/PHẠM VI d1\/tất cả/)).toBeInTheDocument()
  })

  it('gives the field the same bar without a project select (GS-04)', async () => {
    renderField()
    await screen.findByTestId('kpi-dashboard')
    expect(within(bar()).queryByRole('combobox', { name: 'Dự án' })).toBeNull()
    expect(within(bar()).getByRole('combobox', { name: 'Sàn' })).toBeInTheDocument()
    expect(within(bar()).getByRole('combobox', { name: 'Công đoạn' })).toBeInTheDocument()
  })
})

describe('KpiScreen (admin)', () => {
  it('opens on the first project and makes its three reads', async () => {
    renderAdmin()
    await screen.findByTestId('kpi-dashboard')
    expect(loadProjectModel).toHaveBeenCalledWith('p1')
    expect(listProjectEvents).toHaveBeenCalledWith('p1')
    expect(listStagePlans).toHaveBeenCalledWith('p1')
    // No subtitle: the card title and the Dự án select say it (CPY-01, CPY-03).
    expect(pageSubtitle()).toBeNull()
    expect(screen.queryByText(/kế hoạch so với thực hiện theo ngày/)).toBeNull()
  })

  it('tells the admin, and only the admin, where the plan is entered when the chart is empty (CPY-01)', async () => {
    renderAdmin()
    const chart = await screen.findByTestId('kpi-dashboard')
    expect(chart.textContent).toContain('GỢI Ý Admin nhập kế hoạch ở bảng Kế hoạch KPI theo công đoạn.')
    expect(chart.textContent).not.toContain('Biểu đồ vẽ theo')
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
  // RV6-28 -- the per-deck colour table, under the plan table
  // ---------------------------------------------------------------------

  it('hands the colour table every deck with its stored colours, under the chart and the plan table', async () => {
    // UX-01: the chart is the reason for the screen and goes first; the plan
    // table (20+ rows) and the colour table go under it.
    renderAdmin()
    const colors = await screen.findByTestId('deck-color-table')
    expect(colors.textContent).toContain('MÀU Sàn A=#aaaaaa/-')
    const table = screen.getByTestId('plan-table')
    const chart = screen.getByTestId('kpi-dashboard')
    expect(chart.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(table.compareDocumentPosition(colors) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
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

  it('gives the field chart no empty-state hint: the title is enough there (CPY-01)', async () => {
    renderField()
    const chart = await screen.findByTestId('kpi-dashboard')
    expect(chart.textContent).not.toContain('GỢI Ý')
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

describe('KpiScreen: the work\'s quantity and unit (RV6-35)', () => {
  it('hands each coat its work\'s quantity label and unit to the table and the chart', async () => {
    loadProjectModel.mockResolvedValue({
      ...MODEL,
      models: [{ ...MODELS[0], work: { ...MODELS[0].work, quantityLabel: 'Khối lượng', unit: 'tấn' } }, MODELS[1]],
    })
    renderAdmin()
    const table = await screen.findByTestId('plan-table')
    expect(table).toHaveTextContent('Lớp 1(đã có)=500 đv=Khối lượng/tấn')
    expect(screen.getByTestId('kpi-dashboard')).toHaveTextContent('đv=tấn')
  })
})
