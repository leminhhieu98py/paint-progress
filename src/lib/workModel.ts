import type { Cell, Deck, Stage, Work, WorkKind, WorkModel } from '../domain/types'

/**
 * From PostgREST rows to the domain's work model, in one place.
 *
 * Three loaders read the same tables in different shapes -- the project list
 * embeds everything in one query, the deck screen reads one deck's slice, the
 * GS tabs read a handful of decks -- and every one of them has to make the
 * same decisions: which bays belong to which work, which coats to which
 * (work, deck), which state row projects onto which bay. Making those
 * decisions here, on plain rows, means they are made once and tested once,
 * and the loaders only decide what to select.
 *
 * Numbers arrive as strings (PostgREST serialises `numeric` that way) and are
 * coerced here; a missing Number() somewhere downstream turns a sum into a
 * concatenation and renders as a plausible-looking figure.
 */

export interface WorkRow {
  id: string
  project_id: string
  seq: number
  name: string
  kind: string
  weight: string | number
  counts: boolean
  manual_progress: string | number
}

export interface WorkDeckRow {
  work_id: string
  deck_id: string
  weight: string | number
  /** 0031. ISO date-only, or null/absent when no deadline is set. */
  deadline?: string | null
}

export interface CellRowIn {
  id: string
  code: string
  x?: string | number
  y?: string | number
  w?: string | number
  h?: string | number
  area_m2: string | number
}

export interface StageRowIn {
  id: string
  work_id: string
  deck_id?: string
  seq: number
  name: string
  color: string
  weight: string | number
}

export interface DeckRowIn {
  id: string
  seq?: number
  code: string
  name: string
  total_area_m2: string | number
  image_path?: string | null
  image_w?: number | null
  image_h?: number | null
  area_source?: string | null
  cells?: CellRowIn[]
  deck_stages?: StageRowIn[]
}

export interface StateRowIn {
  cell_id: string
  work_id: string
  deck_id?: string
  stage_id: string | null
  note?: string | null
  updated_at?: string | null
  updated_by?: string | null
}

/** A deck as the lists and the report want it: identity, drawing, size. */
export interface DeckMeta {
  id: string
  seq: number
  code: string
  name: string
  totalAreaM2: number
  imagePath: string | null
  imageW: number | null
  imageH: number | null
  areaSource: 'guides' | 'prorated'
  cellCount: number
}

export interface StateAudit {
  updatedAt: string | null
  updatedBy: string | null
}

export interface ProjectModel {
  /** Every work, in seq order, each bays work carrying its decks in deck seq order. */
  models: WorkModel[]
  /** Every deck once, in seq order, whether or not any work covers it. */
  decks: DeckMeta[]
  /** Who last moved each bay, per work: audit[workId][cellId]. */
  audit: Record<string, Record<string, StateAudit>>
}

export function mapWork(row: WorkRow): Work {
  return {
    id: row.id,
    projectId: row.project_id,
    seq: row.seq,
    name: row.name,
    kind: row.kind as WorkKind,
    weight: Number(row.weight),
    counts: Boolean(row.counts),
    manualProgress: Number(row.manual_progress),
  }
}

export function mapStage(row: StageRowIn): Stage {
  return {
    id: row.id,
    seq: row.seq,
    name: row.name,
    color: row.color,
    weight: Number(row.weight),
  }
}

export function mapDeckMeta(row: DeckRowIn): DeckMeta {
  return {
    id: row.id,
    seq: row.seq ?? 0,
    code: row.code,
    name: row.name,
    totalAreaM2: Number(row.total_area_m2),
    imagePath: row.image_path ?? null,
    imageW: row.image_w ?? null,
    imageH: row.image_h ?? null,
    areaSource: (row.area_source ?? 'guides') as 'guides' | 'prorated',
    cellCount: (row.cells ?? []).length,
  }
}

/**
 * Projects a deck's geometry for one work: every bay carries the stage and
 * note its state row for that work holds, or not-started when there is none.
 */
function projectDeck(row: DeckRowIn, states: Map<string, StateRowIn>): Deck {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    totalAreaM2: Number(row.total_area_m2),
    cells: (row.cells ?? []).map((c): Cell => {
      const st = states.get(c.id)
      return {
        id: c.id,
        code: c.code,
        x: Number(c.x ?? 0),
        y: Number(c.y ?? 0),
        w: Number(c.w ?? 0),
        h: Number(c.h ?? 0),
        areaM2: Number(c.area_m2),
        stageId: st?.stage_id ?? null,
        note: st?.note ?? '',
      }
    }),
  }
}

export function assembleProjectModel(input: {
  works: WorkRow[]
  workDecks: WorkDeckRow[]
  decks: DeckRowIn[]
  states: StateRowIn[]
}): ProjectModel {
  const deckRows = [...input.decks].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))
  const deckById = new Map(deckRows.map((d) => [d.id, d]))
  const deckOrder = new Map(deckRows.map((d, i) => [d.id, i]))

  // states[workId] -> cellId -> row
  const statesByWork = new Map<string, Map<string, StateRowIn>>()
  const audit: ProjectModel['audit'] = {}
  for (const st of input.states) {
    let byCell = statesByWork.get(st.work_id)
    if (!byCell) {
      byCell = new Map()
      statesByWork.set(st.work_id, byCell)
    }
    byCell.set(st.cell_id, st)
    ;(audit[st.work_id] ??= {})[st.cell_id] = {
      updatedAt: st.updated_at ?? null,
      updatedBy: st.updated_by ?? null,
    }
  }

  const models: WorkModel[] = [...input.works]
    .sort((a, b) => a.seq - b.seq)
    .map((row) => {
      const work = mapWork(row)
      if (work.kind !== 'bays') return { work, decks: [] }
      const states = statesByWork.get(work.id) ?? new Map<string, StateRowIn>()
      const decks = input.workDecks
        .filter((wd) => wd.work_id === work.id && deckById.has(wd.deck_id))
        .sort((a, b) => (deckOrder.get(a.deck_id) ?? 0) - (deckOrder.get(b.deck_id) ?? 0))
        .map((wd) => {
          const deckRow = deckById.get(wd.deck_id)!
          return {
            deck: projectDeck(deckRow, states),
            stages: (deckRow.deck_stages ?? [])
              .filter((s) => s.work_id === work.id && (s.deck_id === undefined || s.deck_id === deckRow.id))
              .map(mapStage)
              .sort((a, b) => a.seq - b.seq),
            weight: Number(wd.weight),
            deadline: wd.deadline ?? null,
          }
        })
      return { work, decks }
    })

  return { models, decks: deckRows.map(mapDeckMeta), audit }
}
