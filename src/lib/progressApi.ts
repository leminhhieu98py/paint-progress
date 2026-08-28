import type { Cell, Deck, Stage } from '../domain/types'
import { supabase } from './supabase'

/**
 * One deck as `/admin/progress` needs it: the whole deck, its own paint spec,
 * and enough of the drawing to render it.
 *
 * Deliberately not `ProjectRow` from projectsApi, which carries one rolled-up
 * percentage per project and no geometry, and not `GsDeck` from gsApi, which
 * carries no stages and no cells. The progress screen draws two canvases over
 * the real bays and needs all of it in one shape.
 */
/** Who last moved a cell's stage, and when. Kept beside the deck rather than on
 *  `Cell`: the domain type is the geometry and the progress, and every screen
 *  that draws a bay would otherwise carry two fields it never reads. Only the
 *  per-deck report sheet wants them. */
export interface CellAudit {
  updatedAt: string | null
  updatedBy: string | null
}

export interface DeckProgressEntry {
  seq: number
  deck: Deck
  stages: Stage[]
  imagePath: string | null
  imageW: number | null
  imageH: number | null
  /** 'prorated' means the areas were divided out of the declared deck total
   *  rather than measured off guides -- spec §9 requires the report to say so. */
  areaSource: 'guides' | 'prorated'
  /** Keyed by cell id. */
  audit: Record<string, CellAudit>
}

/**
 * Every deck of a project, each with its own stages and cells, in one query.
 *
 * One round trip rather than one per deck: the screen's deck selector switches
 * instantly, and `computeProjectProgress` needs every deck at once anyway to
 * weight them against each other. A project has a handful of decks and a few
 * hundred cells, so the payload is small enough to hold.
 *
 * Full geometry, unlike `listProjects` -- this screen draws the cells, it does
 * not only count them.
 */
const DECK_SELECT =
  'id, seq, code, name, total_area_m2, area_source, image_path, image_w, image_h,'
  + ' deck_stages(id, seq, name, color, weight),'
  + ' cells(id, code, x, y, w, h, area_m2, stage_id, updated_at, updated_by)'

/**
 * One deck, for the panel inside its own detail screen.
 *
 * The same select and the same mapper as the project read, so the deck's own
 * screen and the project rollup cannot disagree about what a deck is.
 */
export async function loadDeckProgress(deckId: string): Promise<DeckProgressEntry | null> {
  const { data, error } = await supabase.from('decks').select(DECK_SELECT).eq('id', deckId)
  if (error) throw new Error(error.message)
  const row = (data ?? [])[0]
  return row ? mapDeckRow(row) : null
}

export async function loadProjectProgress(projectId: string): Promise<DeckProgressEntry[]> {
  const { data, error } = await supabase
    .from('decks')
    .select(DECK_SELECT)
    .eq('project_id', projectId)
    .order('seq')
  if (error) throw new Error(error.message)

  return (data ?? []).map(mapDeckRow)
}

function mapDeckRow(row: unknown): DeckProgressEntry {
    // Through `unknown`: postgrest-js types an embedded relation as a union
    // with its own error shape, which does not overlap an index signature.
    // Every field below is read defensively anyway.
  const r = row as unknown as Record<string, unknown>
    return {
      seq: r.seq as number,
      // Sorted here rather than trusted from the embed: PostgREST returns an
      // embedded set in whatever order the planner chose, and every consumer of
      // this list -- nextStage, the spec table, scaffoldLensColors -- reads the
      // sequence. An unsorted list silently reorders the paint system.
      stages: ((r.deck_stages ?? []) as Record<string, unknown>[])
        .map((s): Stage => ({
          id: s.id as string,
          seq: s.seq as number,
          name: s.name as string,
          color: s.color as string,
          weight: Number(s.weight),
        }))
        .sort((a, b) => a.seq - b.seq),
      areaSource: ((r.area_source as string | null) ?? 'guides') as 'guides' | 'prorated',
      audit: Object.fromEntries(
        ((r.cells ?? []) as Record<string, unknown>[]).map((c) => [
          c.id as string,
          {
            updatedAt: (c.updated_at as string | null) ?? null,
            updatedBy: (c.updated_by as string | null) ?? null,
          },
        ]),
      ),
      imagePath: (r.image_path as string | null) ?? null,
      imageW: (r.image_w as number | null) ?? null,
      imageH: (r.image_h as number | null) ?? null,
      deck: {
        id: r.id as string,
        code: r.code as string,
        name: r.name as string,
        totalAreaM2: Number(r.total_area_m2),
        // Every numeric column coerced. PostgREST serialises `numeric` as a
        // string, and an uncoerced area makes `sum + cell.areaM2` concatenate,
        // which renders as a plausible-looking number rather than throwing.
        cells: ((r.cells ?? []) as Record<string, unknown>[]).map((c): Cell => ({
          id: c.id as string,
          code: c.code as string,
          x: Number(c.x),
          y: Number(c.y),
          w: Number(c.w),
          h: Number(c.h),
          areaM2: Number(c.area_m2),
          stageId: (c.stage_id as string | null) ?? null,
        })),
      } satisfies Deck,
  }
}

/** The most recent stage change anyone made, anywhere the reader can see. */
export interface ProgressEvent {
  /** ISO timestamp, as `timestamptz` comes back from PostgREST. */
  at: string
  cellCode: string
  /** null is a bay sent back to "not started", which is a real thing a GS does. */
  toStageName: string | null
  byName: string | null
  byUsername: string | null
}

/**
 * The single newest row of `cell_events`.
 *
 * Answers the one question the projects header cannot answer from the rollup:
 * is anything still happening? A percentage that has not moved in a week looks
 * exactly like one that moved five minutes ago.
 *
 * Read from `cell_events` rather than from `cells.updated_at` because the
 * event carries the stage NAME the bay moved to. 0005 denormalised those names
 * onto the event precisely so this read needs no join to `project_stages` --
 * and so the record survives the stage row being deleted afterwards.
 *
 * Scoped by RLS, not by an argument: `cell_events_admin_read` gives an admin
 * every row and `cell_events_member_read` gives a GS only their own projects'.
 * Passing a project id here would be a filter the database already applies.
 */
export async function latestProgressEvent(): Promise<ProgressEvent | null> {
  const { data, error } = await supabase
    .from('cell_events')
    .select('at, to_stage_name, cells(code), by:profiles(username, full_name)')
    .order('at', { ascending: false })
    .limit(1)
  if (error) throw new Error(error.message)

  const row = (data ?? [])[0] as Record<string, unknown> | undefined
  if (!row) return null

  const cell = row.cells as { code?: string } | null
  const by = row.by as { username?: string; full_name?: string } | null
  return {
    at: row.at as string,
    cellCode: cell?.code ?? '',
    toStageName: (row.to_stage_name as string | null) ?? null,
    byName: by?.full_name ?? null,
    byUsername: by?.username ?? null,
  }
}
