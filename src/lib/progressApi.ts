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
  + ' cells(id, code, x, y, w, h, area_m2, stage_id, note, updated_at, updated_by)'

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
          note: (c.note as string | null) ?? '',
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

/** One note a foreman left on a bay, with the coat it was recorded against. */
export interface CellNote {
  /** cell_events.id -- stable, and the only key a list of notes can use: two
   *  notes on one bay can share a coat, a person and even a minute. */
  id: number
  at: string
  /** The coat the bay moved TO. Null for a move back to "not started". */
  stageName: string | null
  note: string
  byName: string | null
  byUsername: string | null
  /** cell_events.by. Present even when `profiles` refuses the join: a tablet
   *  cannot read other people's profiles and resolves the name elsewhere. */
  byId: string | null
  /** The admin's version for the XLSX (0023). Null: print `note` as written. */
  reportNote: string | null
  /** True keeps the note out of the XLSX. The screens still show it. */
  reportHidden: boolean
  reportEditedByName: string | null
  reportEditedAt: string | null
}

/**
 * Every note ever left on one bay, newest first.
 *
 * `cells.note` holds only the latest one -- it is overwritten by each stage
 * change, because the drawing needs one flag per bay and the tablet writes the
 * note in the same statement as the coat. The history is in `cell_events`,
 * where 0019 copies each note as it was written, so a bay that went Blast →
 * Coat 2 → Coat 3 with a remark at each step has all three here and one on
 * `cells`.
 *
 * That is the whole reason this exists: the admin was reading a single line and
 * had no way to know it was the third of three, or what the first two said
 * about the bay they are being asked to pay for.
 *
 * Newest first, unlike a chat thread. Each note belongs to a different coat and
 * the current one is the one being acted on; making the reader scroll a
 * five-coat history to reach it would be the wrong way round.
 *
 * Events with no note are dropped rather than rendered blank: a stage change
 * without a remark is not a message, and 184 empty rows would bury the ones
 * that are.
 *
 * Two joins onto `profiles` -- the author and, since 0023, whoever last
 * touched the report copy -- so each names its foreign key; PostgREST cannot
 * pick between two paths to one table on its own. The raw `by` id travels
 * beside the author embed because the embed is behind profiles' RLS: on a
 * tablet it comes back null, and the GS screen resolves the name through
 * `coworker_names()` instead.
 */
export async function listCellNotes(cellId: string): Promise<CellNote[]> {
  const { data, error } = await supabase
    .from('cell_events')
    .select(
      'id, at, to_stage_name, note, by, author:profiles!cell_events_by_fkey(username, full_name),'
      + ' report_note, report_hidden, report_edited_at,'
      + ' report_editor:profiles!cell_events_report_edited_by_fkey(full_name)',
    )
    .eq('cell_id', cellId)
    .order('at', { ascending: false })
  if (error) throw new Error(error.message)

  return (data ?? [])
    .map((r) => {
      const row = r as unknown as Record<string, unknown>
      const author = row.author as { username?: string; full_name?: string } | null
      const editor = row.report_editor as { full_name?: string } | null
      return {
        id: Number(row.id),
        at: row.at as string,
        stageName: (row.to_stage_name as string | null) ?? null,
        // Null on events recorded before 0019, empty on a change with no
        // remark. Both mean "nothing was written".
        note: ((row.note as string | null) ?? '').trim(),
        byName: author?.full_name ?? null,
        byUsername: author?.username ?? null,
        byId: (row.by as string | null) ?? null,
        reportNote: (row.report_note as string | null) ?? null,
        reportHidden: Boolean(row.report_hidden),
        reportEditedByName: editor?.full_name ?? null,
        reportEditedAt: (row.report_edited_at as string | null) ?? null,
      }
    })
    .filter((n) => n.note !== '')
}

/**
 * The admin's report-facing decision about one note (0023).
 *
 * Through the definer function, never the table: 0008 revoked every client
 * write on `cell_events` and nothing here re-grants one. The function checks
 * `is_admin()` itself and stamps who and when.
 *
 * Whitespace is sent as null. The dialog prefills the box with the current
 * text, so "clear it and save" is how the admin says "print the original
 * again" -- storing '' would print an empty cell instead.
 */
export async function setReportNote(
  eventId: number,
  reportNote: string | null,
  hidden: boolean,
): Promise<void> {
  const trimmed = (reportNote ?? '').trim()
  const { error } = await supabase.rpc('set_report_note', {
    p_event_id: eventId,
    p_report_note: trimmed === '' ? null : trimmed,
    p_hidden: hidden,
  })
  if (error) throw new Error(error.message)
}

/** One stage change on one bay, as the XLSX deck sheet lists it. */
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
  reportNote: string | null
  reportHidden: boolean
}

/**
 * Every stage change on one deck, oldest first.
 *
 * The report's per-deck sheet lists these one per row -- the client asked for
 * the history of what was done, not a snapshot of where each bay stands
 * (Feedback Rv1: "100 ô, full 4 lớp = 400 hàng").
 *
 * `cell_events` carries no deck id; the deck is reached through the cell.
 * `!inner` matters: without it PostgREST treats the embedded filter as a
 * condition on the EMBED and returns every event on every deck with `cells`
 * nulled where it did not match -- a report of the whole project under one
 * deck's name.
 *
 * Unlike `listCellNotes`, events with no note are KEPT. There the note is the
 * point; here the change is, and a coat recorded without a remark is still a
 * coat recorded.
 */
export async function listDeckEvents(deckId: string): Promise<DeckEvent[]> {
  const { data, error } = await supabase
    .from('cell_events')
    .select(
      'id, at, to_stage_name, by, note, report_note, report_hidden,'
      + ' cells!inner(deck_id, code, area_m2)',
    )
    .eq('cells.deck_id', deckId)
    .order('at', { ascending: true })
  if (error) throw new Error(error.message)

  return (data ?? []).map((r) => {
    const row = r as unknown as Record<string, unknown>
    // A many-to-one embed: PostgREST returns one object, whatever supabase-js
    // infers without a generated Database type (see adminApi.listGsUsers).
    const cell = row.cells as unknown as { code: string; area_m2: string | number }
    return {
      id: Number(row.id),
      cellCode: cell.code,
      cellAreaM2: Number(cell.area_m2),
      toStageName: (row.to_stage_name as string | null) ?? null,
      at: row.at as string,
      byId: (row.by as string | null) ?? null,
      note: ((row.note as string | null) ?? '').trim(),
      reportNote: (row.report_note as string | null) ?? null,
      reportHidden: Boolean(row.report_hidden),
    }
  })
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
