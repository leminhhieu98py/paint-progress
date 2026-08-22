export interface Stage {
  id: string
  /** 1-based, ascending. Defines the sequence a cell advances through. */
  seq: number
  name: string
  /** Hex, e.g. '#1677ff'. */
  color: string
  /** 0..1. Across a project's stages these sum to 1. */
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
