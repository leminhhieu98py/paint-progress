export interface Stage {
  id: string
  /** 1-based, ascending. Defines the sequence a cell advances through. */
  seq: number
  name: string
  /** Hex, e.g. '#1677ff'. */
  color: string
  /** 0..1. Across one DECK's stages these sum to 1. */
  weight: number
}

export interface Cell {
  id: string
  code: string
  /** Normalized 0..1 against the drawing image. */
  x: number
  y: number
  w: number
  h: number
  areaM2: number
  /** null means not started. */
  stageId: string | null
  /**
   * What the foreman wrote when they last moved this bay's stage. Empty or
   * absent means none.
   *
   * Optional rather than required, deliberately. Every screen that draws a bay
   * builds one of these, and most of them -- the geometry editor, the report,
   * the pie -- have no business knowing about notes; making it required would
   * put an empty string in a hundred and sixty places to satisfy a field none
   * of them read. Treat undefined and '' as the same thing.
   */
  note?: string
}

export interface Deck {
  id: string
  code: string
  name: string
  /** Authoritative deck area. The denominator for every percentage. */
  totalAreaM2: number
  cells: Cell[]
}

export interface StageProgress {
  stage: Stage
  /** A_i — area of every cell at or past this stage. */
  cumulativeAreaM2: number
  /** p_i = A_i / deck.totalAreaM2. */
  ratio: number
}

export interface DeckProgress {
  deckId: string
  stages: StageProgress[]
  /** Σ wᵢ·pᵢ */
  progress: number
}

export type WeightedDeckProgress = DeckProgress & {
  /** deck.totalAreaM2 / Σ totalAreaM2 across the project. */
  weight: number
}

/** The pre-work-items rollup: decks weighted by their share of the project's
 *  declared area. Kept for the screens that have not moved to works yet. */
export interface AreaWeightedProjectProgress {
  decks: WeightedDeckProgress[]
  progress: number
}

/**
 * A work item (Công việc): one discipline the project is paid for -- sơn, tháo
 * giáo, dọn dẹp, marking. Linh's workbook puts these above the decks, each
 * with its own weight, and some of them outside the project total.
 */
export type WorkKind = 'bays' | 'manual'

export interface Work {
  id: string
  projectId: string
  /** 1-based, ascending; the order the screens and the report list works in. */
  seq: number
  name: string
  /** 'bays' is tracked bay by bay on the drawings; 'manual' is a percentage
   *  the admin types (no bays, no coats). */
  kind: WorkKind
  /** W_w, 0..1. Across the works that count, these sum to 1. */
  weight: number
  /** Tính vào tổng: whether W_w enters the project total. */
  counts: boolean
  /** 0..1; read only for kind 'manual'. */
  manualProgress: number
}

/** One deck's part in one bays work. */
export interface WorkDeckEntry {
  /** The deck with its cells PROJECTED FOR THIS WORK: `stageId` and `note`
   *  come from cell_states for (cell, work), not from the cell itself. */
  deck: Deck
  /** This (work, deck)'s own coats; weights sum to 1. */
  stages: Stage[]
  /** D_wd, 0..1. Across the decks in one work these sum to 1. */
  weight: number
}

export interface WorkModel {
  work: Work
  /** Empty for a manual work. */
  decks: WorkDeckEntry[]
}

export interface WorkProgress {
  work: Work
  /** P_w: Σ D·P_wd for a bays work, manualProgress for a manual one. */
  progress: number
  decks: WeightedDeckProgress[]
}

export interface ProjectProgress {
  /** Every work, counted or not, so the screens can show all of them. */
  works: WorkProgress[]
  /** P = Σ over counted works of W·P_w. */
  progress: number
}

/**
 * One deck's "tổng hợp" figure: its per-work progress averaged by the weight
 * each (work, deck) carries in the project total, W·D. A convenience for the
 * deck header, the GS tab and the deck list -- the billed number is P, above.
 */
export interface DeckSummary {
  deckId: string
  progress: number
  /** Σ over counted bays works containing the deck of W·D -- what the deck
   *  weighs in P. */
  effectiveWeight: number
  perWork: Array<{ work: Work; weight: number; progress: number }>
}

export interface MeshCell {
  code: string
  x: number
  y: number
  w: number
  h: number
  areaM2: number
}

/**
 * A named group of cells carrying a planned date range for one stage — the
 * `Kế hoạch tháo GG` sheet, and the dated annotations on the source PDFs.
 *
 * `startDate` / `finishDate` are ISO date-only strings ('2026-08-13') as
 * PostgREST returns a `date` column, never Date objects: a Date would carry a
 * timezone this value does not have, and formatting it locally shifts the day.
 */
export interface Zone {
  id: string
  name: string
  stageId: string
  startDate: string | null
  finishDate: string | null
  /** Admin-chosen '#rrggbb' (0027), or null for the palette colour by position. */
  color: string | null
  /** cells.id, not code. */
  cellIds: string[]
}

/**
 * The effort recorded with one bay update (Feedback Rv2, item 11; 0030): who
 * led, who painted, the man-hours spent and the man-hours lost. Every field is
 * optional for the foreman -- Linh: "nếu có" -- so the names are '' and the
 * hours null when not given. Hours are Mhr (man-hours), as the customer's
 * workbook counts them.
 */
export interface Effort {
  leadName: string
  painterName: string
  /** Mhr spent on the bay in this update. Null: not recorded. */
  workHours: number | null
  /** Mhr lost on the bay in this update. Null: not recorded. Never enters Mhr/m². */
  wasteHours: number | null
  /** Why the hours were lost. Empty unless wasteHours > 0. */
  wasteReason: string
}

export const EMPTY_EFFORT: Effort = {
  leadName: '', painterName: '', workHours: null, wasteHours: null, wasteReason: '',
}

/**
 * One stage change on one bay, as `cell_events` records it and as the XLSX
 * deck sheet lists it -- one row per update (Feedback Rv1, item 8).
 */
export interface DeckEvent {
  id: number
  /** The deck the bay belongs to, named so a project-wide list can group by it. */
  deckName: string
  cellCode: string
  cellAreaM2: number
  /** The work the change belongs to, denormalised on the event (0024). Null on
   *  rows older than the work model whose cell is gone. */
  workName: string | null
  /** The coat the bay moved TO. Null for a move back to "not started". */
  toStageName: string | null
  at: string
  byId: string | null
  /** Empty when the foreman wrote nothing. */
  note: string
  /** The admin's version for the XLSX (0023). Null: print `note` as written. */
  reportNote: string | null
  /** True keeps the note out of the XLSX. */
  reportHidden: boolean
  /** As recorded with the change, or as the admin backfilled it (0030). */
  effort: Effort
  /** Stamp of the admin backfill, null when the effort is as the GS wrote it. */
  effortEditedAt: string | null
  effortEditedByName: string | null
}
