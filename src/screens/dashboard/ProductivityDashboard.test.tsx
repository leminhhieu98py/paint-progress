import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EMPTY_EFFORT, type DeckEvent, type Effort, type WorkModel } from '../../domain/types'
import { useState } from 'react'
import { FilterBar } from '../../components/FilterBar'
import { DAYS_NEEDED_TIP } from '../../domain/forecast'
import { ProductivityDashboard } from './ProductivityDashboard'
import { ProductivityFilterControls } from './ProductivityFilterControls'
import { DEFAULT_PRODUCTIVITY_FILTERS, dashboardWorkNames } from './productivityFilters'
import { expectLeft } from '../../test/alignment'
import { palette } from '../../theme'
import { chooseOption } from '../../test/select'
import { setViewport } from '../../test/viewport'

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

/**
 * The dashboard as the screen mounts it: the filter bar the screen owns
 * (FLT-01), then the dashboard reading what the bar holds.
 */
function Harness({ events, models, decks }: { events: DeckEvent[]; models: WorkModel[]; decks: { name: string }[] }) {
  const [filters, setFilters] = useState(DEFAULT_PRODUCTIVITY_FILTERS)
  return (
    <>
      <FilterBar>
        <ProductivityFilterControls
          workNames={dashboardWorkNames(models, events)}
          deckNames={decks.map((d) => d.name)}
          value={filters}
          onChange={setFilters}
        />
      </FilterBar>
      <ProductivityDashboard events={events} models={models} filters={filters} />
    </>
  )
}

const renderDashboard = (events = EVENTS) =>
  render(<Harness events={events} models={MODELS} decks={DECKS} />)

const cards = () => within(screen.getByTestId('dashboard-cards'))
const stageRows = () => within(screen.getByTestId('stage-table')).getAllByRole('row').slice(1)
/** The coverage fact beside the stage table's title (HLT-01). */
const coverageFact = () => {
  const card = screen.getByRole('heading', { level: 2, name: 'Hiệu suất theo công đoạn' }).closest('section') as HTMLElement
  return within(card).getByTestId('key-fact')
}

describe('ProductivityDashboard', () => {
  it('sums the first work\'s hours, area, overall ratio and lost hours into the cards', () => {
    renderDashboard()
    expect(cards().getByText('450,00')).toBeInTheDocument()
    expect(cards().getByText('400,00')).toBeInTheDocument()
    // 450 / 400. Labelled as total over total, since it is not the daily mean.
    expect(cards().getByText('1,125')).toBeInTheDocument()
    expect(cards().getByText('4,00')).toBeInTheDocument()
    // 4 of 454.
    expect(cards().getByText('0,88% tổng giờ')).toBeInTheDocument()
    // How the overall ratio is computed is its label's (?), and no card
    // restates its label or says it follows the filters (CPY-01).
    const tip = cards().getByRole('img', { name: 'Tổng Mhr chia tổng m², khác với hiệu suất trung bình theo ngày' })
    expect(tip.parentElement).toHaveTextContent(/^Mhr\/m² tổng thể$/)
    expect(cards().queryByText('giờ công đã ghi')).toBeNull()
    expect(cards().queryByText('theo bộ lọc trên')).toBeNull()
  })

  it('says how much of the history the ratios stand on, as an amber fact beside the stage table\'s title (HLT-01)', () => {
    renderDashboard()
    const coverage = coverageFact()
    expect(coverage).toHaveTextContent(/^3 \/ 4 lần cập nhật có ghi giờ công$/)
    expect(coverage).toHaveStyle({ background: palette.warningBg, color: palette.warning })
    // What the unrecorded ones mean for the ratios, on its (?) (CPY-01).
    expect(within(coverage).getByRole('img', { name: 'Các lần chưa ghi không tính vào hiệu suất.' })).toBeInTheDocument()
    // No line of its own any more.
    expect(screen.queryByTestId('dashboard-coverage')).toBeNull()
  })

  it('explains the two computed columns on their headers, not in card summaries (CPY-01)', () => {
    renderDashboard()
    // The one wording A3.8 uses too, with no "vì" rationale (M16, RUL-01).
    const days = within(screen.getByTestId('forecast-table')).getByRole('img', { name: DAYS_NEEDED_TIP })
    expect(days.closest('th')).toHaveTextContent(/^Số ngày cần$/)
    expect(DAYS_NEEDED_TIP).not.toMatch(/(^|\s)vì\s|:/)
    const mean = within(screen.getByTestId('stage-table')).getByRole('img', { name: /trung bình cộng/ })
    expect(mean.closest('th')).toHaveTextContent(/^Hiệu suất TB \(Mhr\/m²\)$/)
    expect(screen.queryByText(/Còn lại bao nhiêu và có kịp hạn không/)).toBeNull()
    expect(screen.queryByText(/của từng công đoạn theo ngày;/)).toBeNull()
    expect(screen.queryByText('Giờ thực hiện và giờ hao phí, cộng dồn mọi công đoạn')).toBeNull()
  })

  it('lists each stage with the workbook\'s figures, in seq order', () => {
    renderDashboard()
    const [lop1, lop2] = stageRows()
    // Lớp 1: 120/100 on 01/09 and 220/200 on 02/09 -> mean 1,150; 340 Mhr over 2 days.
    expect(within(lop1).getByText('Lớp 1')).toBeInTheDocument()
    expect(within(lop1).getByText('2')).toBeInTheDocument()
    expect(within(lop1).getByText('340,00')).toBeInTheDocument()
    expect(within(lop1).getByText('300,00')).toBeInTheDocument()
    expect(within(lop1).getByText('1,150')).toBeInTheDocument()
    expect(within(lop1).getByText('170,00')).toBeInTheDocument()
    expect(within(lop1).getByText('4,00')).toBeInTheDocument()
    expect(within(lop2).getByText('Lớp 2')).toBeInTheDocument()
    expect(within(lop2).getByText('1,100')).toBeInTheDocument()
    // 110 Mhr in one day: the total and the daily mean are the same figure.
    expect(within(lop2).getAllByText('110,00')).toHaveLength(2)
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
    expect(within(leads[0]).getByText('230,00')).toBeInTheDocument()
    expect(within(leads[0]).getByText('1,150')).toBeInTheDocument()
    expect(within(leads[1]).getByText('Tổ 2')).toBeInTheDocument()

    const reasons = within(screen.getByTestId('waste-table')).getAllByRole('row').slice(1)
    expect(within(reasons[0]).getByText('Mưa')).toBeInTheDocument()
    expect(within(reasons[0]).getByText('3,00')).toBeInTheDocument()
    expect(within(reasons[1]).getByText('Chờ vật tư')).toBeInTheDocument()
  })

  it('narrows everything to one deck', async () => {
    renderDashboard()
    await userEvent.click(screen.getByRole('combobox', { name: 'Sàn' }))
    await userEvent.click(await screen.findByTitle('Sàn B'))
    expect(cards().getByText('220,00')).toBeInTheDocument()
    // Every update in scope has hours: a plain fact, nothing to explain.
    expect(coverageFact()).toHaveTextContent('1 / 1 lần cập nhật')
    expect(coverageFact()).toHaveStyle({ background: palette.bgSubtle })
    expect(within(coverageFact()).queryByRole('img')).toBeNull()
    expect(stageRows()).toHaveLength(1)
  })

  it('switches work from a searchable Công việc select, shown only because there are two (FLT-03)', async () => {
    renderDashboard()
    expect(screen.queryByRole('radiogroup')).toBeNull()
    // Searchable (UI-02): typed without the accents, the way a site tablet types.
    await userEvent.type(screen.getByRole('combobox', { name: 'Công việc' }), 'thao')
    await userEvent.click(await screen.findByTitle('Tháo giáo'))
    expect(cards().getByText('10,00')).toBeInTheDocument()
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
    expect(cards().getByText('450,00')).toBeInTheDocument()             // Tổng Mhr, not 500,0
    expect(cards().getByText('400,00')).toBeInTheDocument()            // Tổng m², not 450,00
    expect(cards().getByText('1,125')).toBeInTheDocument()             // 450 / 400, not 500 / 450
    expect(cards().getByText('4,00')).toBeInTheDocument()               // Giờ hao phí, not 6,0
    expect(cards().getByText('0,88% tổng giờ')).toBeInTheDocument()    // 4 of 454, not 6 of 506
    expect(cards().queryByText('500,00')).toBeNull()
    // Hours and m² print alike at two decimals (M11): 450,00 once, the Mhr card's.
    expect(cards().getAllByText('450,00')).toHaveLength(1)
    expect(cards().queryByText('6,00')).toBeNull()
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
    expect(t1.getByText('230,00')).toBeInTheDocument()      // Tổng Mhr, not 280,0
    expect(t1.getByText('200,00')).toBeInTheDocument()     // Tổng m², not 250,00
    expect(t1.getByText('1,150')).toBeInTheDocument()      // 230 / 200, not 280 / 250
    expect(t1.getByText('3,00')).toBeInTheDocument()        // Giờ hao phí, not 5,0
  })

  it('leaves a placeholder\'s lost hours out of Lý do hao phí (Feedback Rv5, RV5-35)', () => {
    // The other table with no stage dimension: 10,0 giờ on dev against a stage
    // table summing to 9,0.
    renderDashboard([...EVENTS, sentBack({ wasteHours: 2, wasteReason: 'Mưa' })])
    const reasons = within(screen.getByTestId('waste-table')).getAllByRole('row').slice(1)
    expect(reasons).toHaveLength(2)
    expect(within(reasons[0]).getByText('Mưa')).toBeInTheDocument()
    expect(within(reasons[0]).getByText('3,00')).toBeInTheDocument()   // not 5,0
    expect(within(reasons[0]).getByText('1')).toBeInTheDocument()     // one occurrence, not two
    // And the cards still agree with the stage rows they sit above.
    expect(cards().getByText('4,00')).toBeInTheDocument()
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
    expect(cardByLabel('Mhr thực hiện hôm nay').getByText('0,00')).toBeInTheDocument()
    expect(cardByLabel('Mhr hao phí hôm nay').getByText('0,00')).toBeInTheDocument()
    // The sibling on a real coat is still counted, so the filter has not simply
    // emptied the cards.
    expect(cards().getByText('450,00')).toBeInTheDocument()
  })

  it('still counts a coat\'s own hours today (Feedback Rv5, RV5-35)', () => {
    renderDashboard([
      ...EVENTS,
      ev({ deckName: 'Sàn A', cellCode: 'R4C1', cellAreaM2: 50, toStageName: null, at: todayIso,
           effort: { leadName: 'Tổ 1', workHours: 50, wasteHours: 2 } }),
      ev({ deckName: 'Sàn A', cellCode: 'R4C2', cellAreaM2: 40, toStageName: 'Lớp 1', at: todayIso,
           effort: { leadName: 'Tổ 1', workHours: 8, wasteHours: 1 } }),
    ])
    expect(cardByLabel('Mhr thực hiện hôm nay').getByText('8,00')).toBeInTheDocument()
    expect(cardByLabel('Mhr hao phí hôm nay').getByText('1,00')).toBeInTheDocument()
  })

  it('files a reason no coat carries under no reason at all, not under a new row', () => {
    // A removal whose hao phí reason is one nothing else used: it must not
    // appear as a row of its own either.
    renderDashboard([...EVENTS, sentBack({ wasteHours: 2, wasteReason: 'Sửa lại lớp sơn' })])
    expect(within(screen.getByTestId('waste-table')).queryByText('Sửa lại lớp sơn')).toBeNull()
  })

  it('waits for the typing to pause before it filters the crew table (FLT-08)', async () => {
    renderDashboard()
    const before = leadRows().length
    expect(before).toBeGreaterThan(1)
    fireEvent.change(screen.getByRole('textbox', { name: 'Tìm nhóm trưởng' }), { target: { value: 'to 2' } })
    // Typed, and shown in the box at once, but not yet applied to the table.
    expect(screen.getByRole('textbox', { name: 'Tìm nhóm trưởng' })).toHaveValue('to 2')
    expect(leadRows()).toHaveLength(before)
    await waitFor(() => expect(leadRows()).toHaveLength(1))
  })

  it('filters the crew table by name, case- and accent-insensitively, and nothing else', async () => {
    renderDashboard()
    await userEvent.type(screen.getByRole('textbox', { name: 'Tìm nhóm trưởng' }), 'to 2')
    // The box alone, so it applies as it changes, once the typing pauses (FLT-08).
    await waitFor(() => expect(leadRows()).toHaveLength(1))
    expect(within(leadRows()[0]).getByText('Tổ 2')).toBeInTheDocument()
    // Card only: the screen's Công việc / Sàn / date filters still govern what
    // everything, this card included, is computed from.
    expect(stageRows()).toHaveLength(2)
    expect(cards().getByText('450,00')).toBeInTheDocument()
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
    expect(within(rows[0]).getAllByText('-').length).toBeGreaterThan(0)
    // Not late: the warning cell says "-", not nothing (I7).
    const headers = table.getAllByRole('columnheader').map((th) => th.textContent)
    const warning = rows[0].querySelectorAll('td')[headers.indexOf('Cảnh báo')]
    expect(warning).toHaveTextContent(/^-$/)
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
    render(<Harness events={EVENTS} models={late} decks={DECKS} />)
    const rows = within(screen.getByTestId('forecast-table')).getAllByRole('row').slice(1)
    expect(within(rows[0]).getByText(/Trễ \d+ ngày · thiếu/)).toBeInTheDocument()
  })
})

describe('ProductivityDashboard: the chosen work\'s unit (RV6-36)', () => {
  it('labels the totals, the tables and the efficiency figures in the chosen work\'s unit', async () => {
    const tonnes = MODELS.map((m) => (m.work.id === 'w1' ? { ...m, work: { ...m.work, quantityLabel: 'Khối lượng', unit: 'tấn' } } : m))
    render(<Harness events={EVENTS} models={tonnes} decks={DECKS} />)
    expect(cards().getByText('Tổng tấn đã ghi giờ công')).toBeInTheDocument()
    expect(cards().getByText('Mhr/tấn tổng thể')).toBeInTheDocument()
    const headers = within(screen.getByTestId('stage-table')).getAllByRole('columnheader').map((h) => h.textContent)
    expect(headers).toContain('Tổng tấn')
    expect(headers).toContain('Hiệu suất TB (Mhr/tấn)')
    expect(screen.queryByText(/Tổng m²/)).toBeNull()

    // Tháo giáo is still m²: switching the work switches the labels with it.
    await chooseOption('Công việc', 'Tháo giáo')
    await waitFor(() => expect(cards().getByText('Tổng m² đã ghi giờ công')).toBeInTheDocument())
    expect(cards().getByText('Mhr/m² tổng thể')).toBeInTheDocument()
  })
})

describe('ProductivityDashboard — alignment (UI-03)', () => {
  it('keeps stage and lead names and the waste reason left and centres every figure, header included', () => {
    renderDashboard()
    const stages = within(screen.getByTestId('stage-table'))
    expectLeft(stages.getByRole('columnheader', { name: 'Công đoạn' }))
    for (const label of ['Số ngày', 'Tổng Mhr', 'Giờ hao phí']) {
      expect(stages.getByRole('columnheader', { name: label })).toHaveStyle({ textAlign: 'center' })
    }
    const [lop1] = stageRows()
    expectLeft(within(lop1).getByText('Lớp 1').closest('td'))
    expect(within(lop1).getByText('340,00').closest('td')).toHaveStyle({ textAlign: 'center' })

    const leads = within(screen.getByTestId('lead-table'))
    expectLeft(leads.getByRole('columnheader', { name: 'Nhóm trưởng' }))
    expectLeft(leads.getByText('Tổ 1').closest('td'))
    expect(leads.getByRole('columnheader', { name: 'Lần cập nhật' })).toHaveStyle({ textAlign: 'center' })

    // The reason reads as a note (UI-04 amended): plain text, left, no pill.
    const waste = within(screen.getByTestId('waste-table'))
    expectLeft(waste.getByRole('columnheader', { name: 'Lý do' }))
    // On a phone the text sits in its 160 px wrap (I5), still no pill.
    const reason = waste.getByText('Mưa').closest('td') as HTMLElement
    expect(reason).toHaveTextContent(/^Mưa$/)
    expect(reason.querySelector('.ant-tag')).toBeNull()
    expectLeft(reason)
    expect(waste.getByRole('columnheader', { name: 'Giờ' })).toHaveStyle({ textAlign: 'center' })
  })
})

describe('ProductivityDashboard — Tìm and the pagers (FLT-02)', () => {
  it('sends a paged table back to page 1 on every apply, even when no filter changed', async () => {
    // Twelve crews: Theo nhóm trưởng pages at ten.
    const crews = Array.from({ length: 12 }, (_, i) =>
      ev({ id: 500 + i, effort: { leadName: `Tổ ${i + 10}`, workHours: 10 } }))
    const events = [...EVENTS, ...crews]
    const { rerender } = render(<ProductivityDashboard events={events} models={MODELS} filters={DEFAULT_PRODUCTIVITY_FILTERS} version={1} />)
    const pager = within(screen.getByTestId('lead-table'))
    await userEvent.click(pager.getByTitle('2'))
    expect(pager.getByTitle('2')).toHaveClass('ant-pagination-item-active')
    rerender(<ProductivityDashboard events={events} models={MODELS} filters={DEFAULT_PRODUCTIVITY_FILTERS} version={2} />)
    expect(within(screen.getByTestId('lead-table')).getByTitle('1')).toHaveClass('ant-pagination-item-active')
  })
})

describe('ProductivityDashboard — tables on a phone (MOB-01)', () => {
  const TABLES = ['stage-table', 'forecast-table', 'lead-table', 'waste-table']
  const tableIn = (id: string) => screen.getByTestId(id).querySelector('.ant-table') as HTMLElement
  let restoreViewport = () => {}
  afterEach(() => restoreViewport())

  it('sizes every table to its content and scrolls it sideways in its card, the name column pinned', () => {
    restoreViewport = setViewport(390)
    renderDashboard()
    for (const id of TABLES) {
      const table = tableIn(id)
      // One line per header: the table is as wide as its content asks, and the card scrolls it.
      expect(table).toHaveClass('ant-table-scroll-horizontal')
      expect(table.querySelector('table')?.getAttribute('style')).toContain('width: max-content')
      // The first column, the row's name, stays in view as the rest scrolls under it.
      expect(table).toHaveClass('ant-table-has-fix-left')
    }
  })

  it('pins only the first column, and wraps the text columns at 160 px so the figures stay in reach (I5)', () => {
    restoreViewport = setViewport(390)
    renderDashboard()
    for (const id of TABLES) {
      const pinned = screen.getByTestId(id).querySelectorAll('thead th.ant-table-cell-fix-left')
      expect(pinned).toHaveLength(1)
      expect(pinned[0]).toBe(screen.getByTestId(id).querySelector('thead th'))
    }
    // On a phone the stage table pins the coat. One work is always applied,
    // so no row repeats it, as a column or as a caption (M19).
    const stages = within(screen.getByTestId('stage-table'))
    expect(screen.getByTestId('stage-table').querySelector('thead th')).toHaveTextContent(/^Công đoạn$/)
    expect(stages.queryByRole('columnheader', { name: 'Công việc' })).toBeNull()
    const coatCell = stages.getAllByText('Lớp 1')[0].closest('td') as HTMLElement
    expect(coatCell).toHaveClass('ant-table-cell-fix-left')
    expect(coatCell).toHaveTextContent(/^Lớp 1$/)
    const wrapOf = (text: string, id: string) => within(screen.getByTestId(id)).getAllByText(text)[0]
    for (const [text, id] of [['Lớp 1', 'stage-table'], ['Tổ 1', 'lead-table'], ['Mưa', 'waste-table'], ['Sàn A', 'forecast-table']] as const) {
      expect(wrapOf(text, id)).toHaveStyle({ maxWidth: '160px', whiteSpace: 'normal', overflowWrap: 'anywhere' })
    }
  })

  it('keeps the scroll but pins nothing from 768 px, where the columns fit', () => {
    restoreViewport = setViewport(1280)
    renderDashboard()
    // No Công việc column: the one work applied would fill it on every row (M19).
    const headers = within(screen.getByTestId('stage-table')).getAllByRole('columnheader').map((h) => h.textContent)
    expect(headers[0]).toBe('Công đoạn')
    expect(headers).not.toContain('Công việc')
    expect(within(screen.getByTestId('stage-table')).getAllByText('Lớp 1')[0].closest('td')).toHaveTextContent(/^Lớp 1$/)
    for (const id of TABLES) {
      expect(tableIn(id)).toHaveClass('ant-table-scroll-horizontal')
      expect(tableIn(id)).not.toHaveClass('ant-table-has-fix-left')
    }
  })
})

describe('ProductivityDashboard — the crew table beside the waste reasons (AD9)', () => {
  let restore = () => {}
  afterEach(() => restore())
  const pair = () => screen.getByTestId('lead-table').closest('[data-testid="lead-waste-pair"]') as HTMLElement

  it('gives Theo nhóm trưởng two thirds and Lý do hao phí one from 1200 px, so the six columns fit at 1280 (review M9)', () => {
    restore = setViewport(1280)
    renderDashboard()
    expect(pair()).toHaveStyle({ gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)' })
  })

  it('keeps the old wrap-and-scroll below 1200 px', () => {
    restore = setViewport(1024)
    renderDashboard()
    expect(pair()).toHaveStyle({ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' })
  })
})

describe('ProductivityDashboard — stat cards on a phone (MOB-02)', () => {
  const grid = () => screen.getByTestId('dashboard-cards')
  let restoreViewport = () => {}
  afterEach(() => restoreViewport())

  it('lays the six cards two to a row, compact, under 768 px', () => {
    restoreViewport = setViewport(390)
    renderDashboard()
    expect(grid()).toHaveStyle({ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' })
    expect(grid().children).toHaveLength(6)
    expect(cards().getByText('450,00')).toHaveStyle({ fontSize: '21px' })
  })

  it('stacks them one to a row only under 360 px', () => {
    restoreViewport = setViewport(340)
    renderDashboard()
    expect(grid()).toHaveStyle({ gridTemplateColumns: 'minmax(0, 1fr)' })
  })

  it('keeps the wide cards from 768 px, three to a row from 992 px so six leave no orphan (M19)', () => {
    restoreViewport = setViewport(1280)
    renderDashboard()
    expect(grid()).toHaveStyle({ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' })
    expect(grid().children).toHaveLength(6)
    expect(cards().getByText('450,00')).toHaveStyle({ fontSize: '32px' })
  })

  it('lays the wide cards two to a row between 768 and 992 px (M19)', () => {
    restoreViewport = setViewport(800)
    renderDashboard()
    expect(grid()).toHaveStyle({ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' })
    expect(cards().getByText('450,00')).toHaveStyle({ fontSize: '32px' })
  })
})

describe('ProductivityDashboard — measured tables (M6)', () => {
  it('hands the tables no Fragment titles, which a measured table would give a ref', () => {
    // rc-table's measure row, under `scroll.x`, clones each title with `ref: null`;
    // on a Fragment React 19 logs "Invalid prop `ref` supplied to `React.Fragment`".
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    renderDashboard()
    const fragmentErrors = error.mock.calls.filter((args) => args.some((a) => String(a).includes('React.Fragment')))
    error.mockRestore()
    expect(fragmentErrors).toEqual([])
  })
})
