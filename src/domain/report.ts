import dayjs from 'dayjs'
import { computeDeckProgress, computeProjectProgress, computeWorkProgress } from './progress'
import type { Deck, DeckEvent, Stage, Work, WorkModel, Zone } from './types'

/**
 * The report's data model, and nothing about spreadsheets.
 *
 * Kept pure and separate from the ExcelJS layer for the reason spec §10 gives
 * for every number in this app: a silent bug here corrupts a document the client
 * makes payment decisions from, and a workbook is a poor thing to assert
 * against. What the sheets do is arrange these rows.
 *
 * Since 0024 progress is recorded per WORK (Sơn, Tháo giáo, ...), so the
 * Overview is one block per bays work and the deck sheet repeats its spec block
 * per work the deck is in. The figures come from the same `WorkModel` the
 * screens compute from, through the same domain functions.
 */

export interface DeckReportInput {
  /**
   * The deck and its mesh. The cells carry no state here: where a bay stands
   * is a per-work fact, and it lives in the work models handed in beside this.
   */
  deck: Deck
  zones: Zone[]
  /** Every stage change on the deck, across its works; the deck sheet lists them one per row. */
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
  /** The work the change belongs to, as named when it happened. */
  workName: string
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
  /** D_wd: this deck's weight in the work. Σ D on the subtotal row. */
  share: number
  totalAreaM2: number
  /** Cumulative area at each stage, keyed by stage NAME. A stage this deck does
   *  not declare is ABSENT, never 0 -- see buildOverview. */
  stageAreaM2: Record<string, number>
  /** The same figures as a share of this deck's declared area. */
  stageRatio: Record<string, number>
  progress: number
  remain: number
  isTotal: boolean
}

/** One bays work on the Overview: its own stage columns, a row per deck, its P_w. */
export interface OverviewBlock {
  work: Work
  /** The union of the block's decks' coats, by name, in work order. */
  stageNames: string[]
  /** The coat weight shown over each column, from the first deck declaring the name. */
  weights: Record<string, number>
  rows: OverviewRow[]
  /** P_w = Σ D·P_wd, with the block's stage areas summed. */
  subtotal: OverviewRow
}

export interface Overview {
  blocks: OverviewBlock[]
  /** The manual works (chứng từ, xà lan, ...): a figure, no decks. */
  manual: { work: Work; progress: number }[]
  /** P over the counted works. */
  total: { progress: number; remain: number }
}

export interface PlanRow {
  deckName: string
  zoneName: string
  /** The work whose coat the zone plans; a zone is planned against a coat, and a coat belongs to a (work, deck). */
  workName: string
  stageName: string
  areaM2: number
  /** Inclusive of both ends, or null when either date is unknown. */
  days: number | null
  startDate: string | null
  finishDate: string | null
}

/**
 * The stage columns one block carries, in work order.
 *
 * A union across the decks, keyed by NAME. A coat list belongs to a (work, deck),
 * so two decks of one work can carry different coat systems -- but the block
 * keeps one row per deck, because that is the shape the client already reads.
 * Keying on id would give two near-duplicate columns for what is plainly the
 * same coat under two rows.
 *
 * Ordered by the earliest seq any deck gives a name. Sorting by name would put
 * "Tháo giáo" first, which is the reverse of the work.
 */
export function reportStageColumns(entries: { stages: Stage[] }[]): string[] {
  const firstSeq = new Map<string, number>()
  for (const entry of entries) {
    for (const stage of entry.stages) {
      const seen = firstSeq.get(stage.name)
      if (seen === undefined || stage.seq < seen) firstSeq.set(stage.name, stage.seq)
    }
  }
  return [...firstSeq.entries()]
    .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))
    .map(([name]) => name)
}

/**
 * The Overview: a block per bays work, the manual works, then P (RPT-26).
 *
 * Every figure comes from `computeDeckProgress`, `computeWorkProgress` and
 * `computeProjectProgress` -- the functions the screens use, the first of them
 * asserted against the customer's own spreadsheet to 1e-9 (spec §3.3). Nothing
 * is recomputed: a second implementation of P is a second thing that can
 * disagree with the screen the admin just approved.
 *
 * A stage a deck does not declare is left OUT of that deck's maps rather than
 * written as 0. To somebody pricing the work those mean different things -- 0 is
 * "in the spec, none done", absent is "not in this deck's spec at all" -- and
 * the sheet renders the difference as a blank cell.
 *
 * A work with `counts = false` still gets its block: it is real work someone
 * tracks, it is simply not in P. The sheet greys it.
 */
export function buildOverview(models: WorkModel[]): Overview {
  const blocks: OverviewBlock[] = models
    .filter((m) => m.work.kind === 'bays')
    .map((model) => {
      const stageNames = reportStageColumns(model.decks)
      const weights: Record<string, number> = {}
      for (const name of stageNames) {
        for (const entry of model.decks) {
          const stage = entry.stages.find((s) => s.name === name)
          if (stage) { weights[name] = stage.weight; break }
        }
      }

      const rows: OverviewRow[] = model.decks.map((entry) => {
        const progress = computeDeckProgress(entry.deck, entry.stages)
        const stageAreaM2: Record<string, number> = {}
        const stageRatio: Record<string, number> = {}
        for (const sp of progress.stages) {
          stageAreaM2[sp.stage.name] = sp.cumulativeAreaM2
          stageRatio[sp.stage.name] = sp.ratio
        }
        return {
          code: entry.deck.code,
          name: entry.deck.name,
          share: entry.weight,
          totalAreaM2: entry.deck.totalAreaM2,
          stageAreaM2,
          stageRatio,
          progress: progress.progress,
          remain: 1 - progress.progress,
          isTotal: false,
        }
      })

      // The subtotal's per-stage areas are plain sums across the block's decks:
      // an area is an area, whatever spec produced it. Its ratios divide by the
      // block's total declared area.
      const totalArea = model.decks.reduce((sum, e) => sum + e.deck.totalAreaM2, 0)
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
      const work = computeWorkProgress(model)

      return {
        work: model.work,
        stageNames,
        weights,
        rows,
        subtotal: {
          code: '',
          name: `Cộng · ${model.work.name}`,
          share: model.decks.reduce((sum, e) => sum + e.weight, 0),
          totalAreaM2: totalArea,
          stageAreaM2,
          stageRatio,
          progress: work.progress,
          remain: 1 - work.progress,
          isTotal: true,
        },
      }
    })

  const project = computeProjectProgress(models)
  return {
    blocks,
    manual: project.works
      .filter((w) => w.work.kind === 'manual')
      .map((w) => ({ work: w.work, progress: w.progress })),
    total: { progress: project.progress, remain: 1 - project.progress },
  }
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
 * A zone is planned against a coat, and a coat belongs to a (work, deck), which
 * is how the row learns its work. A cell id the deck does not carry contributes
 * nothing, and a coat no work declares renders as a dash. Neither should arise
 * -- `zone_cells` and `zones.stage_id` both cascade -- but a report that throws
 * takes the whole export with it, and the admin loses the sheets that were fine.
 */
export function buildPlanRows(decks: DeckReportInput[], models: WorkModel[]): PlanRow[] {
  const coats = new Map<string, { workName: string; stageName: string }>()
  for (const model of models) {
    for (const entry of model.decks) {
      for (const stage of entry.stages) {
        coats.set(stage.id, { workName: model.work.name, stageName: stage.name })
      }
    }
  }

  const rows: PlanRow[] = []
  for (const input of decks) {
    const areaById = new Map(input.deck.cells.map((c) => [c.id, c.areaM2]))
    for (const zone of input.zones) {
      const days = zone.startDate && zone.finishDate
        ? dayjs(zone.finishDate).diff(dayjs(zone.startDate), 'day') + 1
        : null
      const coat = coats.get(zone.stageId)
      rows.push({
        deckName: input.deck.name,
        zoneName: zone.name,
        workName: coat?.workName ?? '—',
        stageName: coat?.stageName ?? '—',
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
 * The deck sheet's list: one row per stage change, in bay order and then in
 * the order they happened, so reading down a bay shows the steps it went
 * through -- in every work it is in. A bay nobody has touched has no row --
 * Linh, on the report: "GS cập nhật ô nào thì report có thêm 1 hàng. Không
 * thì thôi."
 *
 * The note column is where 0023's decisions land and nowhere else: the
 * admin's report copy if she wrote one, nothing if she hid the note, the
 * foreman's words otherwise. The screens never apply either.
 *
 * An unknown `updated_by` renders as the raw id rather than blank: the id is
 * still traceable in `cell_events`, and a blank would read as "nobody".
 */
export function buildEventRows(input: DeckReportInput): EventRow[] {
  return [...input.events]
    .sort((a, b) => a.cellCode.localeCompare(b.cellCode) || a.at.localeCompare(b.at))
    .map((ev) => ({
      code: ev.cellCode,
      areaM2: ev.cellAreaM2,
      workName: ev.workName ?? '',
      stageName: ev.toStageName ?? 'Chưa bắt đầu',
      at: ev.at,
      // The id is still traceable through cell_events; a blank would read as
      // "nobody did this", which is a different and wrong claim.
      byName: ev.byId === null ? null : input.userNames?.[ev.byId] ?? ev.byId,
      note: ev.reportHidden ? '' : ev.reportNote ?? ev.note,
    }))
}
