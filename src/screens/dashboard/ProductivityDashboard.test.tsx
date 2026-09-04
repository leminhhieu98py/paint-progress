import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { EMPTY_EFFORT, type DeckEvent, type Effort, type WorkModel } from '../../domain/types'
import { ProductivityDashboard } from './ProductivityDashboard'

// jsdom gives Recharts no size; the numbers the charts plot are covered in
// domain/effort.test.ts, and the wrappers are what this file checks for.
vi.mock('./charts', () => ({
  EfficiencyLineChart: ({ stages }: { stages: { name: string }[] }) => (
    <div data-testid="efficiency-chart">{stages.map((s) => s.name).join(',')}</div>
  ),
  HoursBarChart: () => <div data-testid="hours-chart" />,
}))

let nextId = 1
const ev = (over: Partial<Omit<DeckEvent, 'effort'>> & { effort?: Partial<Effort> } = {}): DeckEvent => ({
  id: nextId++, deckName: 'Sàn A', cellCode: 'R1C1', cellAreaM2: 100, workName: 'Sơn', toStageName: 'Lớp 1',
  at: '2026-09-01T03:00:00Z', byId: 'u1', note: '', reportNote: null, reportHidden: false,
  effortEditedAt: null, effortEditedByName: null,
  ...over,
  effort: { ...EMPTY_EFFORT, ...(over.effort ?? {}) },
})

const EVENTS: DeckEvent[] = [
  ev({ deckName: 'Sàn A', cellAreaM2: 100, toStageName: 'Lớp 1', at: '2026-09-01T03:00:00Z',
       effort: { leadName: 'Tổ 1', workHours: 120, wasteHours: 3, wasteReason: 'Mưa' } }),
  ev({ deckName: 'Sàn A', cellCode: 'R1C2', cellAreaM2: 100, toStageName: 'Lớp 2', at: '2026-09-01T03:00:00Z',
       effort: { leadName: 'Tổ 1', workHours: 110 } }),
  ev({ deckName: 'Sàn B', cellAreaM2: 200, toStageName: 'Lớp 1', at: '2026-09-02T03:00:00Z',
       effort: { leadName: 'Tổ 2', workHours: 220, wasteHours: 1, wasteReason: 'Chờ vật tư' } }),
  // Written before hours existed: counted as an update, in no ratio.
  ev({ deckName: 'Sàn A', cellCode: 'R2C1', cellAreaM2: 50, toStageName: 'Lớp 1', at: '2026-09-03T03:00:00Z' }),
  // Another work: shown only when that work is picked.
  ev({ deckName: 'Sàn A', workName: 'Tháo giáo', toStageName: 'Tháo', at: '2026-09-02T03:00:00Z',
       effort: { workHours: 10 } }),
]

const stage = (id: string, seq: number, name: string, color: string) => ({ id, seq, name, color, weight: 0.5 })
const deck = (id: string, name: string) => ({ id, code: id.toUpperCase(), name, totalAreaM2: 1000, cells: [] })
const MODELS: WorkModel[] = [
  {
    work: { id: 'w1', projectId: 'p1', seq: 1, name: 'Sơn', kind: 'bays', weight: 0.8, counts: true, manualProgress: 0 },
    decks: [
      { deck: deck('d1', 'Sàn A'), weight: 0.5, stages: [stage('s1', 1, 'Lớp 1', '#111111'), stage('s2', 2, 'Lớp 2', '#222222')] },
      { deck: deck('d2', 'Sàn B'), weight: 0.5, stages: [stage('s3', 1, 'Lớp 1', '#111111'), stage('s4', 2, 'Lớp 2', '#222222')] },
    ],
  },
  {
    work: { id: 'w2', projectId: 'p1', seq: 2, name: 'Tháo giáo', kind: 'bays', weight: 0.2, counts: true, manualProgress: 0 },
    decks: [{ deck: deck('d1', 'Sàn A'), weight: 1, stages: [stage('t1', 1, 'Tháo', '#333333')] }],
  },
]
const DECKS = [{ id: 'd1', name: 'Sàn A' }, { id: 'd2', name: 'Sàn B' }]

const renderDashboard = (events = EVENTS) =>
  render(<ProductivityDashboard events={events} models={MODELS} decks={DECKS} />)

const cards = () => within(screen.getByTestId('dashboard-cards'))
const stageRows = () => within(screen.getByTestId('stage-table')).getAllByRole('row').slice(1)

describe('ProductivityDashboard', () => {
  it('sums the first work\'s hours, area, overall ratio and lost hours into the cards', () => {
    renderDashboard()
    expect(cards().getByText('450,0')).toBeInTheDocument()
    expect(cards().getByText('400,00')).toBeInTheDocument()
    // 450 / 400. Labelled as total over total, since it is not the daily mean.
    expect(cards().getByText('1,125')).toBeInTheDocument()
    expect(cards().getByText('4,0')).toBeInTheDocument()
    // 4 of 454.
    expect(cards().getByText('0,88% tổng giờ')).toBeInTheDocument()
  })

  it('says how much of the history the ratios stand on', () => {
    renderDashboard()
    expect(screen.getByTestId('dashboard-coverage')).toHaveTextContent(
      '3 / 4 lần cập nhật có ghi giờ công. Các lần chưa ghi không tính vào hiệu suất.',
    )
  })

  it('lists each stage with the workbook\'s figures, in seq order', () => {
    renderDashboard()
    const [lop1, lop2] = stageRows()
    // Lớp 1: 120/100 on 01/09 and 220/200 on 02/09 -> mean 1,150; 340 Mhr over 2 days.
    expect(within(lop1).getByText('Lớp 1')).toBeInTheDocument()
    expect(within(lop1).getByText('2')).toBeInTheDocument()
    expect(within(lop1).getByText('340,0')).toBeInTheDocument()
    expect(within(lop1).getByText('300,00')).toBeInTheDocument()
    expect(within(lop1).getByText('1,150')).toBeInTheDocument()
    expect(within(lop1).getByText('170,0')).toBeInTheDocument()
    expect(within(lop1).getByText('4,0')).toBeInTheDocument()
    expect(within(lop2).getByText('Lớp 2')).toBeInTheDocument()
    expect(within(lop2).getByText('1,100')).toBeInTheDocument()
    // 110 Mhr in one day: the total and the daily mean are the same figure.
    expect(within(lop2).getAllByText('110,0')).toHaveLength(2)
  })

  it('hands the line chart the work\'s stages in order, with the drawing\'s colours', () => {
    renderDashboard()
    expect(screen.getByTestId('efficiency-chart')).toHaveTextContent('Lớp 1,Lớp 2')
    expect(screen.getByTestId('hours-chart')).toBeInTheDocument()
  })

  it('groups by crew and by reason, naming the blanks', () => {
    renderDashboard()
    const leads = within(screen.getByTestId('lead-table')).getAllByRole('row').slice(1)
    expect(within(leads[0]).getByText('Tổ 1')).toBeInTheDocument()
    expect(within(leads[0]).getByText('230,0')).toBeInTheDocument()
    expect(within(leads[0]).getByText('1,150')).toBeInTheDocument()
    expect(within(leads[1]).getByText('Tổ 2')).toBeInTheDocument()
    expect(within(leads[2]).getByText('Chưa ghi')).toBeInTheDocument()
    expect(within(leads[2]).getByText('—')).toBeInTheDocument()

    const reasons = within(screen.getByTestId('waste-table')).getAllByRole('row').slice(1)
    expect(within(reasons[0]).getByText('Mưa')).toBeInTheDocument()
    expect(within(reasons[0]).getByText('3,0')).toBeInTheDocument()
    expect(within(reasons[1]).getByText('Chờ vật tư')).toBeInTheDocument()
  })

  it('narrows everything to one deck', async () => {
    renderDashboard()
    await userEvent.click(screen.getByRole('combobox', { name: 'Sàn' }))
    await userEvent.click(await screen.findByTitle('Sàn B'))
    expect(cards().getByText('220,0')).toBeInTheDocument()
    expect(screen.getByTestId('dashboard-coverage')).toHaveTextContent('1 / 1 lần cập nhật')
    expect(stageRows()).toHaveLength(1)
  })

  it('switches work, and shows the work picker only because there are two', async () => {
    renderDashboard()
    await userEvent.click(screen.getByText('Tháo giáo'))
    expect(cards().getByText('10,0')).toBeInTheDocument()
    expect(screen.getByTestId('efficiency-chart')).toHaveTextContent('Tháo')
  })

  it('explains what to do when nobody has recorded hours yet', () => {
    renderDashboard([ev(), ev({ id: 99 })])
    expect(screen.getByText('Chưa có giờ công nào được ghi')).toBeInTheDocument()
    expect(screen.queryByTestId('dashboard-cards')).toBeNull()
  })
})
