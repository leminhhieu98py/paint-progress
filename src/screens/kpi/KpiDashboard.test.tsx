import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { KpiDay } from '../../domain/kpi'
import { KpiDashboard, type KpiEntry } from './KpiDashboard'

// jsdom gives Recharts no size, and the numbers the chart plots are covered in
// domain/kpi.test.ts against KPI.xlsx itself. What this file checks is which
// numbers reach the chart, so the stand-in prints them.
vi.mock('../dashboard/charts', () => ({
  KpiComboChart: ({ data }: { data: KpiDay[] }) => (
    <div data-testid="kpi-chart">
      {data.map((d) => `${d.day}:${d.planM2}/${d.actualM2}`).join(' ')}
    </div>
  ),
}))

const DECKS = [{ id: 'd1', name: 'Sàn A' }, { id: 'd2', name: 'Sàn B' }]

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

const renderDash = (entries = ENTRIES, todayKey = TODAY) =>
  render(<KpiDashboard entries={entries} decks={DECKS} todayKey={todayKey} />)

const chart = () => screen.getByTestId('kpi-chart')

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
    expect(screen.getByText(/kế hoạch 600,00 m² · thực hiện 100,00 m²/)).toBeInTheDocument()
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
  // RV6-08 — the chart title under the legend
  // ---------------------------------------------------------------------

  describe('the chart title (RV6-08)', () => {
    const title = () => screen.getByTestId('kpi-chart-title')

    it('reads the deck name and the coat label when both are chosen', async () => {
      renderDash()
      await pick('Sàn', 'Sàn A')
      await pick('Công đoạn', 'Công đoạn 1')
      await waitFor(() => expect(title()).toHaveTextContent('Sàn A — Công đoạn 1'))
    })

    it('reads only the deck name when no coat is chosen', async () => {
      renderDash()
      await pick('Sàn', 'Sàn A')
      expect(title()).toHaveTextContent('Sàn A')
    })

    it('reads "Tất cả sàn" plus the coat label when every deck is in view', async () => {
      renderDash()
      await pick('Công đoạn', 'Công đoạn 2')
      await waitFor(() => expect(title()).toHaveTextContent('Tất cả sàn — Công đoạn 2'))
    })

    it('reads plain "Tất cả sàn" with nothing chosen', () => {
      renderDash()
      expect(title()).toHaveTextContent('Tất cả sàn')
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
    expect(screen.getByText(/kế hoạch 600,00 m² · thực hiện 100,00 m²/)).toBeInTheDocument()
  })
})
