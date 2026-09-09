import { effortDayKey } from './effort'
import { stageSeqOf } from './progress'
import type { Deck, DeckEvent, Stage } from './types'

/**
 * KPI Plan vs Actual — Feedback Rv5 item 9, spec §B3, rules RV5-22…RV5-27.
 *
 * The arithmetic of Linh's `KPI.xlsx`, so the screen and her workbook can be
 * laid side by side and read the same. One row per coat there:
 *
 *   Tên sàn      Công đoạn    Ngày bắt đầu  Ngày kết thúc  Số ngày   Diện tích
 *   Cellar Deck  Công đoạn 1  2026-09-01    2026-09-12     =D-C+1    3300
 *   Cellar Deck  Công đoạn 2  2026-09-09    2026-09-16     (12)      8000
 *   ...
 *   Total KPI (m2/day)        =SUM per column
 *   % Total KPI Cum           =daily/$G$6
 *   % Total KPI S-Cum         =running total of the row above
 *
 * and the same three rows again for Actual. Four things there are easy to get
 * wrong, and each has its own function below:
 *
 *  - Số ngày counts BOTH ends and counts every calendar day (RV5-22, Linh Q6:
 *    "Chia đúng đều không quan tâm chủ nhật hay lễ"). There is no working-day
 *    calendar in this product, deliberately.
 *  - The plan is FLAT: the same m² on every day of the window (RV5-24).
 *  - The planned area defaults to what the system computes as remaining on the
 *    start date, and the admin may overwrite it (RV5-23).
 *  - Actual books a bay's area on the day of the LATEST event for that coat, so
 *    a correction MOVES the area instead of adding to it (RV5-25, Linh Q7).
 *
 * Pure, like `domain/effort.ts` and `domain/today.ts`: no clock, no fetching.
 * The caller supplies today's day key, so a test can name the day and the
 * screen agrees with the dashboard about where a Vietnam day starts (RV5-20).
 */

/** A coat's plan window as the admin typed it, plus the area to spread. */
export interface StagePlan {
  stageId: string
  workName: string
  stageName: string
  /** 'YYYY-MM-DD'. */
  startDate: string
  endDate: string
  /** The admin's override, or null to use the computed figure. */
  plannedAreaM2: number | null
}

/** One day of the chart. */
export interface KpiDay {
  day: string
  /** Σ over the coats in scope of that coat's flat daily rate, on days inside its window. */
  planM2: number
  /** Σ over the coats in scope of the area actually recorded that day. */
  actualM2: number
  /** Running totals of the two, as a share of the scope's total planned area. */
  planCumShare: number
  actualCumShare: number
}

/**
 * One (work, deck) as this module reads it.
 *
 * `workName` is not decoration. Events carry the work's NAME (denormalised on
 * `cell_events` since 0024) and one deck may be carried by two works whose
 * coats are identically named -- RV5-18 flagged exactly this -- so every read
 * of `events` here filters on it. Handing the whole deck's events in and
 * filtering here, rather than asking the caller to pre-filter, is the safer
 * arrangement: `listDeckEvents(deckId)` returns the deck across every work,
 * and a caller who forgot would get a plausible wrong answer, not an error.
 */
export interface DeckPlanScope {
  /** The work name as `cell_events.work_name` carries it. */
  workName: string
  /** Cells' `stageId` is their position IN THIS WORK -- a `WorkDeckEntry.deck`. */
  deck: Deck
  /** This (work, deck)'s coats, in any order. */
  stages: Stage[]
  /** The deck's events across every work; filtered to `workName` here. */
  events: DeckEvent[]
}

/** The m² one coat has actually got done, booked to one day. */
export interface ActualStageDay {
  /** `deck_stages.id`, so a `stage_plans` row matches exactly rather than by name. */
  stageId: string
  stageName: string
  /** 'YYYY-MM-DD' in Vietnam time. */
  day: string
  areaM2: number
}

/** One coat in the chart's scope: its plan row, its default area and its actual. */
export interface KpiScopeStage {
  plan: StagePlan
  /**
   * What `remainingAreaOn` computes for `plan.startDate` (RV5-23). Used only
   * when `plan.plannedAreaM2` is null.
   *
   * Passed in beside the plan rather than stored on it, because the plan row
   * is exactly what `stage_plans` holds and this figure is derived: recomputing
   * it is cheap, and storing it would create a second copy to go stale.
   */
  computedAreaM2: number
  /** This coat's rows from `actualByDay`. */
  actual: ActualStageDay[]
}

/**
 * Just the two dates, for the functions that only measure the window.
 *
 * Narrower than `StagePlan` on purpose: an entry screen holding a half-typed
 * draft can ask how long a window is without fabricating a plan row's names to
 * satisfy a type that never reads them. Every `StagePlan` satisfies this.
 */
export type PlanWindow = Pick<StagePlan, 'startDate' | 'endDate'>

const MS_PER_DAY = 24 * 60 * 60 * 1000

/**
 * 'YYYY-MM-DD' -> a Date at UTC NOON on that day.
 *
 * Noon, and UTC, for two separate reasons. UTC because `new Date(2026, 8, 1)`
 * builds a LOCAL midnight, and the difference between two local midnights is
 * not a whole number of days across a DST change -- the machine running this is
 * the admin's laptop, whose zone nobody controls. Noon because it puts twelve
 * hours of slack on either side of the day boundary, so no rounding of a
 * millisecond difference can land on the wrong date.
 */
function utcNoon(day: string): Date {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d, 12))
}

/** The inverse of `utcNoon`, for walking a window a day at a time. */
function dayKeyOf(at: Date): string {
  return at.toISOString().slice(0, 10)
}

/**
 * Số ngày làm việc: `end - start + 1`, INCLUSIVE, every calendar day counted.
 *
 * RV5-22 and `=D2-C2+1` in the workbook. Linh's answer to Q6 was
 * "Chia đúng đều không quan tâm chủ nhật hay lễ", so Sundays and Vietnamese
 * public holidays are ordinary days here. That is why this takes no calendar
 * and why `stage_plans` stores no working-day count: there is nothing to store.
 *
 * Floored at 1. An inverted window is refused by `stage_plans_window` in the
 * database and by the entry screen, so it cannot arrive through the app -- but
 * this number is a DIVISOR, and a 0 or a negative one would put `Infinity` or a
 * negative bar on a chart the customer reads. Failing safe beats failing loudly
 * on a figure nobody can act on.
 */
export function planDays(plan: PlanWindow): number {
  const span = (utcNoon(plan.endDate).getTime() - utcNoon(plan.startDate).getTime()) / MS_PER_DAY
  return Math.max(1, Math.round(span) + 1)
}

/**
 * Every calendar day from `from` to `to`, inclusive, ascending.
 *
 * `to` before `from` yields the single day `from`, matching `planDays`' floor
 * of 1: an inverted range is refused by the database and by the entry screen,
 * and one day is a safer answer on a chart than an empty axis.
 */
function dayRange(from: string, to: string): string[] {
  const days: string[] = []
  const start = utcNoon(from)
  const span = Math.round((utcNoon(to).getTime() - start.getTime()) / MS_PER_DAY)
  for (let i = 0; i <= Math.max(0, span); i += 1) {
    days.push(dayKeyOf(new Date(start.getTime() + i * MS_PER_DAY)))
  }
  return days
}

/** Every calendar day of the window, inclusive, ascending. */
export function planWindowDays(plan: PlanWindow): string[] {
  return dayRange(plan.startDate, plan.endDate)
}

/**
 * The area to spread: the admin's override when there is one, otherwise the
 * figure the system computed for the start date (RV5-23, Linh Q5: "Diện tích
 * sàn còn lại từ ngày bắt đầu hệ thống tự tính. Tuy nhiên admin có quyền chỉnh
 * sửa khi cần thiết").
 *
 * `?? ` and not `||`: a typed 0 is an override saying this coat plans no area,
 * and is NOT the same as an empty field. `||` would quietly replace the admin's
 * deliberate zero with a computed number, which is the bug this comment exists
 * to prevent someone from reintroducing.
 */
export function plannedAreaM2(plan: StagePlan, computedAreaM2: number): number {
  return plan.plannedAreaM2 ?? computedAreaM2
}

/** `=$G$n/$E$n`: the flat m²/day of one coat's window (RV5-24). */
export function dailyPlanRate(plan: StagePlan, computedAreaM2: number): number {
  return plannedAreaM2(plan, computedAreaM2) / planDays(plan)
}

/**
 * A coat's seq from the NAME an event carries.
 *
 * **The known limitation, which is the whole product's and not this module's.**
 * `cell_events` stores the stage's name as it was when the bay moved -- a
 * snapshot, on purpose, so a later rename does not rewrite history (0014). The
 * flip side is that a replay can only map that name back to a seq through the
 * coats the (work, deck) has NOW: a coat renamed after the fact matches
 * nothing. `stageOrder` in `domain/effort.ts` has exactly this property and
 * sorts such a name after the known ones.
 *
 * Unmatched answers 0, "not started", which is also what `stageSeqOf` answers
 * for a stage id that no longer exists. The consequence is worth naming: a
 * renamed coat's history reads as work not done, so `remainingAreaOn` OVER-
 * states what is left rather than under-stating it. Overstating is the safer
 * error for a plan the customer is measured against.
 */
function seqOfEventStage(stages: Stage[], toStageName: string | null): number {
  if (toStageName === null) return 0
  return stages.find((s) => s.name === toStageName)?.seq ?? 0
}

/**
 * The events of this scope's work, oldest first.
 *
 * Sorted here rather than trusted from the caller. `listDeckEvents` happens to
 * return oldest first today, but nothing in `DeckEvent` promises it, and both
 * computations below depend on the order for their answer rather than merely
 * for their presentation. `id` breaks a tie on `at`: it is the table's bigint
 * identity, so it orders two updates recorded in the same instant the way they
 * were written.
 */
function orderedEvents(scope: DeckPlanScope): DeckEvent[] {
  return scope.events
    .filter((ev) => (ev.workName ?? '') === scope.workName)
    .sort((a, b) => a.at.localeCompare(b.at) || a.id - b.id)
}

/**
 * Diện tích còn lại của công đoạn tính từ ngày bắt đầu (RV5-23).
 *
 * Progress in this product is cumulative: a bay at coat seq ≥ s has completed
 * s. So
 *
 *   remaining(s, D) = deck.totalAreaM2 − Σ area of bays whose coat as of D has seq ≥ s
 *
 * **Two sources, each for what it is authoritative about.** This is deliberate
 * and is not duplication to be refactored away:
 *
 *  - `D` today or later -> read the PRESENT from `cell_states`
 *    (`deck.cells[].stageId`), the same source every other percentage in the
 *    app divides by. Anything else would put a second, disagreeing "where the
 *    deck stands" on the same screen as the first. A plan starting in the
 *    future has nothing to replay anyway: remaining is simply what is left now.
 *  - `D` in the past -> REPLAY `cell_events` up to and including `D`, because
 *    `cell_states` holds only the present and cannot answer a question about a
 *    past date at all. A bay's coat as of `D` is the target of its LAST event
 *    at or before `D`, and 0 when that event was a removal or there is none.
 *
 * The two must agree for `D` = today on a deck whose events fully explain its
 * states, and `kpi.test.ts` has a test whose only job is to catch them
 * drifting apart.
 *
 * `todayKey` is an `effortDayKey`, supplied by the caller so this stays pure.
 */
export function remainingAreaOn(
  scope: DeckPlanScope,
  stageSeq: number,
  onDate: string,
  todayKey: string,
): number {
  const { deck } = scope

  if (onDate >= todayKey) {
    // Date-only keys in 'YYYY-MM-DD' compare correctly as strings, which is why
    // this module passes dates around as strings rather than Dates.
    const done = deck.cells.reduce(
      (sum, c) => (stageSeqOf(scope.stages, c.stageId) >= stageSeq ? sum + c.areaM2 : sum),
      0,
    )
    return deck.totalAreaM2 - done
  }

  // The replay. One entry per bay: the seq its last event at or before `onDate`
  // put it at. Keyed on `cellCode`, which is unique inside a deck.
  const seqByCell = new Map<string, number>()
  for (const ev of orderedEvents(scope)) {
    if (effortDayKey(ev.at) > onDate) break // ordered, so nothing later can qualify
    seqByCell.set(ev.cellCode, seqOfEventStage(scope.stages, ev.toStageName))
  }

  // Areas come from the deck's CURRENT cells, not from `ev.cellAreaM2`. A bay
  // whose cell has since been deleted or re-meshed is no longer part of
  // `totalAreaM2`, so counting its old area against the current total would
  // make `remaining` drift from the deck it is subtracted from.
  let done = 0
  for (const c of deck.cells) {
    if ((seqByCell.get(c.code) ?? 0) >= stageSeq) done += c.areaM2
  }
  return deck.totalAreaM2 - done
}

/**
 * The m² each coat actually got done, booked to a day (RV5-25, Linh Q7: "Tính
 * theo m2 ghi nhận. Tuy nhiên nếu sửa lại thì ghi nhận theo lần cập nhật sau.
 * Phòng trường hợp gs cập nhật sai nên chỉnh sửa lại theo thực tế").
 *
 * For each (bay, coat s): the day is the day of the LAST event recording that
 * bay into coat s. Then the two corrections the spec names:
 *
 *  1. A bay whose CURRENT coat has seq < s does not count for s at all. It was
 *     rolled back, and that area is no longer done. "Current" is `cell_states`,
 *     the same present the deck percentage beside this chart reads.
 *  2. A bay that reached coat s only IMPLICITLY -- by jumping to a higher coat
 *     with no event of its own for s -- counts for s on the day of the EARLIEST
 *     event that put it at seq ≥ s. Progress is cumulative, so a bay at coat 3
 *     has completed coats 1 and 2 whether or not anyone ticked them; without
 *     this the Actual S-curve for the early coats reads BELOW the deck
 *     percentage the same screen shows.
 *
 * **The consequence, which is intended and unlike every other m² figure in the
 * product.** A correction MOVES a bay's area to the day of the correction and
 * leaves nothing behind on the original day, so YESTERDAY'S ACTUAL CAN CHANGE
 * when today's correction lands. Linh asked for exactly this, so that a
 * foreman's mistyped update can be fixed rather than double-counted. Every
 * other m² figure here counts a bay once at the coat it now holds without
 * regard to which day it got there, and is therefore stable. The KPI screen
 * says so in a line under the chart.
 *
 * **A limitation that only real data will show.** A bay whose current coat came
 * from the 0024 backfill has no event at all -- that migration moved
 * `cells.stage_id` into `cell_states` with the logging trigger held, on purpose,
 * because it was a move and not a stage change. Such a bay satisfies correction
 * 1 but has no day to be booked to, so its area is absent from Actual while
 * being present in the deck percentage. It is the same shape of caveat as
 * RV5-21's about man-hours before 0030, and it fades as new work is recorded.
 */
export function actualByDay(scope: DeckPlanScope): ActualStageDay[] {
  const ordered = [...scope.stages].sort((a, b) => a.seq - b.seq)
  const events = orderedEvents(scope)

  // `cellCode` -> the cell, for the current coat and the current area. A bay
  // with events but no cell (the cell was deleted; `cell_events` outlives it)
  // is absent here and drops out of every coat below -- its area is no longer
  // part of the deck, so it is not done either.
  const cellByCode = new Map(scope.deck.cells.map((c) => [c.code, c]))

  const rows: ActualStageDay[] = []
  for (const stage of ordered) {
    const dayByCell = new Map<string, string>()

    for (const ev of events) {
      const cell = cellByCode.get(ev.cellCode)
      if (!cell) continue
      // Correction 1, applied before anything else so a rolled-back bay cannot
      // leave a row behind on the day it was rolled back.
      if (stageSeqOf(scope.stages, cell.stageId) < stage.seq) continue

      const day = effortDayKey(ev.at)
      if (ev.toStageName === stage.name) {
        // An event of its own for this coat. Events are oldest first, so
        // overwriting keeps the LAST one -- the correction, not the mistake.
        dayByCell.set(ev.cellCode, day)
        continue
      }
      if (seqOfEventStage(scope.stages, ev.toStageName) >= stage.seq && !dayByCell.has(ev.cellCode)) {
        // Correction 2: the bay passed this coat here. `!has` keeps the
        // EARLIEST such event, because passing a coat happened once -- the
        // later jump to a higher coat did not re-do this one.
        //
        // An explicit event for this coat still wins: it overwrites this entry
        // through the branch above, whether it arrives before or after.
        dayByCell.set(ev.cellCode, day)
      }
    }

    // Sum per day. The area is the CURRENT `cell.areaM2`, not the
    // `ev.cellAreaM2` snapshot: correction 2 books a coat off an event that
    // was never about that coat, so an event area would be the wrong bay's
    // figure after a re-mesh -- and using the current one makes a coat's actual
    // total exactly the cumulative area `computeDeckProgress` reports for it,
    // which is what keeps this chart and the deck percentage beside it
    // consistent. `kpi.test.ts` asserts that invariant.
    const areaByDay = new Map<string, number>()
    for (const [code, day] of dayByCell) {
      const area = cellByCode.get(code)!.areaM2
      areaByDay.set(day, (areaByDay.get(day) ?? 0) + area)
    }
    for (const [day, areaM2] of [...areaByDay].sort((a, b) => a[0].localeCompare(b[0]))) {
      rows.push({ stageId: stage.id, stageName: stage.name, day, areaM2 })
    }
  }

  // Day first, then seq: the order a chart and a table both want.
  return rows.sort(
    (a, b) =>
      a.day.localeCompare(b.day) ||
      (ordered.findIndex((s) => s.id === a.stageId) - ordered.findIndex((s) => s.id === b.stageId)),
  )
}

/**
 * The chart's series: one `KpiDay` per day, plan and actual against the same
 * denominator (RV5-26).
 *
 * **The days are a contiguous RANGE, not a list of the days something
 * happened on (RV5-37).** From the earliest `start_date` in scope to the
 * latest of (the latest `end_date`, the last day carrying actual). Every day
 * between appears, days no coat is scheduled on and Sundays included, and a
 * day with nothing recorded plots zero. The union of the windows was the
 * spec's first definition and it left holes: on dev the axis ran 26/08, 28/08,
 * 29/08, 30/08 and then jumped to 10/09, which reads as four consecutive days
 * of work rather than as a fortnight with a fortnight's gap. The owner asked
 * for the gaps to be filled ("lấp liền").
 *
 * The left edge is whole because of RV5-36: no actual can now fall before its
 * own coat's start date, so none can fall before the earliest start date in
 * scope either. A coat with no window is not in `entries` at all -- it has no
 * start date, so it has nothing to be measured against and nothing to stretch
 * the axis with.
 *
 * Shares divide by the summed planned area of the whole scope -- `$G$6`, for
 * plan and for actual alike -- and the two S-curves are the running totals of
 * those shares. Accumulating the m² and dividing once is the same arithmetic as
 * the workbook's running sum of already-divided shares (row 9 = `H9+I8`), and
 * loses one rounding step; the difference is at the sixteenth decimal.
 *
 * **Actual is clamped on the left, and only there (RV5-36).** A coat's actual
 * counts a day only from that coat's own `start_date` onward. The reason is
 * the denominator: RV5-23 defines the planned area as what REMAINS on the
 * start date, so work finished before then has already been subtracted out of
 * it. Counting that work in the numerator as well compares two different
 * things, and on dev it did: one plan, Main Deck · Blast + Coat 1, 10/09-20/09,
 * planned area 1.230,11 m² (correctly 5.258,00 − 4.027,89) against the whole
 * 4.027,89 m² recorded in August -- a right-hand axis reaching 340%, a
 * cumulative-actual line pegged at the top from 28/08, and a header reading
 * 327% against plan. `KPI.xlsx` never had the problem, because its Actual row
 * carries values only from the first plan day onward; the spec lost that when
 * it turned the workbook into RV5-25.
 *
 * Per coat, not once across the scope: each coat has its own window, and one
 * date for all of them would let a coat starting on the 20th count work done
 * while only the coat starting on the 1st had begun.
 *
 * There is NO upper bound. Work continuing past `end_date` is overrun and has
 * to be visible, and nothing is clamped at 1 either: actual above plan gives a
 * share above 1, as it does in the workbook -- a clamped curve would hide
 * being ahead, which is the one piece of good news this chart can carry.
 */
export function kpiSeries(entries: KpiScopeStage[]): KpiDay[] {
  if (entries.length === 0) return []

  const planByDay = new Map<string, number>()
  const actualByDayTotal = new Map<string, number>()
  let totalPlannedM2 = 0
  let firstDay = entries[0].plan.startDate
  let lastDay = entries[0].plan.endDate

  for (const entry of entries) {
    const area = plannedAreaM2(entry.plan, entry.computedAreaM2)
    totalPlannedM2 += area
    const rate = area / planDays(entry.plan)
    // Date-only keys in 'YYYY-MM-DD' compare correctly as strings, which is why
    // this module passes dates around as strings rather than Dates.
    if (entry.plan.startDate < firstDay) firstDay = entry.plan.startDate
    if (entry.plan.endDate > lastDay) lastDay = entry.plan.endDate
    for (const day of planWindowDays(entry.plan)) {
      planByDay.set(day, (planByDay.get(day) ?? 0) + rate)
    }
    for (const row of entry.actual) {
      // Skipped, not zeroed: this is the RV5-36 clamp, and a day before the
      // window is not a day of the plan at all.
      if (row.day < entry.plan.startDate) continue
      if (row.day > lastDay) lastDay = row.day
      actualByDayTotal.set(row.day, (actualByDayTotal.get(row.day) ?? 0) + row.areaM2)
    }
  }

  const days = dayRange(firstDay, lastDay)

  let cumPlan = 0
  let cumActual = 0
  return days.map((day) => {
    const planM2 = planByDay.get(day) ?? 0
    const actualM2 = actualByDayTotal.get(day) ?? 0
    cumPlan += planM2
    cumActual += actualM2
    // `> 0`, as `computeDeckProgress` guards its own denominator: a scope whose
    // coats are all overridden to 0 m² is legal (0 is an override, not an
    // absence) and 0/0 would put NaN on an axis, which renders as nothing at
    // all rather than as an error anyone would notice.
    return {
      day,
      planM2,
      actualM2,
      planCumShare: totalPlannedM2 > 0 ? cumPlan / totalPlannedM2 : 0,
      actualCumShare: totalPlannedM2 > 0 ? cumActual / totalPlannedM2 : 0,
    }
  })
}
