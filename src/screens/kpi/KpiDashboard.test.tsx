import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { KpiDay } from '../../domain/kpi'
import { useState } from 'react'
import { FilterBar } from '../../components/FilterBar'
import { keyFactTexts } from '../../test/copy'
import { KpiDashboard, type KpiEntry } from './KpiDashboard'
import { KpiFilterControls } from './KpiFilterControls'
import { DEFAULT_KPI_FILTERS, kpiCoatOptions } from './kpiFilters'

// jsdom gives Recharts no size, and the numbers the chart plots are covered in
// domain/kpi.test.ts against KPI.xlsx itself. What this file checks is which
// numbers reach the chart, so the stand-in prints them.
vi.mock('../dashboard/charts', () => ({
  KpiComboChart: ({ data, colors, unit }: { data: KpiDay[]; colors?: { plan: string | null; actual: string | null }; unit?: string }) => (
    <div data-testid="kpi-chart" data-colors={colors === undefined ? 'defaults' : `${colors.plan}/${colors.actual}`} data-unit={unit ?? ''}>
      {data.map((d) => `${d.day}:${d.planM2}/${d.actualM2}`).join(' ')}
    </div>
  ),
}))

const DECKS = [
  { id: 'd1', name: 'Sàn A', kpiPlanColor: '#123abc', kpiActualColor: null },
  { id: 'd2', name: 'Sàn B', kpiPlanColor: null, kpiActualColor: null },
]

const ENTRIES: KpiEntry[] = [
  {
    deckId: 'd1', deckName: 'Sàn A',
    plan: {
      stageId: 's1', workName: 'Sơn', stageName: 'Công đoạn 1',
      startDate: '2026-09-01', endDate: '2026-09-02', plannedAreaM2: 200,
    },
    computedAreaM2: 0,
    actual: [{ stageId: 's1', stageName: 'Công đoạn 1', day: '2026-09-01', areaM2: 100 }],
  },
  {
    deckId: 'd2', deckName: 'Sàn B',
    plan: {
      stageId: 's2', workName: 'Sơn', stageName: 'Công đoạn 2',
      startDate: '2026-09-03', endDate: '2026-09-04', plannedAreaM2: 400,
    },
    computedAreaM2: 0,
    actual: [],
  },
]

// After every day the fixtures above use, so the existing assertions below
// see the same numbers RV6-09 leaves untouched; the cutoff itself is
// exercised by its own tests further down with an earlier todayKey.
const TODAY = '2026-09-04'

/**
 * The dashboard as the screen mounts it: the filter bar the screen owns
 * (FLT-01), then the chart reading what the bar holds.
 */
function Harness({ entries, todayKey }: { entries: KpiEntry[]; todayKey: string }) {
  const [filters, setFilters] = useState(DEFAULT_KPI_FILTERS)
  const coats = kpiCoatOptions(
    entries.map((e) => ({ deckId: e.deckId, workName: e.plan.workName, stageName: e.plan.stageName })),
    filters.deckId,
  )
  return (
    <>
      <FilterBar>
        <KpiFilterControls decks={DECKS} coats={coats} value={filters} onChange={setFilters} />
      </FilterBar>
      <KpiDashboard entries={entries} decks={DECKS} todayKey={todayKey} filters={filters} />
    </>
  )
}

const renderDash = (entries = ENTRIES, todayKey = TODAY) =>
  render(<Harness entries={entries} todayKey={todayKey} />)

const chart = () => screen.getByTestId('kpi-chart')

describe('KpiDashboard — empty chart (CPY-01)', () => {
  it('shows the title alone by default', () => {
    render(<KpiDashboard entries={[]} decks={DECKS} todayKey={TODAY} filters={DEFAULT_KPI_FILTERS} />)
    expect(screen.getByText('Chưa có kế hoạch KPI nào trong phạm vi này')).toBeInTheDocument()
    expect(screen.queryByText(/Biểu đồ vẽ theo/)).toBeNull()
  })

  it('adds the hint it is given', () => {
    render(<KpiDashboard entries={[]} decks={DECKS} todayKey={TODAY} filters={DEFAULT_KPI_FILTERS} emptyDescription="Gợi ý thử" />)
    expect(screen.getByText('Gợi ý thử')).toBeInTheDocument()
  })
})

/**
 * antd Select: open it by its combobox role, then pick the option by title.
 * `getByRole('combobox', { name })` and not `getByLabelText`, which antd's
 * Select answers with more than one node -- the same query
 * ProductivityDashboard.test.tsx uses on its own Sàn picker.
 */
const combobox = (name: string) => screen.getByRole('combobox', { name })
const pick = async (name: string, option: string) => {
  await userEvent.click(combobox(name))
  await userEvent.click(await screen.findByTitle(option))
}

describe('KpiDashboard', () => {
  it('plots every planned coat of the project by default', () => {
    renderDash()
    // 200 m² over two days is 100/day; 400 over two more is 200/day.
    expect(chart()).toHaveTextContent(
      '2026-09-01:100/100 2026-09-02:100/0 2026-09-03:200/0 2026-09-04:200/0',
    )
  })

  it('narrows the series to one deck', async () => {
    // RV5-27: readable at project, deck or coat level.
    renderDash()
    await pick('Sàn', 'Sàn A')
    await waitFor(() => expect(chart()).toHaveTextContent('2026-09-01:100/100 2026-09-02:100/0'))
    expect(chart()).not.toHaveTextContent('2026-09-03')
  })

  it('narrows the series to one coat', async () => {
    renderDash()
    await pick('Công đoạn', 'Công đoạn 2')
    await waitFor(() => expect(chart()).toHaveTextContent('2026-09-03:200/0 2026-09-04:200/0'))
    expect(chart()).not.toHaveTextContent('2026-09-01')
  })

  it('offers only the coats the chosen deck has', async () => {
    renderDash()
    await pick('Sàn', 'Sàn B')
    await userEvent.click(combobox('Công đoạn'))
    expect(await screen.findByTitle('Công đoạn 2')).toBeInTheDocument()
    expect(screen.queryByTitle('Công đoạn 1')).toBeNull()
  })

  it('drops a coat selection that the newly chosen deck does not have', async () => {
    // Otherwise the filter narrows to nothing and the empty state reads as
    // "this deck has no plan", which is a different and wrong statement.
    renderDash()
    await pick('Công đoạn', 'Công đoạn 1')
    await waitFor(() => expect(chart()).not.toHaveTextContent('2026-09-03'))

    await pick('Sàn', 'Sàn B')
    await waitFor(() => expect(chart()).toHaveTextContent('2026-09-03:200/0'))
  })

  it('renders an empty state rather than an axis with no data', () => {
    renderDash([])
    expect(screen.queryByTestId('kpi-chart')).toBeNull()
    expect(screen.getByText(/chưa có kế hoạch kpi nào/i)).toBeInTheDocument()
  })

  it('no longer shows the correction note (RV6-07)', () => {
    // The explanation moved to the Notion spec only.
    renderDash()
    expect(screen.queryByTestId('kpi-correction-note')).toBeNull()
  })

  it('totals the planned and the actual area in the card header', () => {
    renderDash()
    expect(keyFactTexts().slice(1)).toEqual(['kế hoạch 600,00 m²', 'thực hiện 100,00 m²'])
  })

  it('labels a coat with its work when more than one work is in view', async () => {
    // RV5-18: two works over one deck may carry identically-named coats, and
    // the picker must not read as if there were only one.
    renderDash([
      ENTRIES[0],
      {
        ...ENTRIES[0],
        plan: { ...ENTRIES[0].plan, stageId: 's3', workName: 'Tháo giáo' },
        actual: [],
      },
    ])
    await userEvent.click(combobox('Công đoạn'))
    expect(await screen.findByTitle('Sơn · Công đoạn 1')).toBeInTheDocument()
    expect(await screen.findByTitle('Tháo giáo · Công đoạn 1')).toBeInTheDocument()
  })

  // ---------------------------------------------------------------------
  // RV6-08, withdrawn by R5-C4 — no caption under the chart
  // ---------------------------------------------------------------------

  describe('no caption under the chart (R5-C4)', () => {
    // The filter bar above already says which deck and which coat the chart
    // is scoped to; a caption repeating it is a second copy to read.
    it('prints no "Tất cả sàn" under the chart with every deck in view', () => {
      renderDash()
      expect(chart()).toBeInTheDocument()
      expect(screen.queryByTestId('kpi-chart-title')).toBeNull()
      expect(screen.queryByText(/^Tất cả sàn/, { selector: 'p' })).toBeNull()
    })

    it('prints no deck name or coat label under it when one of each is chosen', async () => {
      renderDash()
      await pick('Sàn', 'Sàn A')
      await pick('Công đoạn', 'Công đoạn 1')
      await waitFor(() => expect(chart()).toHaveAttribute('data-colors', '#123abc/null'))
      expect(screen.queryByTestId('kpi-chart-title')).toBeNull()
      expect(screen.queryByText(/Sàn A — Công đoạn 1/)).toBeNull()
      expect(screen.queryByText('Sàn A', { selector: 'p' })).toBeNull()
    })
  })

  // ---------------------------------------------------------------------
  // RV6-29 — the selected deck's colours reach the chart
  // ---------------------------------------------------------------------

  describe('deck colours (RV6-29)', () => {
    it('hands the chart no colours under "Tất cả sàn", so it paints its defaults', () => {
      renderDash()
      expect(chart()).toHaveAttribute('data-colors', 'defaults')
    })

    it('hands the chart the chosen deck\'s stored colours', async () => {
      renderDash()
      await pick('Sàn', 'Sàn A')
      await waitFor(() => expect(chart()).toHaveAttribute('data-colors', '#123abc/null'))
    })

    it('hands the chart nulls for a deck with no stored colour, which is the default too', async () => {
      renderDash()
      await pick('Sàn', 'Sàn B')
      await waitFor(() => expect(chart()).toHaveAttribute('data-colors', 'null/null'))
    })

    it('returns to the defaults when every deck is back in view', async () => {
      renderDash()
      await pick('Sàn', 'Sàn A')
      await waitFor(() => expect(chart()).toHaveAttribute('data-colors', '#123abc/null'))
      await pick('Sàn', 'Tất cả sàn')
      await waitFor(() => expect(chart()).toHaveAttribute('data-colors', 'defaults'))
    })
  })

  // ---------------------------------------------------------------------
  // RV6-09 — cumulative actual stops today
  // ---------------------------------------------------------------------

  it('ignores the days kpiSeries nulls out of actualM2 when totalling the header', () => {
    // Sàn B's coat runs to 2026-09-04, but todayKey stops at 2026-09-03: its
    // 2026-09-04 day is null, and the header total must not read it as 0 lost
    // out of a real number either -- it is simply not summed.
    renderDash(ENTRIES, '2026-09-03')
    expect(keyFactTexts().slice(1)).toEqual(['kế hoạch 600,00 m²', 'thực hiện 100,00 m²'])
  })
})

describe('KpiDashboard: the work\'s unit (RV6-35)', () => {
  it('sums and charts in the one unit the scoped coats share', () => {
    renderDash(ENTRIES.map((e) => ({ ...e, unit: 'tấn' })))
    expect(keyFactTexts().slice(1)).toEqual(['kế hoạch 600,00 tấn', 'thực hiện 100,00 tấn'])
    expect(chart()).toHaveAttribute('data-unit', 'tấn')
  })

  it('reads m² for entries that carry no unit, as every work did before 0036', () => {
    renderDash()
    expect(chart()).toHaveAttribute('data-unit', 'm²')
  })
})

describe('KpiDashboard: coats of different units under Tất cả công đoạn (RV6-36)', () => {
  it('refuses to sum across units and charts under Số lượng', async () => {
    renderDash([{ ...ENTRIES[0], unit: 'm²' }, { ...ENTRIES[1], unit: 'tấn' }])
    expect(keyFactTexts()).toEqual(['2 công đoạn', 'kế hoạch -', 'thực hiện -'])
    expect(chart()).toHaveAttribute('data-unit', 'Số lượng')
    // Why there is no sum: a (?) on the facts, not a sentence (HLT-01).
    await userEvent.hover(screen.getByRole('img', { name: 'Các sàn dùng đơn vị khác nhau, không cộng được' }))
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Các sàn dùng đơn vị khác nhau, không cộng được')
    // Narrowed to one coat, the sum and the unit are that coat's again.
    await pick('Công đoạn', 'Công đoạn 2')
    await waitFor(() => expect(keyFactTexts()).toEqual(['1 công đoạn', 'kế hoạch 400,00 tấn', 'thực hiện 0,00 tấn']))
    expect(chart()).toHaveAttribute('data-unit', 'tấn')
  })

  it('filters the Sàn options by what the user types, tones ignored (UI-02)', async () => {
    renderDash()
    await userEvent.click(combobox('Sàn'))
    expect(await screen.findByTitle('Sàn A')).toBeInTheDocument()
    await userEvent.type(combobox('Sàn'), 'san b')
    expect(await screen.findByTitle('Sàn B')).toBeInTheDocument()
    // The option list only; the closed picker still shows its own value.
    const shown = () => Array.from(document.querySelectorAll('.ant-select-item-option')).map((el) => el.getAttribute('title'))
    expect(shown()).toEqual(['Sàn B'])
  })
})
