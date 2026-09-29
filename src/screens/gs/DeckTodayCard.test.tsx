import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DeckTodayCard } from './DeckTodayCard'

const TOTALS = { todayHours: 12.5, totalHours: 480, todayWasteHours: 1.5, totalWasteHours: 22 }

const ONE_WORK = [
  { workName: 'Sơn', stageName: 'Blast + Coat 1', areaM2: 320.5 },
  { workName: 'Sơn', stageName: 'Coat 2', areaM2: 0 },
  { workName: 'Sơn', stageName: 'Coat 3', areaM2: 0 },
]

const card = () => screen.getByTestId('gs-deck-today')

describe('DeckTodayCard', () => {
  it('lists every coat the deck has, at 0,00 m² where nothing was recorded today', () => {
    // RV5-17: "Liệt kê đủ các công đoạn khi admin tạo sàn. nếu không làm thì
    // hiển thị 0m2." An absent row would read as "this deck has no such coat".
    render(<DeckTodayCard todayKey="2026-09-09" rows={ONE_WORK} totals={TOTALS} />)
    expect(within(card()).getByText('Blast + Coat 1')).toBeInTheDocument()
    expect(within(card()).getByText('320,50 m²')).toBeInTheDocument()
    expect(within(card()).getByText('Coat 2')).toBeInTheDocument()
    expect(within(card()).getByText('Coat 3')).toBeInTheDocument()
    expect(within(card()).getAllByText('0,00 m²')).toHaveLength(2)
  })

  it('names the Vietnam day it is reporting, so a tablet left open overnight says so', () => {
    // RV5-20: "hôm nay" is the Vietnam calendar day. A card that only says
    // "Hôm nay" cannot be caught being a day stale.
    render(<DeckTodayCard todayKey="2026-09-09" rows={ONE_WORK} totals={TOTALS} />)
    expect(within(card()).getByText('09/09/2026')).toBeInTheDocument()
  })

  it('prints the four man-hour figures Linh asked for, under their own labels', () => {
    // RV5-19, verbatim from the spec's wording.
    render(<DeckTodayCard todayKey="2026-09-09" rows={ONE_WORK} totals={TOTALS} />)
    const rows: [string, string][] = [
      ['Mhr thực hiện hôm nay', '12,5'],
      ['Mhr hao phí hôm nay', '1,5'],
      ['Tổng Mhr đã thực hiện đến hôm nay', '480,0'],
      ['Tổng Mhr hao phí đến hôm nay', '22,0'],
    ]
    for (const [label, value] of rows) {
      expect(within(card()).getByText(label)).toBeInTheDocument()
      expect(within(card()).getByText(value)).toBeInTheDocument()
    }
  })

  it('says the cumulative hours only cover the records that carry hours', () => {
    // RV5-21: man-hours exist only from 0030 (2026-09-05), so the two totals are
    // not totals over all the work the deck has had done.
    render(<DeckTodayCard todayKey="2026-09-09" rows={ONE_WORK} totals={TOTALS} />)
    // On the two cumulative rows' (?), not as a footnote under the card (CPY-01).
    for (const label of ['Tổng Mhr đã thực hiện đến hôm nay', 'Tổng Mhr hao phí đến hôm nay']) {
      const tip = within(within(card()).getByText(label)).getByRole('img', { name: /05\/09\/2026.*không phải toàn bộ/ })
      expect(tip).toBeInTheDocument()
    }
    expect(within(card()).queryByText(/không phải toàn bộ/)).toBeNull()
    expect(within(card()).getByText('Mhr thực hiện hôm nay').querySelector('[role="img"]')).toBeNull()
  })

  it('groups the coats under their work when the deck is in two works', () => {
    // RV5-18: the block spans every work the deck belongs to, and two coats
    // called "Lớp 1" in different works must not read as one row.
    render(
      <DeckTodayCard
        todayKey="2026-09-09"
        rows={[
          { workName: 'Sơn', stageName: 'Lớp 1', areaM2: 100 },
          { workName: 'Tháo giáo', stageName: 'Lớp 1', areaM2: 40 },
        ]}
        totals={TOTALS}
      />,
    )
    expect(within(card()).getByText('Sơn')).toBeInTheDocument()
    expect(within(card()).getByText('Tháo giáo')).toBeInTheDocument()
    expect(within(card()).getAllByText('Lớp 1')).toHaveLength(2)
    expect(within(card()).getByText('100,00 m²')).toBeInTheDocument()
    expect(within(card()).getByText('40,00 m²')).toBeInTheDocument()
  })

  it('renders no grouping header for a deck in one work, the ordinary case', () => {
    // A header naming the only work there is is a line of chrome on a card the
    // foreman reads at arm's length.
    render(<DeckTodayCard todayKey="2026-09-09" rows={ONE_WORK} totals={TOTALS} />)
    expect(within(card()).queryByText('Sơn')).toBeNull()
  })

  it('says so rather than printing an empty list when the deck has no coats yet', () => {
    render(<DeckTodayCard todayKey="2026-09-09" rows={[]} totals={TOTALS} />)
    expect(within(card()).getByText(/chưa có công đoạn/)).toBeInTheDocument()
  })
})

describe('DeckTodayCard: the work\'s unit (RV6-35)', () => {
  it('prints each row in its own work\'s unit, and m² where none is given', () => {
    render(
      <DeckTodayCard
        todayKey="2026-09-09"
        rows={[
          { workName: 'Sơn', stageName: 'Coat 1', areaM2: 320.5, unit: 'm²' },
          { workName: 'Tháo giáo', stageName: 'Tháo giáo lửng', areaM2: 12, unit: 'tấn' },
          { workName: 'Cũ', stageName: 'Không rõ', areaM2: 0 },
        ]}
        totals={TOTALS}
      />,
    )
    expect(within(card()).getByText('320,50 m²')).toBeInTheDocument()
    expect(within(card()).getByText('12,00 tấn')).toBeInTheDocument()
    expect(within(card()).getByText('0,00 m²')).toBeInTheDocument()
  })
})
