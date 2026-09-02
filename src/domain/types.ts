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

export interface ProjectProgress {
  decks: WeightedDeckProgress[]
  progress: number
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
  /** cells.id, not code. */
  cellIds: string[]
}

/**
 * One stage change on one bay, as `cell_events` records it and as the XLSX
 * deck sheet lists it -- one row per update (Feedback Rv1, item 8).
 */
export interface DeckEvent {
  id: number
  cellCode: string
  cellAreaM2: number
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
}
