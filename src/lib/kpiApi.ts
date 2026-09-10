import type { StagePlan } from '../domain/kpi'
import { supabase } from './supabase'

/**
 * Reading and writing the KPI plan windows — Feedback Rv5 item 9, `stage_plans`
 * (0033), rules RV5-22, RV5-23 and RV5-28.
 *
 * One row per coat: the two dates the admin typed and, optionally, the area she
 * overrode. Everything the chart draws from them is computed in
 * `domain/kpi.ts`, so this module is a mapper and three writes.
 */

/** A stored window, as `stage_plans` holds it, plus the names the chart labels with. */
export interface StoredStagePlan extends StagePlan {
  workId: string
  deckId: string
}

/** One window to write. The ids the denormalised columns and the trigger need. */
export interface StagePlanWrite {
  stageId: string
  workId: string
  deckId: string
  startDate: string
  endDate: string
  /** Null means "use the figure the system computes" (RV5-23), and is not 0. */
  plannedAreaM2: number | null
}

/**
 * `numeric` arrives from PostgREST as a STRING, and null stays null. Written
 * out here rather than imported because `progressApi.ts`'s copy is private to
 * that module; the alternative -- exporting it from there -- would widen a
 * shipped file's surface for one line.
 *
 * `Number(v)` and not `v || null`: a stored `'0.00'` is a deliberate override
 * meaning this coat plans no area, and must not collapse into "compute it".
 */
const numberOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v))

/**
 * The number of rows above which this read cannot be trusted.
 *
 * **Why this read is NOT paged.** RV5-02 pages every `cell_states` read because
 * that table holds one row per (bay, work) and a single deck of 241 bays in
 * five works is already 1205 rows. `stage_plans` holds one row per COAT: the
 * eleven-deck project in Feedback Rv5 has of the order of a hundred and fifty,
 * and a project would need a thousand distinct coats across all its works to
 * come close. Paging it would be a fourth copy of a loop for a case that cannot
 * arise from the way the admin configures a project.
 *
 * **So RV5-03 applies instead**: a truncated read is never a silent zero. A
 * response that comes back exactly at the cap is indistinguishable from a
 * truncated one, so this read refuses it rather than drawing a chart that is
 * quietly missing coats -- which is the precise failure mode A2 was about, and
 * a wrong KPI chart is harder to notice than a missing one.
 */
export const PLAN_ROW_CAP = 1000

/**
 * Every plan window of a project.
 *
 * `stage_plans` carries no `project_id` -- a coat's project is its work's -- so
 * the filter goes through the embedded `works` row, which also supplies the
 * work name. `!inner` makes the embed a join rather than a left join, so the
 * filter on it actually narrows; without it PostgREST returns every row with a
 * null embed. `deck_stages` supplies the coat name for the same reason: the
 * chart's Công đoạn filter labels itself from these.
 *
 * Both embeds are readable by everyone who may read a plan: `works_member_read`
 * and `deck_stages_member_read` (0028) resolve through `my_works()`, exactly as
 * `stage_plans_member_read` does, so a `gs` or `viewer` sees the names of every
 * plan it can see and no others.
 */
export async function listStagePlans(projectId: string): Promise<StoredStagePlan[]> {
  const { data, error } = await supabase
    .from('stage_plans')
    .select(
      'stage_id, work_id, deck_id, start_date, end_date, planned_area_m2, works!inner(name), deck_stages!inner(name)',
    )
    .eq('works.project_id', projectId)
    .order('start_date', { ascending: true })
    .limit(PLAN_ROW_CAP)
  if (error) throw new Error(error.message)
  const rows = (data ?? []) as unknown as Array<{
    stage_id: string
    work_id: string
    deck_id: string
    start_date: string
    end_date: string
    planned_area_m2: string | number | null
    works: { name: string } | null
    deck_stages: { name: string } | null
  }>
  if (rows.length >= PLAN_ROW_CAP) {
    throw new Error(
      `Đọc kế hoạch KPI bị cắt ở ${PLAN_ROW_CAP} dòng: biểu đồ sẽ thiếu công đoạn. ` +
        'Cần phân trang truy vấn này (RV5-02/RV5-03).',
    )
  }
  return rows.map((r) => ({
    stageId: r.stage_id,
    workId: r.work_id,
    deckId: r.deck_id,
    workName: r.works?.name ?? '',
    stageName: r.deck_stages?.name ?? '',
    startDate: r.start_date,
    endDate: r.end_date,
    plannedAreaM2: numberOrNull(r.planned_area_m2),
  }))
}

/**
 * Writes one coat's window.
 *
 * An upsert on `stage_id`, which is the whole primary key: the admin edits a
 * row that may or may not exist yet, and there is exactly one window per coat.
 *
 * The two rules are checked BEFORE the write, as `saveWorks` checks its weights
 * and for the same reason: `stage_plans_window` and `stage_plans_area_positive`
 * would refuse these rows anyway, but a Postgres constraint message is not
 * something to put in front of the admin. In Vietnamese, because the mistake is
 * hers to fix -- the same choice `setWorkDeckDeadline` makes.
 */
export async function saveStagePlan(row: StagePlanWrite): Promise<void> {
  if (row.endDate < row.startDate) {
    // Date-only 'YYYY-MM-DD' strings compare correctly as strings.
    throw new Error('Ngày kết thúc không được trước ngày bắt đầu.')
  }
  if (row.plannedAreaM2 !== null && !(row.plannedAreaM2 >= 0)) {
    // `!(x >= 0)` and not `x < 0`, so a NaN out of a cleared InputNumber is
    // refused here rather than reaching the database as `null`-ish garbage.
    throw new Error('Diện tích kế hoạch không được âm.')
  }

  const { data, error } = await supabase
    .from('stage_plans')
    .upsert(
      {
        stage_id: row.stageId,
        work_id: row.workId,
        deck_id: row.deckId,
        start_date: row.startDate,
        end_date: row.endDate,
        // Always on the payload, never omitted: on an update, an absent column
        // leaves a previous override in place, so "back to computed" has to be
        // an explicit null (RV5-23).
        planned_area_m2: row.plannedAreaM2,
      },
      { onConflict: 'stage_id' },
    )
    .select('stage_id')
  if (error) throw new Error(error.message)
  if (!data || data.length === 0) {
    // RLS hides a row from an UPDATE rather than erroring, so a non-admin's
    // write returns zero rows and no error. Saying nothing here would leave a
    // saved-looking row on screen that was never written.
    throw new Error('Không lưu được kế hoạch: công đoạn này không còn tồn tại, hoặc bạn không có quyền sửa.')
  }
}

/**
 * Clears the area override back to the computed figure (RV5-23: "a cleared
 * override returns the row to the computed figure").
 *
 * An UPDATE of the one column, not an upsert: the row exists -- an override can
 * only be cleared from a window that was typed -- and an upsert would need the
 * dates as well and could write a row with defaults for them.
 *
 * `null`, not 0. They are different answers, and this is the function whose
 * whole job is the difference.
 */
export async function clearStagePlanArea(stageId: string): Promise<void> {
  const { data, error } = await supabase
    .from('stage_plans')
    .update({ planned_area_m2: null })
    .eq('stage_id', stageId)
    .select('stage_id')
  if (error) throw new Error(error.message)
  if (!data || data.length === 0) {
    throw new Error('Không lưu được kế hoạch: công đoạn này chưa có kế hoạch, hoặc bạn không có quyền sửa.')
  }
}
