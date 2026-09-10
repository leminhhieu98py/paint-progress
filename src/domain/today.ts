import { effortDayKey } from './effort'
import type { DeckEvent } from './types'

/**
 * What each coat of one deck produced today (Feedback Rv5, item 7).
 *
 * Linh's answer to Q3 fixes the shape: "Liệt kê đủ các công đoạn khi admin tạo
 * sàn. nếu không làm thì hiển thị 0m2." So the rows are the deck's CONFIGURED
 * coats, and a coat nobody touched today is a 0,00 m² row rather than an absent
 * one -- an absent row reads as "this deck has no such coat", which is a
 * different and wrong statement. Her answer to Q4 fixes the scope: the block is
 * the deck's, across every work it belongs to, and does not follow the screen's
 * work picker.
 *
 * Pure, and the day is the caller's: `todayKey` is an `effortDayKey`, so a test
 * can name the day and the block agrees with the dashboard and the Năng suất
 * sheet about where a Vietnam day starts (RV5-20).
 */

/** One row of the block: a stage of this deck and the m² recorded on it today. */
export interface TodayStageArea {
  workName: string
  stageName: string
  areaM2: number
}

/**
 * Postgres text cannot hold a NUL byte, so it cannot appear in a work or stage
 * name and cannot collide -- unlike the space `dailyEffort` joins its key with.
 */
const keyOf = (workName: string, stageName: string) => `${workName}\u0000${stageName}`

export function todayAreaByStage(
  events: DeckEvent[],
  stages: { workName: string; stageName: string }[],
  todayKey: string,
): TodayStageArea[] {
  /**
   * (work, coat) -> bay code -> that bay's area.
   *
   * A bay, not a sum, because a bay recorded twice into the same coat today
   * must count ONCE: the second update is a foreman correcting a mistyped
   * first, which is exactly what Linh asked for in Q7, and adding both would
   * report the day's output as double. `cellCode` is unique inside a deck, and
   * `listDeckEvents` returns oldest first, so the later update's figure is the
   * one left in the map.
   *
   * A bay that received Lớp 1 and then Lớp 2 today is not a correction and
   * counts on both -- it really did take both coats -- which falls out of
   * keying per coat rather than per bay.
   */
  const bays = new Map<string, Map<string, number>>()
  for (const ev of events) {
    // A move back to not-started is not output. It is not the
    // NOT_STARTED_STAGE placeholder row either: this block lists the coats the
    // admin configured on the deck and nothing else.
    if (ev.toStageName === null) continue
    if (effortDayKey(ev.at) !== todayKey) continue
    /*
      Every event of the day, with or without hours.

      Deliberately NOT `dailyEffort`'s `areaM2`, which sums only the events that
      carried `workHours` -- correctly, because that field is the denominator of
      a Mhr/m² ratio and an hourless event would divide by area nobody paid for.
      The day's output is a different question: the bay got its coat whether or
      not anyone typed the hours, and every row written before 0030 has none.
    */
    const key = keyOf(ev.workName ?? '', ev.toStageName)
    const forStage = bays.get(key) ?? new Map<string, number>()
    forStage.set(ev.cellCode, ev.cellAreaM2)
    bays.set(key, forStage)
  }
  // The caller's order, untouched: it holds the deck's works with their stages
  // already sorted by seq, and re-sorting here would fight it (RV5-17).
  return stages.map((stage) => {
    const forStage = bays.get(keyOf(stage.workName, stage.stageName))
    let areaM2 = 0
    if (forStage) for (const area of forStage.values()) areaM2 += area
    return { workName: stage.workName, stageName: stage.stageName, areaM2 }
  })
}
