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

const renderDash = (entries = ENTRIES) =>
  render(<KpiDashboard entries={entries} decks={DECKS} />)

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

  it('says that a correction moves its area to the day of the correction', () => {
    // RV5-25's consequence: a past day's Actual can change. Unlike every other
    // m² figure in the product, so it is said on the screen.
    renderDash()
    const note = screen.getByTestId('kpi-correction-note')
    expect(note).toHaveTextContent(/lần cập nhật SAU CÙNG/)
    expect(note).toHaveTextContent(/ngày đã qua có thể thay đổi/)
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
})
