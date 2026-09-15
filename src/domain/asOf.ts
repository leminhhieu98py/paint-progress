import { effortDayKey } from './effort'
import type { Cell, DeckEvent, Stage } from './types'

/**
 * The day the work model landed (migration 0024) and `cell_events` started
 * carrying the work each change belongs to.
 *
 * Rows older than it name no work, so nothing can say which of a deck's works
 * they moved a bay in. Linh ruled in Rv5 that the history before this date is
 * negligible; they are skipped, and the layer says so rather than quietly
 * reconstructing a picture from half the evidence.
 */
export const HISTORY_FROM_DAY = '2026-08-24'

/** What an as-of layer prints about the limit above, in the panel's date format. */
export const HISTORY_FROM_LABEL = 'Lịch sử từ 24/08/2026'

/**
 * The deck's bays as they stood at the end of one local day (RV6-15).
 *
 * `cells.stage_id` -- or rather `cell_states.stage_id`, since 0024 -- holds
 * only NOW. The history is in `cell_events`, one row per change, so "where was
 * this deck on 10/09" is a fold over that history: for each bay, the last
 * change recorded on or before `dayKey` is where it stood, and a bay with no
 * change by then had not been started. A move back to nothing (`toStageName`
 * null) is a change like any other and reads as not started.
 *
 * Pure, and returns bays in the SHAPE AND ORDER it was given them, with
 * `stageId` replaced and everything else -- geometry, area, note -- carried
 * through. The panel draws an as-of layer with the same code that draws a live
 * one; the only difference between them is this list.
 *
 * `effortDayKey` decides which day an event belongs to, so the boundary here is
 * the same Vietnam-time midnight the KPI chart, the forecast and the foreman's
 * card already work in. A deck that was worked at 23:30 on the 10th reads as
 * worked on the 10th on every screen.
 *
 * Matched on names, not ids, because that is what the event carries:
 * `cell_events` denormalises `to_stage_name` and `work_name` (0005, 0024) and
 * holds no id for either. `workName` and `stages` are therefore the caller's
 * ACTIVE work and its coats -- the same projection `entry` already is -- and
 * this filters the deck-wide history down to that work. An event naming a coat
 * the work no longer has (renamed since) is skipped rather than read as "not
 * started": the bay keeps the last coat that can still be drawn, which is the
 * lesser of the two wrong answers.
 */
export function cellStagesAsOf(
  cells: Cell[],
  events: DeckEvent[],
  dayKey: string,
  workName: string,
  stages: Stage[],
): Cell[] {
  const stageIdByName = new Map(stages.map((st) => [st.name, st.id]))

  // The last qualifying event per bay code. Built by comparison rather than by
  // trusting the input order: `listDeckEvents` pages oldest-first, but a fold
  // whose answer depends on that is one refactor away from being wrong, and
  // this one is asserted against every rotation of its input.
  const latest = new Map<string, DeckEvent>()
  for (const evt of events) {
    // Null work: a row from before 0024. See HISTORY_FROM_DAY.
    if (evt.workName === null || evt.workName !== workName) continue
    if (evt.toStageName !== null && !stageIdByName.has(evt.toStageName)) continue
    if (effortDayKey(evt.at) > dayKey) continue
    const held = latest.get(evt.cellCode)
    const at = Date.parse(evt.at)
    // The id breaks a tie on the timestamp, which is not hypothetical: 0024's
    // backfill stamped hundreds of rows with one `at`, and the event pager
    // orders by `at` THEN `id` for the same reason.
    if (!held || at > Date.parse(held.at) || (at === Date.parse(held.at) && evt.id > held.id)) {
      latest.set(evt.cellCode, evt)
    }
  }

  return cells.map((cell) => {
    const evt = latest.get(cell.code)
    const name = evt?.toStageName ?? null
    return { ...cell, stageId: name === null ? null : stageIdByName.get(name) ?? null }
  })
}
