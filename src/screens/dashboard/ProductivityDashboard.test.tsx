import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { EMPTY_EFFORT, type DeckEvent, type Effort, type WorkModel } from '../../domain/types'
import { ProductivityDashboard } from './ProductivityDashboard'

// jsdom gives Recharts no size; the numbers the charts plot are covered in
// domain/effort.test.ts, and the wrappers are what this file checks for.
vi.mock('./charts', () => ({
  EfficiencyLineChart: ({ data, stages }: { data: { day: string }[]; stages: { name: string }[] }) => (
    <div data-testid="efficiency-chart" data-days={data.map((d) => d.day).join(',')}>
      {stages.map((s) => s.name).join(',')}
    </div>
  ),
  HoursBarChart: ({ data }: { data: { day: string }[] }) => (
    <div data-testid="hours-chart" data-days={data.map((d) => d.day).join(',')} />
  ),
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
/** 1.000 m² with one 400 m² bay already at Lớp 1, so Lớp 2 has 1.000 m² left. */
const deck = (id: string, name: string) => ({
  id,
  code: id.toUpperCase(),
  name,
  totalAreaM2: 1000,
  cells: [{ id: `${id}-c1`, code: 'R1C1', x: 0, y: 0, w: 1, h: 1, areaM2: 400, stageId: `${id}-s1`, note: '' }],
})
const MODELS: WorkModel[] = [
  {
    work: { id: 'w1', projectId: 'p1', seq: 1, name: 'Sơn', kind: 'bays', weight: 0.8, counts: true, manualProgress: 0, quantityLabel: 'Diện tích', unit: 'm²' },
    decks: [
      { deck: deck('d1', 'Sàn A'), weight: 0.5, stages: [stage('s1', 1, 'Lớp 1', '#111111'), stage('s2', 2, 'Lớp 2', '#222222')] },
      { deck: deck('d2', 'Sàn B'), weight: 0.5, stages: [stage('s3', 1, 'Lớp 1', '#111111'), stage('s4', 2, 'Lớp 2', '#222222')] },
    ],
  },
  {
    work: { id: 'w2', projectId: 'p1', seq: 2, name: 'Tháo giáo', kind: 'bays', weight: 0.2, counts: true, manualProgress: 0, quantityLabel: 'Diện tích', unit: 'm²' },
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

  it('plots both day charts over every calendar day from the first to the last (QA F4)', () => {
    // Work on 01/09 and 04/09 only: the axis still runs 01, 02, 03, 04 rather
    // than putting the two worked days side by side.
    renderDashboard([
      ev({ at: '2026-09-01T03:00:00Z', effort: { workHours: 100 } }),
      ev({ cellCode: 'R1C2', at: '2026-09-04T03:00:00Z', effort: { workHours: 100 } }),
    ])
    const days = '2026-09-01,2026-09-02,2026-09-03,2026-09-04'
    expect(screen.getByTestId('efficiency-chart')).toHaveAttribute('data-days', days)
    expect(screen.getByTestId('hours-chart')).toHaveAttribute('data-days', days)
  })

  it('groups by crew and by reason, naming the blank reason', () => {
    renderDashboard()
    const leads = within(screen.getByTestId('lead-table')).getAllByRole('row').slice(1)
    expect(within(leads[0]).getByText('Tổ 1')).toBeInTheDocument()
    expect(within(leads[0]).getByText('230,0')).toBeInTheDocument()
    expect(within(leads[0]).getByText('1,150')).toBeInTheDocument()
    expect(within(leads[1]).getByText('Tổ 2')).toBeInTheDocument()

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

describe('ProductivityDashboard — the placeholder rows (Feedback Rv5, item 5)', () => {
  const leadRows = () => within(screen.getByTestId('lead-table')).getAllByRole('row').slice(1)
  /** A bay sent back to nothing: no coat, so dailyEffort files it under
   *  'Chưa bắt đầu'. The fixture already holds an update with no lead name. */
  const sentBack = (effort: Partial<Effort> = {}) =>
    ev({ deckName: 'Sàn A', cellCode: 'R3C1', cellAreaM2: 50, toStageName: null,
         at: '2026-09-04T03:00:00Z', effort })

  it('leaves "Chưa bắt đầu" out of the stage table and the daily chart', () => {
    // It is a placeholder, not a công đoạn, and this screen's subject is
    // efficiency per coat.
    renderDashboard([...EVENTS, sentBack()])
    expect(within(screen.getByTestId('stage-table')).queryByText('Chưa bắt đầu')).toBeNull()
    expect(stageRows()).toHaveLength(2)
    expect(screen.getByTestId('efficiency-chart')).toHaveTextContent('Lớp 1,Lớp 2')
  })

  it('leaves the unnamed crew out of Theo nhóm trưởng', () => {
    // 442 updates at 0 Mhr and 0 m² under "Chưa ghi" -- not a nhóm trưởng.
    renderDashboard()
    expect(within(screen.getByTestId('lead-table')).queryByText('Chưa ghi')).toBeNull()
    expect(leadRows()).toHaveLength(2)
  })

  it('leaves a placeholder\'s hours out of the totals too, so the cards match the columns', () => {
    // RV5-31, replacing RV5-10. Linh identified hours on this bucket as a
    // mis-entry ("User cập nhật nhầm. Có công đoạn mới có giờ công."), so the
    // cards no longer read 500,0 over a table summing to 450,0.
    //
    // Concrete figures, not a sum recomputed the way the component does it:
    // Lớp 1 is 340 Mhr / 300 m² and Lớp 2 is 110 Mhr / 100 m², and the 50 Mhr,
    // 50 m² and 2 hao phí on the placeholder appear in none of the four.
    renderDashboard([...EVENTS, sentBack({ leadName: 'Tổ 1', workHours: 50, wasteHours: 2 })])
    expect(cards().getByText('450,0')).toBeInTheDocument()             // Tổng Mhr, not 500,0
    expect(cards().getByText('400,00')).toBeInTheDocument()            // Tổng m², not 450,00
    expect(cards().getByText('1,125')).toBeInTheDocument()             // 450 / 400, not 500 / 450
    expect(cards().getByText('4,0')).toBeInTheDocument()               // Giờ hao phí, not 6,0
    expect(cards().getByText('0,88% tổng giờ')).toBeInTheDocument()    // 4 of 454, not 6 of 506
    expect(cards().queryByText('500,0')).toBeNull()
    expect(cards().queryByText('450,00')).toBeNull()
    expect(cards().queryByText('6,0')).toBeNull()
    expect(within(screen.getByTestId('stage-table')).queryByText('Chưa bắt đầu')).toBeNull()
  })

  it('leaves a placeholder\'s hours out of Theo nhóm trưởng too (Feedback Rv5, RV5-35)', () => {
    // Measured on dev after RV5-31 shipped: the lead table read 370,0 Mhr and
    // 280,73 m² against a header of 366,0 and 243,31. RV5-31 excluded the
    // bucket on the STAGE dimension, and this table has no stage dimension, so
    // the exclusion never reached it.
    renderDashboard([...EVENTS, sentBack({ leadName: 'Tổ 1', workHours: 50, wasteHours: 2 })])
    const rows = leadRows()
    expect(rows).toHaveLength(2)
    const t1 = within(rows[0])
    expect(t1.getByText('Tổ 1')).toBeInTheDocument()
    expect(t1.getByText('2')).toBeInTheDocument()          // two updates, not three
    expect(t1.getByText('230,0')).toBeInTheDocument()      // Tổng Mhr, not 280,0
    expect(t1.getByText('200,00')).toBeInTheDocument()     // Tổng m², not 250,00
    expect(t1.getByText('1,150')).toBeInTheDocument()      // 230 / 200, not 280 / 250
    expect(t1.getByText('3,0')).toBeInTheDocument()        // Giờ hao phí, not 5,0
  })

  it('leaves a placeholder\'s lost hours out of Lý do hao phí (Feedback Rv5, RV5-35)', () => {
    // The other table with no stage dimension: 10,0 giờ on dev against a stage
    // table summing to 9,0.
    renderDashboard([...EVENTS, sentBack({ wasteHours: 2, wasteReason: 'Mưa' })])
    const reasons = within(screen.getByTestId('waste-table')).getAllByRole('row').slice(1)
    expect(reasons).toHaveLength(2)
    expect(within(reasons[0]).getByText('Mưa')).toBeInTheDocument()
    expect(within(reasons[0]).getByText('3,0')).toBeInTheDocument()   // not 5,0
    expect(within(reasons[0]).getByText('1')).toBeInTheDocument()     // one occurrence, not two
    // And the cards still agree with the stage rows they sit above.
    expect(cards().getByText('4,0')).toBeInTheDocument()
  })

  /** The one StatCard whose label reads `label`. StatCard nests the label in a
   *  flex row inside the card, so the card is two parents up. */
  const cardByLabel = (label: string) =>
    within(cards().getByText(label).parentElement?.parentElement as HTMLElement)
  /** Whatever "today" is when the suite runs -- the day the two cards read. */
  const todayIso = new Date().toISOString()

  it('leaves a placeholder\'s hours out of the two "hôm nay" cards (Feedback Rv5, RV5-35)', () => {
    // The last reader on this screen still on the unfiltered list. Both cards
    // sit beside Tổng Mhr thực hiện, which excludes these hours, so a removal
    // typed today made the row of cards disagree with itself.
    renderDashboard([
      ...EVENTS,
      ev({ deckName: 'Sàn A', cellCode: 'R4C1', cellAreaM2: 50, toStageName: null, at: todayIso,
           effort: { leadName: 'Tổ 1', workHours: 50, wasteHours: 2 } }),
    ])
    expect(cardByLabel('Mhr thực hiện hôm nay').getByText('0,0')).toBeInTheDocument()
    expect(cardByLabel('Mhr hao phí hôm nay').getByText('0,0')).toBeInTheDocument()
    // The sibling on a real coat is still counted, so the filter has not simply
    // emptied the cards.
    expect(cards().getByText('450,0')).toBeInTheDocument()
  })

  it('still counts a coat\'s own hours today (Feedback Rv5, RV5-35)', () => {
    renderDashboard([
      ...EVENTS,
      ev({ deckName: 'Sàn A', cellCode: 'R4C1', cellAreaM2: 50, toStageName: null, at: todayIso,
           effort: { leadName: 'Tổ 1', workHours: 50, wasteHours: 2 } }),
      ev({ deckName: 'Sàn A', cellCode: 'R4C2', cellAreaM2: 40, toStageName: 'Lớp 1', at: todayIso,
           effort: { leadName: 'Tổ 1', workHours: 8, wasteHours: 1 } }),
    ])
    expect(cardByLabel('Mhr thực hiện hôm nay').getByText('8,0')).toBeInTheDocument()
    expect(cardByLabel('Mhr hao phí hôm nay').getByText('1,0')).toBeInTheDocument()
  })

  it('files a reason no coat carries under no reason at all, not under a new row', () => {
    // A removal whose hao phí reason is one nothing else used: it must not
    // appear as a row of its own either.
    renderDashboard([...EVENTS, sentBack({ wasteHours: 2, wasteReason: 'Sửa lại lớp sơn' })])
    expect(within(screen.getByTestId('waste-table')).queryByText('Sửa lại lớp sơn')).toBeNull()
  })

  it('filters the crew table by name, case- and accent-insensitively, and nothing else', async () => {
    renderDashboard()
    await userEvent.type(screen.getByRole('textbox', { name: 'Tìm nhóm trưởng' }), 'to 2')
    expect(leadRows()).toHaveLength(1)
    expect(within(leadRows()[0]).getByText('Tổ 2')).toBeInTheDocument()
    // Card only: the screen's Công việc / Sàn / date filters still govern what
    // everything, this card included, is computed from.
    expect(stageRows()).toHaveLength(2)
    expect(cards().getByText('450,0')).toBeInTheDocument()
    expect(within(screen.getByTestId('waste-table')).getAllByRole('row').slice(1)).toHaveLength(2)
  })
})

describe('ProductivityDashboard forecast (Feedback Rv2, item 13)', () => {
  it('shows today\'s hours beside the totals', () => {
    // The fixture's newest day is 03/09; "today" in the test environment is
    // whatever the clock says, so today's figures are zero and the totals are
    // not -- which is the pair Linh asked to see.
    renderDashboard()
    expect(cards().getByText('Mhr thực hiện hôm nay')).toBeInTheDocument()
    expect(cards().getByText('Mhr hao phí hôm nay')).toBeInTheDocument()
  })

  it('lists what is left on each deck of the chosen work, and its deadline', () => {
    renderDashboard()
    const table = within(screen.getByTestId('forecast-table'))
    const rows = table.getAllByRole('row').slice(1)
    expect(rows).toHaveLength(2)
    expect(within(rows[0]).getByText('Sàn A')).toBeInTheDocument()
    // No deadline on the fixture, so no date and no warning.
    expect(within(rows[0]).getAllByText('—').length).toBeGreaterThan(0)
  })

  it('narrows the forecast to the deck in the filter', async () => {
    renderDashboard()
    await userEvent.click(screen.getByRole('combobox', { name: 'Sàn' }))
    await userEvent.click(await screen.findByTitle('Sàn B'))
    const rows = within(screen.getByTestId('forecast-table')).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(1)
    expect(within(rows[0]).getByText('Sàn B')).toBeInTheDocument()
  })

  it('warns on a deck whose deadline the measured rate cannot meet', () => {
    const late = MODELS.map((m) => (m.work.name !== 'Sơn' ? m : {
      ...m,
      decks: m.decks.map((d) => (d.deck.name === 'Sàn A' ? { ...d, deadline: '2000-01-01' } : d)),
    }))
    render(<ProductivityDashboard events={EVENTS} models={late} decks={DECKS} />)
    const rows = within(screen.getByTestId('forecast-table')).getAllByRole('row').slice(1)
    expect(within(rows[0]).getByText(/Trễ \d+ ngày · thiếu/)).toBeInTheDocument()
  })
})

describe('ProductivityDashboard: the chosen work\'s unit (RV6-36)', () => {
  it('labels the totals, the tables and the efficiency figures in the chosen work\'s unit', async () => {
    const tonnes = MODELS.map((m) => (m.work.id === 'w1' ? { ...m, work: { ...m.work, quantityLabel: 'Khối lượng', unit: 'tấn' } } : m))
    render(<ProductivityDashboard events={EVENTS} models={tonnes} decks={DECKS} />)
    expect(cards().getByText('Tổng tấn đã ghi giờ công')).toBeInTheDocument()
    expect(cards().getByText('Mhr/tấn tổng thể')).toBeInTheDocument()
    const headers = within(screen.getByTestId('stage-table')).getAllByRole('columnheader').map((h) => h.textContent)
    expect(headers).toContain('Tổng tấn')
    expect(headers).toContain('Hiệu suất TB (Mhr/tấn)')
    expect(screen.queryByText(/Tổng m²/)).toBeNull()

    // Tháo giáo is still m²: switching the work switches the labels with it.
    await userEvent.click(screen.getByText('Tháo giáo'))
    await waitFor(() => expect(cards().getByText('Tổng m² đã ghi giờ công')).toBeInTheDocument())
    expect(cards().getByText('Mhr/m² tổng thể')).toBeInTheDocument()
  })
})
