import { App as AntApp } from 'antd'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EMPTY_EFFORT, type DeckEvent, type Effort } from '../../domain/types'
import { DeckForecastPanel } from './DeckForecastPanel'

const loadDeckWorks = vi.hoisted(() => vi.fn())
const setWorkDeckDeadline = vi.hoisted(() => vi.fn())
vi.mock('../../lib/progressApi', () => ({
  loadDeckWorks: (id: string) => loadDeckWorks(id),
}))
vi.mock('../../lib/worksApi', () => ({
  setWorkDeckDeadline: (workId: string, deckId: string, deadline: string | null) =>
    setWorkDeckDeadline(workId, deckId, deadline),
}))

const STAGES = [
  { id: 's1', seq: 1, name: 'Lớp 1', color: '#fadb14', weight: 0.5 },
  { id: 's2', seq: 2, name: 'Lớp 2', color: '#bfbfbf', weight: 0.5 },
]
const WORK = {
  id: 'w1', projectId: 'p1', seq: 1, name: 'Sơn', kind: 'bays' as const,
  weight: 1, counts: true, manualProgress: 0,
}

/** 1.000 m²: one 500 m² bay through Lớp 2, one still at Lớp 1. */
const CELLS = [
  { id: 'c1', code: 'R1C1', x: 0, y: 0, w: 0.5, h: 1, areaM2: 500, stageId: 's2', note: '' },
  { id: 'c2', code: 'R1C2', x: 0.5, y: 0, w: 0.5, h: 1, areaM2: 500, stageId: 's1', note: '' },
]

const deckWorks = (over: Record<string, unknown> = {}) => ({
  seq: 1,
  deck: { id: 'd1', code: 'CD', name: 'Cellar Deck', totalAreaM2: 1000, cells: CELLS },
  imagePath: 'p/d1.png', imageW: 2000, imageH: 1600, areaSource: 'guides' as const,
  works: [{ work: WORK, weight: 1, deadline: null, stages: STAGES, cells: CELLS, audit: {} }],
  ...over,
})

let nextId = 1
const ev = (over: Partial<Omit<DeckEvent, 'effort'>> & { effort?: Partial<Effort> } = {}): DeckEvent => ({
  id: nextId++, deckName: 'Cellar Deck', cellCode: 'R1C1', cellAreaM2: 500, workName: 'Sơn',
  toStageName: 'Lớp 1', at: '2026-09-04T03:00:00Z', byId: 'u1', note: '',
  reportNote: null, reportHidden: false, effortEditedAt: null, effortEditedByName: null,
  ...over,
  effort: { ...EMPTY_EFFORT, ...(over.effort ?? {}) },
})

/**
 * Two days of measured work on each coat, chosen so the arithmetic is checkable
 * by hand: Lớp 1 runs at 1 Mhr/m² and 500 Mhr a day, Lớp 2 at 2 Mhr/m² and 500.
 * Remaining: Lớp 1 has 0 m² left (both bays are at or past it), Lớp 2 has 500.
 */
const EVENTS: DeckEvent[] = [
  ev({ at: '2026-09-03T03:00:00Z', toStageName: 'Lớp 1', cellAreaM2: 500, effort: { workHours: 500 } }),
  ev({ at: '2026-09-04T03:00:00Z', toStageName: 'Lớp 1', cellAreaM2: 500, effort: { workHours: 500 } }),
  ev({ at: '2026-09-03T03:00:00Z', toStageName: 'Lớp 2', cellAreaM2: 250, effort: { workHours: 500 } }),
  ev({ at: '2026-09-04T03:00:00Z', toStageName: 'Lớp 2', cellAreaM2: 250, effort: { workHours: 500, wasteHours: 2, wasteReason: 'Mưa' } }),
]

const renderPanel = (props: Partial<Parameters<typeof DeckForecastPanel>[0]> = {}) =>
  render(
    <AntApp>
      <DeckForecastPanel deckId="d1" editable events={EVENTS} {...props} />
    </AntApp>,
  )

const rows = () => within(screen.getByRole('table')).getAllByRole('row')

beforeEach(() => {
  // "Today" is the day after the last recorded day, so the four totals read
  // zero for today and the deadline arithmetic has a fixed base.
  //
  // `shouldAdvanceTime` matters: without it the fake clock never moves, and
  // every RTL wait and every antd animation hangs until the 5s test timeout.
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(new Date('2026-09-05T04:00:00Z'))
  loadDeckWorks.mockReset()
  loadDeckWorks.mockResolvedValue(deckWorks())
  setWorkDeckDeadline.mockReset()
  setWorkDeckDeadline.mockResolvedValue(undefined)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('DeckForecastPanel', () => {
  it('shows the deck\'s hours today and in total, worked and lost', async () => {
    // Linh, 2026-09-05: four lines beside the deck. Nothing was recorded on the
    // 5th, so today is zero while the totals are not -- which is the whole
    // point of showing both.
    renderPanel()
    const totals = within(await screen.findByTestId('deck-effort-totals'))
    expect(totals.getByText('Mhr thực hiện hôm nay')).toBeInTheDocument()
    expect(totals.getAllByText('0,0')).toHaveLength(2)
    expect(totals.getByText('2.000,0')).toBeInTheDocument()
    expect(totals.getByText('2,0')).toBeInTheDocument()
  })

  it('forecasts each coat from what is left and what it has been costing', async () => {
    renderPanel()
    await screen.findByRole('table')
    const [, lop1, lop2] = rows()

    // Lớp 1: every bay has been through it, so nothing is left and no days.
    expect(within(lop1).getByText('Lớp 1')).toBeInTheDocument()
    expect(within(lop1).getByText('0,00')).toBeInTheDocument()
    expect(within(lop1).getByText('1,000')).toBeInTheDocument()

    // Lớp 2: 500 m² left at 2 Mhr/m² is 1.000 Mhr, and at 500 Mhr a day, 2 days.
    expect(within(lop2).getByText('Lớp 2')).toBeInTheDocument()
    expect(within(lop2).getByText('500,00')).toBeInTheDocument()
    expect(within(lop2).getByText('2,000')).toBeInTheDocument()
    expect(within(lop2).getByText('1.000,0')).toBeInTheDocument()
    expect(within(lop2).getByText('2')).toBeInTheDocument()
  })

  it('totals the Mhr and takes the largest number of days, and says why', async () => {
    renderPanel()
    const total = within(await screen.findByTestId('forecast-total'))
    expect(total.getByText('1.000,0')).toBeInTheDocument()
    expect(total.getByText('2')).toBeInTheDocument()
    expect(screen.getByText(/ngày lớn nhất trong các công đoạn, không phải tổng/)).toBeInTheDocument()
  })

  it('says nothing about being late when no deadline is set', async () => {
    renderPanel()
    await screen.findByRole('table')
    expect(screen.getByText('Sơn · chưa đặt hạn')).toBeInTheDocument()
    expect(screen.queryByTestId('forecast-warning')).toBeNull()
  })

  it('counts the days left to a deadline that is still reachable', async () => {
    loadDeckWorks.mockResolvedValue(deckWorks({
      works: [{ work: WORK, weight: 1, deadline: '2026-09-10', stages: STAGES, cells: CELLS, audit: {} }],
    }))
    renderPanel()
    // 05/09 to 10/09 inclusive is six days, against two needed.
    expect(await screen.findByText('Còn 6 ngày (tính cả chủ nhật)')).toBeInTheDocument()
    expect(screen.queryByTestId('forecast-warning')).toBeNull()
  })

  it('warns with the Mhr and the days it is short by, in Linh\'s words', async () => {
    loadDeckWorks.mockResolvedValue(deckWorks({
      works: [{ work: WORK, weight: 1, deadline: '2026-09-05', stages: STAGES, cells: CELLS, audit: {} }],
    }))
    renderPanel()
    const warning = within(await screen.findByTestId('forecast-warning'))
    expect(warning.getByText('Cảnh báo không kịp tiến độ')).toBeInTheDocument()
    // One day left, two needed; Lớp 2 gets through 500 of its 1.000 Mhr.
    expect(warning.getByText('Cần thêm 500,0 Mhr hoặc 1 ngày làm việc.')).toBeInTheDocument()
  })

  it('says how far past the deadline the deck already is', async () => {
    loadDeckWorks.mockResolvedValue(deckWorks({
      works: [{ work: WORK, weight: 1, deadline: '2026-09-02', stages: STAGES, cells: CELLS, audit: {} }],
    }))
    renderPanel()
    expect(await screen.findByText('Đã quá hạn 3 ngày')).toBeInTheDocument()
  })

  it('saves a deadline the admin picks, and reloads to show it', async () => {
    // The reload has to come back with the date that was just written, as the
    // real read does; otherwise the picker is handed null again and the guard
    // against a no-op write is what stops it looping.
    loadDeckWorks
      .mockResolvedValueOnce(deckWorks())
      .mockResolvedValue(deckWorks({
        works: [{ work: WORK, weight: 1, deadline: '2026-09-10', stages: STAGES, cells: CELLS, audit: {} }],
      }))
    renderPanel()
    await screen.findByRole('table')
    await userEvent.click(screen.getByPlaceholderText('Chọn ngày'))
    // antd's picker needs the date typed and confirmed; the calendar itself is
    // its own component's business.
    await userEvent.type(document.activeElement as HTMLElement, '10/09/2026{Enter}')

    await waitFor(() => expect(setWorkDeckDeadline).toHaveBeenCalledWith('w1', 'd1', '2026-09-10'))
    expect((await screen.findAllByText('Đã lưu hạn hoàn thành')).length).toBeGreaterThan(0)
    await waitFor(() => expect(loadDeckWorks).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('Sơn · hạn 10/09/2026')).toBeInTheDocument()
    // And no loop: the reloaded value must not trigger another write.
    expect(setWorkDeckDeadline).toHaveBeenCalledTimes(1)
  })

  it('shows the deadline without a control outside Sửa mode', async () => {
    loadDeckWorks.mockResolvedValue(deckWorks({
      works: [{ work: WORK, weight: 1, deadline: '2026-09-10', stages: STAGES, cells: CELLS, audit: {} }],
    }))
    renderPanel({ editable: false })
    expect(await screen.findByTestId('deck-deadline-readonly')).toHaveTextContent('10/09/2026')
    expect(screen.queryByPlaceholderText('Chọn ngày')).toBeNull()
  })

  it('leaves a coat nobody has recorded hours on out of the totals, and says so', async () => {
    renderPanel({ events: EVENTS.filter((e) => e.toStageName === 'Lớp 1') })
    await screen.findByRole('table')
    expect(screen.getByTestId('forecast-missing')).toHaveTextContent(
      '1 công đoạn chưa có giờ công nào nên chưa dự báo được',
    )
    // Lớp 1 has nothing left to do, so the total is 0 Mhr over 0 days.
    const total = within(screen.getByTestId('forecast-total'))
    expect(total.getByText('0,0')).toBeInTheDocument()
  })

  it('tells the admin when the deck belongs to no work at all', async () => {
    loadDeckWorks.mockResolvedValue(deckWorks({ works: [] }))
    renderPanel()
    expect(
      await screen.findByText('Sàn này chưa thuộc công việc nào, nên chưa có gì để dự báo.'),
    ).toBeInTheDocument()
  })

  it('surfaces a failed read with a retry rather than an empty panel', async () => {
    loadDeckWorks.mockRejectedValueOnce(new Error('mạng hỏng'))
    renderPanel()
    expect(await screen.findByText('mạng hỏng')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Thử lại' }))
    await waitFor(() => expect(screen.queryByText('mạng hỏng')).toBeNull())
  })
})
