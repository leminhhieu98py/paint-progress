import dayjs from 'dayjs'
import { computeDeckProgress, computeProjectProgress } from './progress'
import type { Deck, DeckEvent, Stage, Zone } from './types'

/**
 * The report's data model, and nothing about spreadsheets.
 *
 * Kept pure and separate from the ExcelJS layer for the reason spec §10 gives
 * for every number in this app: a silent bug here corrupts a document the client
 * makes payment decisions from, and a workbook is a poor thing to assert
 * against. What the sheets do is arrange these rows.
 */

export interface DeckReportInput {
  deck: Deck
  stages: Stage[]
  zones: Zone[]
  /** Every stage change on the deck; the per-deck sheet lists them one per row. */
  events: DeckEvent[]
  /** Optional; defaults to 'guides'. 'prorated' is disclosed on the sheet. */
  areaSource?: 'guides' | 'prorated'
  /** Optional: user id -> display name, for the "Bởi" column. */
  userNames?: Record<string, string>
}

/** One stage change, as the deck sheet prints it. */
export interface EventRow {
  code: string
  areaM2: number
  /** The coat the bay moved to, or "Chưa bắt đầu". */
  stageName: string
  at: string
  byName: string | null
  /** What the XLSX prints: the report copy if the admin wrote one, nothing if
   *  she hid it, the foreman's words otherwise. */
  note: string
}

export interface OverviewRow {
  code: string
  name: string
  /** This deck's area as a share of the project's. 1 on the rollup row. */
  share: number
  totalAreaM2: number
  /** Cumulative area at each stage, keyed by stage NAME. A stage this deck does
   *  not declare is ABSENT, never 0 -- see buildOverviewRows. */
  stageAreaM2: Record<string, number>
  /** The same figures as a share of this deck's declared area. */
  stageRatio: Record<string, number>
  progress: number
  remain: number
  isTotal: boolean
}

export interface PlanRow {
  deckName: string
  zoneName: string
  stageName: string
  areaM2: number
  /** Inclusive of both ends, or null when either date is unknown. */
  days: number | null
  startDate: string | null
  finishDate: string | null
}

/**
 * The stage columns the Overview sheet carries, in work order.
 *
 * A union across decks, keyed by NAME. Since 0018 a stage belongs to a deck, so
 * two decks of one project can carry different coat systems -- but the sheet
 * keeps one row per deck, because that is the shape the client already reads.
 * Keying on id would give two near-duplicate columns for what is plainly the
 * same coat under two rows.
 *
 * Ordered by the earliest seq any deck gives a name. Sorting by name would put
 * "Tháo giáo" first, which is the reverse of the work.
 */
export function reportStageColumns(inputs: DeckReportInput[]): string[] {
  const firstSeq = new Map<string, number>()
  for (const input of inputs) {
    for (const stage of input.stages) {
      const seen = firstSeq.get(stage.name)
      if (seen === undefined || stage.seq < seen) firstSeq.set(stage.name, stage.seq)
    }
  }
  return [...firstSeq.entries()]
    .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))
    .map(([name]) => name)
}

/**
 * One row per deck, then the project rollup.
 *
 * Every figure comes from `computeDeckProgress` / `computeProjectProgress`, the
 * pair asserted against the customer's own spreadsheet to 1e-9 (spec §3.3).
 * Nothing is recomputed: a second implementation of pᵢ is a second thing that
 * can disagree with the screen the admin just approved.
 *
 * A stage a deck does not declare is left OUT of that deck's maps rather than
 * written as 0. To somebody pricing the work those mean different things -- 0 is
 * "in the spec, none done", absent is "not in this deck's spec at all" -- and
 * the sheet renders the difference as a blank cell.
 */
export function buildOverviewRows(inputs: DeckReportInput[]): OverviewRow[] {
  const rollup = computeProjectProgress(inputs.map((i) => ({ deck: i.deck, stages: i.stages })))
  const totalArea = inputs.reduce((sum, i) => sum + i.deck.totalAreaM2, 0)

  const rows: OverviewRow[] = inputs.map((input) => {
    const progress = computeDeckProgress(input.deck, input.stages)
    const stageAreaM2: Record<string, number> = {}
    const stageRatio: Record<string, number> = {}
    for (const sp of progress.stages) {
      stageAreaM2[sp.stage.name] = sp.cumulativeAreaM2
      stageRatio[sp.stage.name] = sp.ratio
    }
    return {
      code: input.deck.code,
      name: input.deck.name,
      share: rollup.decks.find((d) => d.deckId === input.deck.id)?.weight ?? 0,
      totalAreaM2: input.deck.totalAreaM2,
      stageAreaM2,
      stageRatio,
      progress: progress.progress,
      remain: 1 - progress.progress,
      isTotal: false,
    }
  })

  // The rollup's per-stage areas are plain sums across decks: an area is an
  // area, whatever spec produced it. Its ratios divide by the project's total
  // declared area, the same denominator its progress uses.
  const stageAreaM2: Record<string, number> = {}
  for (const row of rows) {
    for (const [name, area] of Object.entries(row.stageAreaM2)) {
      stageAreaM2[name] = (stageAreaM2[name] ?? 0) + area
    }
  }
  const stageRatio: Record<string, number> = {}
  for (const [name, area] of Object.entries(stageAreaM2)) {
    stageRatio[name] = totalArea === 0 ? 0 : area / totalArea
  }

  rows.push({
    code: '',
    name: 'TỔNG DỰ ÁN',
    share: totalArea === 0 ? 0 : 1,
    totalAreaM2: totalArea,
    stageAreaM2,
    stageRatio,
    progress: rollup.progress,
    remain: 1 - rollup.progress,
    isTotal: true,
  })

  return rows
}

/**
 * The `Kế hoạch tháo GG` sheet: every zone across every deck.
 *
 * The day count is INCLUSIVE of both ends: 1 Sep to 7 Sep is seven days on
 * site, not six. Null when either end is unknown, rather than a guess.
 *
 * Do not "fix" this to a plain difference after reading the customer's own
 * workbook. That sheet disagrees with ITSELF -- its zone rows count 15/11 to
 * 20/11 as 5 while its deck row counts 15/11 to 13/01 as 60, which is
 * inclusive -- and its author confirmed on 2026-08-28 that the zone rows are
 * the mistake and this is the count she wants.
 *
 * A cell id the deck does not carry contributes nothing, and a stage the deck no
 * longer declares renders as a dash. Neither should arise -- `zone_cells` and
 * `zones.stage_id` both cascade -- but a report that throws takes the whole
 * export with it, and the admin loses the sheets that were fine.
 */
export function buildPlanRows(inputs: DeckReportInput[]): PlanRow[] {
  const rows: PlanRow[] = []
  for (const input of inputs) {
    const areaById = new Map(input.deck.cells.map((c) => [c.id, c.areaM2]))
    for (const zone of input.zones) {
      const days = zone.startDate && zone.finishDate
        ? dayjs(zone.finishDate).diff(dayjs(zone.startDate), 'day') + 1
        : null
      rows.push({
        deckName: input.deck.name,
        zoneName: zone.name,
        stageName: input.stages.find((s) => s.id === zone.stageId)?.name ?? '—',
        areaM2: zone.cellIds.reduce((sum, id) => sum + (areaById.get(id) ?? 0), 0),
        days,
        startDate: zone.startDate,
        finishDate: zone.finishDate,
      })
    }
  }
  return rows
}

/**
 * The per-deck sheet's cell listing: every bay, its area, where it has got to,
 * and who moved it there last (spec §9).
 *
 * This is the row-level evidence behind the percentages. When a figure is
 * queried -- and on a job priced off these numbers it will be -- this is the
 * sheet that answers "which bays, exactly".
 *
 * Ordered by code, the same order `listCells` returns, so two exports of an
 * unchanged deck are identical files and a diff between them means something.
 *
 * An unknown `updated_by` renders as the raw id rather than blank: the id is
 * still traceable in `cell_events`, and a blank would read as "nobody".
 */
/**
 * The deck sheet's list: one row per stage change, in bay order and then in
 * the order they happened, so reading down a bay shows the steps it went
 * through. A bay nobody has touched has no row -- Linh, on the report: "GS
 * cập nhật ô nào thì report có thêm 1 hàng. Không thì thôi."
 *
 * The note column is where 0023's decisions land and nowhere else: the
 * admin's report copy if she wrote one, nothing if she hid the note, the
 * foreman's words otherwise. The screens never apply either.
 */
export function buildEventRows(input: DeckReportInput): EventRow[] {
  return [...input.events]
    .sort((a, b) => a.cellCode.localeCompare(b.cellCode) || a.at.localeCompare(b.at))
    .map((ev) => ({
      code: ev.cellCode,
      areaM2: ev.cellAreaM2,
      stageName: ev.toStageName ?? 'Chưa bắt đầu',
      at: ev.at,
      // The id is still traceable through cell_events; a blank would read as
      // "nobody did this", which is a different and wrong claim.
      byName: ev.byId === null ? null : input.userNames?.[ev.byId] ?? ev.byId,
      note: ev.reportHidden ? '' : ev.reportNote ?? ev.note,
    }))
}
