import { describe, expect, it } from 'vitest'
import {
  actualByDay,
  dailyPlanRate,
  kpiSeries,
  planDays,
  planWindowDays,
  plannedAreaM2,
  remainingAreaOn,
  type DeckPlanScope,
  type KpiScopeStage,
  type StagePlan,
} from './kpi'
import { computeDeckProgress } from './progress'
import { EMPTY_EFFORT, type Cell, type Deck, type DeckEvent, type Effort, type Stage } from './types'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const plan = (over: Partial<StagePlan> = {}): StagePlan => ({
  stageId: 'coat1',
  workName: 'Sơn',
  stageName: 'Công đoạn 1',
  startDate: '2026-09-01',
  endDate: '2026-09-12',
  plannedAreaM2: null,
  ...over,
})

/**
 * The four rows of `KPI.xlsx`, verbatim: the areas in column G, the dates in
 * C and D. Every plan figure this suite asserts is the workbook's own, so the
 * app and Linh's file can be laid side by side.
 */
const WORKBOOK: Array<{ plan: StagePlan; area: number; days: number; rate: number }> = [
  { plan: plan({ stageId: 'coat1', stageName: 'Công đoạn 1', startDate: '2026-09-01', endDate: '2026-09-12', plannedAreaM2: 3300 }), area: 3300, days: 12, rate: 275 },
  { plan: plan({ stageId: 'coat2', stageName: 'Công đoạn 2', startDate: '2026-09-09', endDate: '2026-09-16', plannedAreaM2: 8000 }), area: 8000, days: 8, rate: 1000 },
  { plan: plan({ stageId: 'coat3', stageName: 'Công đoạn 3', startDate: '2026-09-16', endDate: '2026-09-21', plannedAreaM2: 16000 }), area: 16000, days: 6, rate: 16000 / 6 },
  { plan: plan({ stageId: 'coat4', stageName: 'Công đoạn 4', startDate: '2026-09-05', endDate: '2026-09-24', plannedAreaM2: 18000 }), area: 18000, days: 20, rate: 900 },
]

const COATS: Stage[] = [
  { id: 'coat1', seq: 1, name: 'Lớp 1', color: '#fadb14', weight: 0.4 },
  { id: 'coat2', seq: 2, name: 'Lớp 2', color: '#bfbfbf', weight: 0.3 },
  { id: 'coat3', seq: 3, name: 'Lớp 3', color: '#52c41a', weight: 0.3 },
]

const cell = (code: string, stageId: string | null, areaM2 = 250): Cell => ({
  id: code, code, x: 0, y: 0, w: 0, h: 0, areaM2, stageId,
})

/** Four bays of 250 m² on a 1000 m² deck, at whatever coats the test names. */
const deckAt = (at: Array<string | null>): Deck => ({
  id: 'd1', code: 'AD', name: 'Sàn A', totalAreaM2: 1000,
  cells: at.map((stageId, i) => cell(`R1C${i + 1}`, stageId)),
})

let nextId = 1
const event = (over: Partial<Omit<DeckEvent, 'effort'>> & { effort?: Partial<Effort> } = {}): DeckEvent => ({
  id: nextId++,
  deckName: 'Sàn A',
  cellCode: 'R1C1',
  cellAreaM2: 250,
  workName: 'Sơn',
  toStageName: 'Lớp 1',
  at: '2026-09-01T03:00:00Z',
  byId: 'u1',
  note: '',
  reportNote: null,
  reportHidden: false,
  effortEditedAt: null,
  effortEditedByName: null,
  ...over,
  effort: { ...EMPTY_EFFORT, ...(over.effort ?? {}) },
})

/** An event on `cellCode` into `stage` on the Vietnam day `day`. */
const moved = (cellCode: string, stage: string | null, day: string, over: Partial<DeckEvent> = {}) =>
  event({ cellCode, toStageName: stage, at: `${day}T03:00:00Z`, ...over })

const scope = (deck: Deck, events: DeckEvent[], stages = COATS): DeckPlanScope => ({
  workName: 'Sơn', deck, stages, events,
})

// ---------------------------------------------------------------------------
// Step 1 — the window
// ---------------------------------------------------------------------------

describe('planDays', () => {
  it('counts both ends: end - start + 1, as =D-C+1 in KPI.xlsx', () => {
    // RV5-22. The workbook's own four rows, so Số ngày on screen and Số ngày
    // in Linh's file are the same number.
    for (const row of WORKBOOK) {
      expect(planDays(row.plan)).toBe(row.days)
    }
  })

  it('counts a same-day window as one day, never zero', () => {
    // A coat planned to start and finish on one day is a real thing to type,
    // and a zero here would divide the area by nothing.
    expect(planDays(plan({ startDate: '2026-09-09', endDate: '2026-09-09' }))).toBe(1)
  })

  it('counts across a month boundary', () => {
    // 30 September plus 1 October: two days, not the -29 a naive
    // day-of-month subtraction gives.
    expect(planDays(plan({ startDate: '2026-09-30', endDate: '2026-10-01' }))).toBe(2)
    expect(planDays(plan({ startDate: '2026-08-25', endDate: '2026-09-05' }))).toBe(12)
  })

  it('counts across a year boundary and over a leap day', () => {
    expect(planDays(plan({ startDate: '2026-12-30', endDate: '2027-01-02' }))).toBe(4)
    // 2028 is a leap year: 28 Feb, 29 Feb, 1 Mar.
    expect(planDays(plan({ startDate: '2028-02-28', endDate: '2028-03-01' }))).toBe(3)
  })

  it('counts Sundays and holidays like any other day', () => {
    // RV5-22, Linh Q6: "Chia đúng đều không quan tâm chủ nhật hay lễ." There
    // is no working-day calendar here on purpose.
    // 2026-09-06 is a Sunday, and 2026-09-02 is Quốc khánh.
    expect(planDays(plan({ startDate: '2026-09-05', endDate: '2026-09-07' }))).toBe(3)
    expect(planDays(plan({ startDate: '2026-09-01', endDate: '2026-09-03' }))).toBe(3)
  })

  it('never returns less than one day, even for an inverted window', () => {
    // The DB check constraint and the entry screen both refuse end < start, so
    // this is unreachable through the app -- but a rate is a divisor, and a
    // zero or negative one would put Infinity on a customer-facing chart.
    expect(planDays(plan({ startDate: '2026-09-12', endDate: '2026-09-01' }))).toBe(1)
  })
})

describe('planWindowDays', () => {
  it('lists every calendar day of the window, inclusive and in order', () => {
    expect(planWindowDays(plan({ startDate: '2026-09-29', endDate: '2026-10-02' }))).toEqual([
      '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02',
    ])
  })

  it('lists exactly Số ngày days', () => {
    for (const row of WORKBOOK) {
      expect(planWindowDays(row.plan)).toHaveLength(row.days)
    }
  })
})

// ---------------------------------------------------------------------------
// Step 2 — the flat daily rate
// ---------------------------------------------------------------------------

describe('plannedAreaM2', () => {
  it('uses the admin override when there is one', () => {
    expect(plannedAreaM2(plan({ plannedAreaM2: 3300 }), 999)).toBe(3300)
  })

  it('falls back to the computed figure when the override is null', () => {
    // RV5-23, Linh Q5: "Diện tích sàn còn lại từ ngày bắt đầu hệ thống tự tính.
    // Tuy nhiên admin có quyền chỉnh sửa khi cần thiết."
    expect(plannedAreaM2(plan({ plannedAreaM2: null }), 1234.5)).toBe(1234.5)
  })

  it('treats a typed zero as an override, not as absent', () => {
    // 0 and null are different answers: 0 says "this coat plans no area", null
    // says "work it out for me". Reading 0 as absent would silently replace the
    // admin's deliberate zero with a computed number.
    expect(plannedAreaM2(plan({ plannedAreaM2: 0 }), 5000)).toBe(0)
  })
})

describe('dailyPlanRate', () => {
  it('spreads the area flat: =$G$n/$E$n', () => {
    // RV5-24 and the workbook's four rows.
    for (const row of WORKBOOK) {
      expect(dailyPlanRate(row.plan, 0)).toBeCloseTo(row.rate, 10)
    }
    // Named explicitly so a regression reads as a number, not as a loop.
    expect(dailyPlanRate(WORKBOOK[0].plan, 0)).toBe(275)
    expect(dailyPlanRate(WORKBOOK[1].plan, 0)).toBe(1000)
    expect(dailyPlanRate(WORKBOOK[3].plan, 0)).toBe(900)
  })

  it('divides the computed area when the admin typed no override', () => {
    expect(dailyPlanRate(plan({ startDate: '2026-09-01', endDate: '2026-09-10', plannedAreaM2: null }), 500)).toBe(50)
  })
})

// ---------------------------------------------------------------------------
// Step 3 — remaining area on a date
// ---------------------------------------------------------------------------

describe('remainingAreaOn', () => {
  const TODAY = '2026-09-09'

  it('reads the present from cell_states for a start date today or later', () => {
    // The same source every other percentage in the app divides by, so the KPI
    // screen cannot put a second, disagreeing "where the deck stands" on
    // screen. Asserted against computeDeckProgress itself rather than against
    // a hand-typed number, which is the whole point of the rule.
    const deck = deckAt(['coat3', 'coat2', 'coat1', null])
    const s = scope(deck, [])
    const progress = computeDeckProgress(deck, COATS)

    for (const sp of progress.stages) {
      expect(remainingAreaOn(s, sp.stage.seq, '2026-09-20', TODAY))
        .toBe(deck.totalAreaM2 - sp.cumulativeAreaM2)
    }
    // Spelled out: 750 m² is at coat 1 or past it, so 250 is left for coat 1.
    expect(remainingAreaOn(s, 1, '2026-09-20', TODAY)).toBe(250)
    expect(remainingAreaOn(s, 2, '2026-09-20', TODAY)).toBe(500)
    expect(remainingAreaOn(s, 3, '2026-09-20', TODAY)).toBe(750)
  })

  it('reads the present for a start date that is today itself', () => {
    const deck = deckAt(['coat1', null, null, null])
    expect(remainingAreaOn(scope(deck, []), 1, TODAY, TODAY)).toBe(750)
  })

  it('returns the whole deck for a past date before any event', () => {
    const deck = deckAt(['coat3', 'coat3', 'coat3', 'coat3'])
    const events = [moved('R1C1', 'Lớp 1', '2026-09-05')]
    expect(remainingAreaOn(scope(deck, events), 1, '2026-09-01', TODAY)).toBe(1000)
  })

  it('sees only the events at or before a past date', () => {
    const deck = deckAt(['coat2', 'coat1', null, null])
    const events = [
      moved('R1C1', 'Lớp 1', '2026-09-02'),
      moved('R1C2', 'Lớp 1', '2026-09-06'),
    ]
    // On 09-04 only the first bay has moved: 250 done, 750 left.
    expect(remainingAreaOn(scope(deck, events), 1, '2026-09-04', TODAY)).toBe(750)
    // On 09-06 both have: the boundary day is included.
    expect(remainingAreaOn(scope(deck, events), 1, '2026-09-06', TODAY)).toBe(500)
  })

  it('counts a bay moved forward and then back at the lower coat', () => {
    const deck = deckAt(['coat1', null, null, null])
    const events = [
      moved('R1C1', 'Lớp 3', '2026-09-02'),
      moved('R1C1', 'Lớp 1', '2026-09-03'),
    ]
    const s = scope(deck, events)
    // As of 09-02 the bay was at coat 3, so nothing is left for coat 3 but
    // itself; as of 09-03 it is back at coat 1 and coats 2 and 3 are open again.
    expect(remainingAreaOn(s, 3, '2026-09-02', TODAY)).toBe(750)
    expect(remainingAreaOn(s, 3, '2026-09-03', TODAY)).toBe(1000)
    expect(remainingAreaOn(s, 1, '2026-09-03', TODAY)).toBe(750)
  })

  it('counts a bay returned to nothing as not started', () => {
    const deck = deckAt([null, null, null, null])
    const events = [
      moved('R1C1', 'Lớp 1', '2026-09-02'),
      moved('R1C1', null, '2026-09-03'),
    ]
    const s = scope(deck, events)
    expect(remainingAreaOn(s, 1, '2026-09-02', TODAY)).toBe(750)
    expect(remainingAreaOn(s, 1, '2026-09-03', TODAY)).toBe(1000)
  })

  it('gives the same answer down both paths for one fixture', () => {
    // The test whose whole job is to catch the two sources drifting apart. The
    // events below are a COMPLETE history of the cell states beside them, so
    // reading the present and replaying the past must agree; `todayKey` is the
    // only thing that changes, and it is what picks the path.
    const deck = deckAt(['coat2', 'coat3', 'coat1', null])
    const events = [
      moved('R1C1', 'Lớp 1', '2026-09-02'),
      moved('R1C1', 'Lớp 2', '2026-09-04'),
      moved('R1C2', 'Lớp 3', '2026-09-05'),
      moved('R1C3', 'Lớp 2', '2026-09-06'),
      moved('R1C3', 'Lớp 1', '2026-09-07'),
    ]
    const s = scope(deck, events)
    for (const seq of [1, 2, 3]) {
      const present = remainingAreaOn(s, seq, TODAY, TODAY)          // cell_states
      const replayed = remainingAreaOn(s, seq, TODAY, '2026-09-10')  // cell_events
      expect(replayed).toBe(present)
    }
    // And the figures themselves, so an agreeing pair of wrong answers fails.
    expect(remainingAreaOn(s, 1, TODAY, TODAY)).toBe(250)
    expect(remainingAreaOn(s, 2, TODAY, TODAY)).toBe(500)
    expect(remainingAreaOn(s, 3, TODAY, TODAY)).toBe(750)
  })

  it('ignores the events of another work on the same deck', () => {
    // Two works may carry identically-named coats on one deck (RV5-18). A
    // Tháo giáo event must not advance a Sơn plan.
    const deck = deckAt([null, null, null, null])
    const events = [
      moved('R1C1', 'Lớp 1', '2026-09-02', { workName: 'Tháo giáo' }),
      moved('R1C2', 'Lớp 1', '2026-09-02'),
    ]
    expect(remainingAreaOn(scope(deck, events), 1, '2026-09-03', TODAY)).toBe(750)
  })

  it('treats an event naming a coat this work no longer has as not started', () => {
    // The documented limitation: events carry stage NAMES, so a coat renamed
    // after the fact cannot be matched. `stageSeqOf` answers 0 for a stage
    // that no longer exists, and so does this.
    const deck = deckAt([null, null, null, null])
    const events = [moved('R1C1', 'Lớp 1 (tên cũ)', '2026-09-02')]
    expect(remainingAreaOn(scope(deck, events), 1, '2026-09-03', TODAY)).toBe(1000)
  })

  it('takes the last event of a day when a bay moved twice on it', () => {
    const deck = deckAt([null, null, null, null])
    const events = [
      event({ id: 101, cellCode: 'R1C1', toStageName: 'Lớp 3', at: '2026-09-02T03:00:00Z' }),
      event({ id: 102, cellCode: 'R1C1', toStageName: 'Lớp 1', at: '2026-09-02T09:00:00Z' }),
    ]
    // The correction landed later the same day, so as of that day the bay is
    // at coat 1 and coat 3 is untouched.
    expect(remainingAreaOn(scope(deck, events), 3, '2026-09-02', TODAY)).toBe(1000)
    expect(remainingAreaOn(scope(deck, events), 1, '2026-09-02', TODAY)).toBe(750)
  })

  it('reads a Vietnam calendar day, not a UTC one', () => {
    // 18:00Z is 01:00 the next morning in Vietnam, so this event belongs to
    // 09-03 and is NOT yet visible on 09-02 (RV5-20's day key).
    const deck = deckAt([null, null, null, null])
    const events = [event({ cellCode: 'R1C1', toStageName: 'Lớp 1', at: '2026-09-02T18:00:00Z' })]
    const s = scope(deck, events)
    expect(remainingAreaOn(s, 1, '2026-09-02', TODAY)).toBe(1000)
    expect(remainingAreaOn(s, 1, '2026-09-03', TODAY)).toBe(750)
  })

  it('is not thrown off by events arriving out of order', () => {
    // listDeckEvents returns oldest first today; nothing in the type says so,
    // and a replay that trusted the array order would read the wrong coat.
    const deck = deckAt([null, null, null, null])
    const inOrder = [moved('R1C1', 'Lớp 1', '2026-09-02'), moved('R1C1', 'Lớp 3', '2026-09-04')]
    const s1 = scope(deck, inOrder)
    const s2 = scope(deck, [...inOrder].reverse())
    expect(remainingAreaOn(s2, 3, '2026-09-05', '2026-09-09'))
      .toBe(remainingAreaOn(s1, 3, '2026-09-05', '2026-09-09'))
    expect(remainingAreaOn(s2, 3, '2026-09-05', '2026-09-09')).toBe(750)
  })
})

// ---------------------------------------------------------------------------
// Step 4 — actual m² per day
// ---------------------------------------------------------------------------

describe('actualByDay', () => {
  const rows = (s: DeckPlanScope) =>
    actualByDay(s).map((r) => ({ stageName: r.stageName, day: r.day, areaM2: r.areaM2 }))

  it('counts one update on the day it was recorded', () => {
    const deck = deckAt(['coat1', null, null, null])
    expect(rows(scope(deck, [moved('R1C1', 'Lớp 1', '2026-09-02')]))).toEqual([
      { stageName: 'Lớp 1', day: '2026-09-02', areaM2: 250 },
    ])
  })

  it('moves the area to the later of two updates into the same coat', () => {
    // RV5-25, Linh Q7: "Tính theo m2 ghi nhận. Tuy nhiên nếu sửa lại thì ghi
    // nhận theo lần cập nhật sau." The earlier day contributes nothing at all
    // -- it is not halved, and it is not left behind.
    const deck = deckAt(['coat1', null, null, null])
    const events = [
      moved('R1C1', 'Lớp 1', '2026-09-02'),
      moved('R1C1', 'Lớp 1', '2026-09-05'),
    ]
    expect(rows(scope(deck, events))).toEqual([
      { stageName: 'Lớp 1', day: '2026-09-05', areaM2: 250 },
    ])
  })

  it('counts a bay moved through three coats once per coat, on its own day', () => {
    const deck = deckAt(['coat3', null, null, null])
    const events = [
      moved('R1C1', 'Lớp 1', '2026-09-02'),
      moved('R1C1', 'Lớp 2', '2026-09-03'),
      moved('R1C1', 'Lớp 3', '2026-09-04'),
    ]
    expect(rows(scope(deck, events))).toEqual([
      { stageName: 'Lớp 1', day: '2026-09-02', areaM2: 250 },
      { stageName: 'Lớp 2', day: '2026-09-03', areaM2: 250 },
      { stageName: 'Lớp 3', day: '2026-09-04', areaM2: 250 },
    ])
  })

  it('drops a bay rolled back below a coat from that coat entirely', () => {
    // The bay is at coat 1 now, so coats 2 and 3 are not done and their area
    // is not on the chart -- on any day, including the one it was recorded on.
    const deck = deckAt(['coat1', null, null, null])
    const events = [
      moved('R1C1', 'Lớp 1', '2026-09-02'),
      moved('R1C1', 'Lớp 3', '2026-09-03'),
      moved('R1C1', 'Lớp 1', '2026-09-06'),
    ]
    expect(rows(scope(deck, events))).toEqual([
      { stageName: 'Lớp 1', day: '2026-09-06', areaM2: 250 },
    ])
  })

  it('counts a bay that jumped straight to coat 3 for coats 1 and 2 as well', () => {
    // Without this the Actual S-curve for the early coats reads below the deck
    // percentage the same screen shows: progress is cumulative here, so a bay
    // at coat 3 has completed coats 1 and 2 whether or not anyone ticked them.
    const deck = deckAt(['coat3', null, null, null])
    expect(rows(scope(deck, [moved('R1C1', 'Lớp 3', '2026-09-04')]))).toEqual([
      { stageName: 'Lớp 1', day: '2026-09-04', areaM2: 250 },
      { stageName: 'Lớp 2', day: '2026-09-04', areaM2: 250 },
      { stageName: 'Lớp 3', day: '2026-09-04', areaM2: 250 },
    ])
  })

  it('books an implicitly-reached coat on the earliest day the bay passed it', () => {
    // The bay was already at or past coat 2 from 09-03; the later jump to
    // coat 3 did not re-do coat 2, so coat 2's area belongs to 09-03.
    const deck = deckAt(['coat3', null, null, null])
    const events = [
      moved('R1C1', 'Lớp 2', '2026-09-03'),
      moved('R1C1', 'Lớp 3', '2026-09-07'),
    ]
    expect(rows(scope(deck, events))).toEqual([
      { stageName: 'Lớp 1', day: '2026-09-03', areaM2: 250 },
      { stageName: 'Lớp 2', day: '2026-09-03', areaM2: 250 },
      { stageName: 'Lớp 3', day: '2026-09-07', areaM2: 250 },
    ])
  })

  it('counts an event with no coat nowhere', () => {
    const deck = deckAt([null, null, null, null])
    expect(rows(scope(deck, [moved('R1C1', null, '2026-09-04')]))).toEqual([])
  })

  it('ignores a bay whose cell is gone', () => {
    // Events outlive their cell (cell_events keeps a name snapshot). A deleted
    // bay's area is no longer part of the deck, so it is not done either.
    const deck = deckAt([null, null, null, null])
    expect(rows(scope(deck, [moved('R9C9', 'Lớp 1', '2026-09-04')]))).toEqual([])
  })

  it('ignores the events of another work', () => {
    const deck = deckAt(['coat1', null, null, null])
    const events = [moved('R1C1', 'Lớp 1', '2026-09-02', { workName: 'Tháo giáo' })]
    expect(rows(scope(deck, events))).toEqual([])
  })

  it('sums the bays that share a coat and a day, and sorts by day then seq', () => {
    const deck = deckAt(['coat1', 'coat2', null, null])
    const events = [
      moved('R1C2', 'Lớp 2', '2026-09-03'),
      moved('R1C1', 'Lớp 1', '2026-09-03'),
    ]
    expect(rows(scope(deck, events))).toEqual([
      // Both bays reached coat 1 on 09-03: 500 m².
      { stageName: 'Lớp 1', day: '2026-09-03', areaM2: 500 },
      { stageName: 'Lớp 2', day: '2026-09-03', areaM2: 250 },
    ])
  })

  it('uses the bay area the deck carries now, not the one on the event', () => {
    // A re-meshed deck changes a bay's m². The current figure is the one every
    // other percentage on the screen divides by, and using it is what makes the
    // invariant in the next test hold.
    const deck = deckAt(['coat1', null, null, null])
    const events = [moved('R1C1', 'Lớp 1', '2026-09-02', { cellAreaM2: 999 })]
    expect(rows(scope(deck, events))).toEqual([
      { stageName: 'Lớp 1', day: '2026-09-02', areaM2: 250 },
    ])
  })

  it("totals each coat to exactly that coat's cumulative area", () => {
    // The invariant that ties Actual to the rest of the product: summed over
    // every day, a coat's actual m² is the cumulative area computeDeckProgress
    // reports for it. If these two ever disagree, the KPI screen and the deck
    // percentage beside it are telling the customer different things.
    const deck = deckAt(['coat3', 'coat2', 'coat1', null])
    const events = [
      moved('R1C1', 'Lớp 1', '2026-09-02'),
      moved('R1C1', 'Lớp 3', '2026-09-05'),
      moved('R1C2', 'Lớp 2', '2026-09-03'),
      moved('R1C3', 'Lớp 1', '2026-09-06'),
    ]
    const actual = actualByDay(scope(deck, events))
    const progress = computeDeckProgress(deck, COATS)
    for (const sp of progress.stages) {
      const total = actual
        .filter((r) => r.stageId === sp.stage.id)
        .reduce((sum, r) => sum + r.areaM2, 0)
      expect(total).toBeCloseTo(sp.cumulativeAreaM2, 10)
    }
    // 750 at coat 1, 500 at coat 2, 250 at coat 3.
    expect(progress.stages.map((sp) => sp.cumulativeAreaM2)).toEqual([750, 500, 250])
  })

  it('carries the coat id so a plan row can be matched exactly', () => {
    // stage_plans is keyed on stage_id; matching by name would fuse two works'
    // identically-named coats.
    const deck = deckAt(['coat2', null, null, null])
    expect(actualByDay(scope(deck, [moved('R1C1', 'Lớp 2', '2026-09-02')])).map((r) => r.stageId))
      .toEqual(['coat1', 'coat2'])
  })
})

// ---------------------------------------------------------------------------
// Step 5 — the assembled series
// ---------------------------------------------------------------------------

/** The workbook's four coats with no actual, as `kpiSeries` takes them. */
const workbookScope = (): KpiScopeStage[] =>
  WORKBOOK.map((row) => ({ plan: row.plan, computedAreaM2: 0, actual: [] }))

describe('kpiSeries', () => {
  const dayOf = (series: ReturnType<typeof kpiSeries>, day: string) =>
    series.find((d) => d.day === day)!

  it("reproduces the workbook's summed plan per day", () => {
    // Row 6 of KPI.xlsx, `Total KPI (m2/day)`, column by column.
    const series = kpiSeries(workbookScope())
    const expected: Array<[string[], number]> = [
      [['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04'], 275],
      [['2026-09-05', '2026-09-06', '2026-09-07', '2026-09-08'], 1175],
      [['2026-09-09', '2026-09-10', '2026-09-11', '2026-09-12'], 2175],
      [['2026-09-13', '2026-09-14', '2026-09-15'], 1900],
      [['2026-09-16'], 900 + 1000 + 16000 / 6],
      [['2026-09-17', '2026-09-18', '2026-09-19', '2026-09-20', '2026-09-21'], 900 + 16000 / 6],
      [['2026-09-22', '2026-09-23', '2026-09-24'], 900],
    ]
    for (const [days, planM2] of expected) {
      for (const day of days) {
        expect(dayOf(series, day).planM2).toBeCloseTo(planM2, 10)
      }
    }
    // 4566.666… and 3566.666… as the workbook prints them, spelled out.
    expect(dayOf(series, '2026-09-16').planM2).toBeCloseTo(4566.666666666666, 9)
    expect(dayOf(series, '2026-09-17').planM2).toBeCloseTo(3566.6666666666665, 9)
  })

  it('spans exactly the union of the windows, in order', () => {
    const series = kpiSeries(workbookScope())
    expect(series).toHaveLength(24)
    expect(series[0].day).toBe('2026-09-01')
    expect(series[23].day).toBe('2026-09-24')
    expect([...series].sort((a, b) => a.day.localeCompare(b.day)).map((d) => d.day))
      .toEqual(series.map((d) => d.day))
  })

  it('totals the planned area to $G$6 and reaches a full share on the last day', () => {
    const series = kpiSeries(workbookScope())
    expect(series.reduce((sum, d) => sum + d.planM2, 0)).toBeCloseTo(45300, 6)
    // The workbook's own last cumulative share is 1.0000000000000002; neither
    // it nor this is exactly 1, because 16000/6 does not divide evenly.
    expect(series[23].planCumShare).toBeCloseTo(1, 12)
  })

  it('divides both curves by the same denominator, the scope total', () => {
    // RV5-26: `$G$6` for plan and for actual alike. Row 8 of the workbook is
    // the daily share and row 9 its running total.
    const series = kpiSeries(workbookScope())
    expect(dayOf(series, '2026-09-01').planCumShare).toBeCloseTo(275 / 45300, 12)
    expect(dayOf(series, '2026-09-02').planCumShare).toBeCloseTo(550 / 45300, 12)
    expect(dayOf(series, '2026-09-04').planCumShare).toBeCloseTo(1100 / 45300, 12)
    expect(dayOf(series, '2026-09-08').planCumShare).toBeCloseTo(5800 / 45300, 12)
  })

  it('runs the actual curve against the planned total, not against itself', () => {
    const entries: KpiScopeStage[] = [{
      plan: plan({ startDate: '2026-09-01', endDate: '2026-09-04', plannedAreaM2: 400 }),
      computedAreaM2: 0,
      actual: [
        { stageId: 'coat1', stageName: 'Lớp 1', day: '2026-09-01', areaM2: 100 },
        { stageId: 'coat1', stageName: 'Lớp 1', day: '2026-09-03', areaM2: 60 },
      ],
    }]
    const series = kpiSeries(entries)
    expect(series.map((d) => d.actualM2)).toEqual([100, 0, 60, 0])
    expect(series.map((d) => d.planM2)).toEqual([100, 100, 100, 100])
    expect(series.map((d) => d.actualCumShare)).toEqual([0.25, 0.25, 0.4, 0.4])
    expect(series.map((d) => d.planCumShare)).toEqual([0.25, 0.5, 0.75, 1])
  })

  it('includes a day that carries actual but lies outside every window', () => {
    // Work done before the plan started, or after it ended, is still work
    // done: dropping the day would take the area off the chart entirely.
    const entries: KpiScopeStage[] = [{
      plan: plan({ startDate: '2026-09-02', endDate: '2026-09-03', plannedAreaM2: 200 }),
      computedAreaM2: 0,
      actual: [
        { stageId: 'coat1', stageName: 'Lớp 1', day: '2026-08-31', areaM2: 50 },
        { stageId: 'coat1', stageName: 'Lớp 1', day: '2026-09-05', areaM2: 30 },
      ],
    }]
    expect(kpiSeries(entries).map((d) => [d.day, d.planM2, d.actualM2])).toEqual([
      ['2026-08-31', 0, 50],
      ['2026-09-02', 100, 0],
      ['2026-09-03', 100, 0],
      ['2026-09-05', 0, 30],
    ])
  })

  it('lets the actual share pass 1 rather than clamping it', () => {
    // The workbook does not clamp, and a clamped curve hides being ahead --
    // which is the one piece of good news this chart can carry.
    const entries: KpiScopeStage[] = [{
      plan: plan({ startDate: '2026-09-01', endDate: '2026-09-02', plannedAreaM2: 100 }),
      computedAreaM2: 0,
      actual: [{ stageId: 'coat1', stageName: 'Lớp 1', day: '2026-09-01', areaM2: 150 }],
    }]
    const series = kpiSeries(entries)
    expect(series[0].actualCumShare).toBe(1.5)
    expect(series[1].actualCumShare).toBe(1.5)
  })

  it('returns an empty series for an empty scope rather than dividing by zero', () => {
    expect(kpiSeries([])).toEqual([])
  })

  it('reports zero shares rather than NaN when the scope plans no area at all', () => {
    // Four coats all overridden to 0 m² is a legal state (0 is an override,
    // not an absence), and 0/0 on a chart axis renders as nothing at all.
    const entries: KpiScopeStage[] = [{
      plan: plan({ startDate: '2026-09-01', endDate: '2026-09-02', plannedAreaM2: 0 }),
      computedAreaM2: 0,
      actual: [{ stageId: 'coat1', stageName: 'Lớp 1', day: '2026-09-01', areaM2: 40 }],
    }]
    const series = kpiSeries(entries)
    expect(series.map((d) => d.planM2)).toEqual([0, 0])
    expect(series.map((d) => d.actualM2)).toEqual([40, 0])
    expect(series.every((d) => Number.isFinite(d.planCumShare))).toBe(true)
    expect(series.map((d) => d.planCumShare)).toEqual([0, 0])
    expect(series.map((d) => d.actualCumShare)).toEqual([0, 0])
  })

  it('sums the plan of two coats that share a day', () => {
    const entries: KpiScopeStage[] = [
      { plan: plan({ stageId: 'a', startDate: '2026-09-01', endDate: '2026-09-02', plannedAreaM2: 200 }), computedAreaM2: 0, actual: [] },
      { plan: plan({ stageId: 'b', startDate: '2026-09-02', endDate: '2026-09-02', plannedAreaM2: 50 }), computedAreaM2: 0, actual: [] },
    ]
    expect(kpiSeries(entries).map((d) => [d.day, d.planM2])).toEqual([
      ['2026-09-01', 100],
      ['2026-09-02', 150],
    ])
  })

  it('uses the computed area for a coat the admin left blank', () => {
    const entries: KpiScopeStage[] = [{
      plan: plan({ startDate: '2026-09-01', endDate: '2026-09-02', plannedAreaM2: null }),
      computedAreaM2: 600,
      actual: [],
    }]
    const series = kpiSeries(entries)
    expect(series.map((d) => d.planM2)).toEqual([300, 300])
    expect(series[1].planCumShare).toBe(1)
  })
})
