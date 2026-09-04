import type { Cell, Deck, DeckEvent, Effort, Stage, Work } from '../domain/types'
import { supabase } from './supabase'
import {
  assembleProjectModel, type DeckRowIn, type ProjectModel, type StateRowIn, type WorkDeckRow,
  type WorkRow,
} from './workModel'

export type { DeckEvent } from '../domain/types'
export type { DeckMeta, ProjectModel } from './workModel'

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

const DECK_SELECT =
  'id, seq, code, name, total_area_m2, area_source, image_path, image_w, image_h,'
  + ' cells(id, code, x, y, w, h, area_m2),'
  + ' deck_stages(id, work_id, deck_id, seq, name, color, weight)'
const WORK_SELECT = 'id, project_id, seq, name, kind, weight, counts, manual_progress'
const STATE_SELECT = 'cell_id, work_id, deck_id, stage_id, note, updated_at, updated_by'

/**
 * The whole project as the work model: every work with its decks, each deck's
 * bays projected for that work, plus the deck list and the per-work audit.
 *
 * Three reads -- works (with their deck weights), decks (with geometry and
 * coats), states -- assembled by `assembleProjectModel`, which is where the
 * decisions live and are tested. The state read is skipped when there are no
 * decks: `.in('deck_id', [])` is a round trip for nothing.
 */
export async function loadProjectModel(projectId: string): Promise<ProjectModel> {
  const worksQuery = await supabase
    .from('works')
    .select(`${WORK_SELECT}, work_decks(deck_id, weight)`)
    .eq('project_id', projectId)
    .order('seq')
  if (worksQuery.error) throw new Error(worksQuery.error.message)
  const decksQuery = await supabase
    .from('decks')
    .select(DECK_SELECT)
    .eq('project_id', projectId)
    .order('seq')
  if (decksQuery.error) throw new Error(decksQuery.error.message)

  const works = (worksQuery.data ?? []) as unknown as (WorkRow & { work_decks?: WorkDeckRow[] })[]
  const decks = (decksQuery.data ?? []) as unknown as DeckRowIn[]
  const deckIds = decks.map((d) => d.id)

  let states: StateRowIn[] = []
  if (deckIds.length > 0) {
    const statesQuery = await supabase.from('cell_states').select(STATE_SELECT).in('deck_id', deckIds)
    if (statesQuery.error) throw new Error(statesQuery.error.message)
    states = (statesQuery.data ?? []) as unknown as StateRowIn[]
  }

  return assembleProjectModel({
    works,
    workDecks: works.flatMap((w) => (w.work_decks ?? []).map((wd) => ({ ...wd, work_id: w.id }))),
    decks,
    states,
  })
}

/** One deck seen through one bays work: its coats and its bays' states for that work. */
export interface DeckWorkView {
  work: Work
  /** D_wd. */
  weight: number
  stages: Stage[]
  /** The deck's bays projected for this work. */
  cells: Cell[]
  /** Keyed by cell id. */
  audit: Record<string, CellAudit>
}

/** A deck with one view per bays work it is part of. */
export interface DeckWorks {
  seq: number
  /** Geometry; every bay reads not-started here. The views carry the states. */
  deck: Deck
  imagePath: string | null
  imageW: number | null
  imageH: number | null
  areaSource: 'guides' | 'prorated'
  works: DeckWorkView[]
}

/**
 * One deck for its own screen: geometry once, and a view per bays work the
 * deck is part of. Reads the deck, its work memberships (with each work
 * embedded), and its states; assembles through the same function the project
 * loader uses, so the two screens cannot disagree about a bay.
 */
export async function loadDeckWorks(deckId: string): Promise<DeckWorks | null> {
  const deckQuery = await supabase.from('decks').select(DECK_SELECT).eq('id', deckId)
  if (deckQuery.error) throw new Error(deckQuery.error.message)
  const deckRow = ((deckQuery.data ?? []) as unknown as DeckRowIn[])[0]
  if (!deckRow) return null

  const membershipQuery = await supabase
    .from('work_decks')
    .select(`work_id, deck_id, weight, works!inner(${WORK_SELECT})`)
    .eq('deck_id', deckId)
  if (membershipQuery.error) throw new Error(membershipQuery.error.message)
  const statesQuery = await supabase.from('cell_states').select(STATE_SELECT).eq('deck_id', deckId)
  if (statesQuery.error) throw new Error(statesQuery.error.message)

  const memberships = (membershipQuery.data ?? []) as unknown as (WorkDeckRow & { works: WorkRow })[]
  const model = assembleProjectModel({
    works: memberships.map((m) => m.works),
    workDecks: memberships,
    decks: [deckRow],
    states: (statesQuery.data ?? []) as unknown as StateRowIn[],
  })

  const meta = model.decks[0]
  return {
    seq: meta.seq,
    deck: {
      id: meta.id,
      code: meta.code,
      name: meta.name,
      totalAreaM2: meta.totalAreaM2,
      cells: (deckRow.cells ?? []).map((c): Cell => ({
        id: c.id,
        code: c.code,
        x: Number(c.x ?? 0),
        y: Number(c.y ?? 0),
        w: Number(c.w ?? 0),
        h: Number(c.h ?? 0),
        areaM2: Number(c.area_m2),
        stageId: null,
        note: '',
      })),
    },
    imagePath: meta.imagePath,
    imageW: meta.imageW,
    imageH: meta.imageH,
    areaSource: meta.areaSource,
    works: model.models
      .filter((m) => m.work.kind === 'bays' && m.decks.length > 0)
      .map((m) => ({
        work: m.work,
        weight: m.decks[0].weight,
        stages: m.decks[0].stages,
        cells: m.decks[0].deck.cells,
        audit: model.audit[m.work.id] ?? {},
      })),
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
  /** The work the note's stage change belongs to (0024). */
  workName: string | null
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
      'id, at, to_stage_name, work_name, note, by, author:profiles!cell_events_by_fkey(username, full_name),'
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
        workName: (row.work_name as string | null) ?? null,
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
const EVENT_SELECT =
  'id, at, to_stage_name, work_name, by, note, report_note, report_hidden,'
  + ' lead_name, painter_name, work_hours, waste_hours, waste_reason, effort_edited_at,'
  + ' effort_editor:profiles!cell_events_effort_edited_by_fkey(full_name),'
  + ' cells!inner(deck_id, code, area_m2, decks!inner(name, project_id))'

const numberOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v))

/** One `cell_events` row with the embeds EVENT_SELECT asks for. */
function mapEventRow(r: unknown): DeckEvent {
  const row = r as Record<string, unknown>
  // A many-to-one embed: PostgREST returns one object, whatever supabase-js
  // infers without a generated Database type (see adminApi.listGsUsers).
  const cell = row.cells as unknown as { code: string; area_m2: string | number; decks: { name: string } }
  const editor = row.effort_editor as { full_name?: string } | null
  return {
    id: Number(row.id),
    deckName: cell.decks?.name ?? '',
    cellCode: cell.code,
    cellAreaM2: Number(cell.area_m2),
    workName: (row.work_name as string | null) ?? null,
    toStageName: (row.to_stage_name as string | null) ?? null,
    at: row.at as string,
    byId: (row.by as string | null) ?? null,
    note: ((row.note as string | null) ?? '').trim(),
    reportNote: (row.report_note as string | null) ?? null,
    reportHidden: Boolean(row.report_hidden),
    // Rows before 0030 hold null in every effort column; the domain reads ''
    // and null, never undefined, so the blanks are normalised here.
    effort: {
      leadName: (row.lead_name as string | null) ?? '',
      painterName: (row.painter_name as string | null) ?? '',
      workHours: numberOrNull(row.work_hours),
      wasteHours: numberOrNull(row.waste_hours),
      wasteReason: (row.waste_reason as string | null) ?? '',
    },
    effortEditedAt: (row.effort_edited_at as string | null) ?? null,
    effortEditedByName: editor?.full_name ?? null,
  }
}

export async function listDeckEvents(deckId: string): Promise<DeckEvent[]> {
  const { data, error } = await supabase
    .from('cell_events')
    .select(EVENT_SELECT)
    .eq('cells.deck_id', deckId)
    .order('at', { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []).map(mapEventRow)
}

/**
 * Every stage change in one project, oldest first, for the productivity
 * dashboard (Feedback Rv2, item 12). Reached through cell -> deck, both
 * `!inner` so the project filter filters rows. RLS scopes a GS or viewer to
 * the works they hold (`my_works()`, 0028), so the same call serves every role.
 */
export async function listProjectEvents(projectId: string): Promise<DeckEvent[]> {
  const { data, error } = await supabase
    .from('cell_events')
    .select(EVENT_SELECT)
    .eq('cells.decks.project_id', projectId)
    .order('at', { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []).map(mapEventRow)
}

/**
 * Admin backfill of the effort on one event (0030): Linh's answer to the rows
 * written before hours existed. Like `setReportNote`, a definer function that
 * checks `is_admin()` itself and stamps who and when; nothing here re-grants a
 * write on `cell_events`. Names are trimmed here and again in the function,
 * so whitespace never reaches the dashboard as a "lead".
 */
export async function setCellEventEffort(eventId: number, effort: Effort): Promise<void> {
  const { error } = await supabase.rpc('set_cell_event_effort', {
    p_event_id: eventId,
    p_lead_name: effort.leadName.trim(),
    p_painter_name: effort.painterName.trim(),
    p_work_hours: effort.workHours,
    p_waste_hours: effort.wasteHours,
    p_waste_reason: effort.wasteReason.trim(),
  })
  if (error) throw new Error(error.message)
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
    // The constraint hint is load-bearing: cell_events has had two foreign
    // keys onto profiles since 0023 (by, report_edited_by), and an unhinted
    // embed is refused as ambiguous -- which this screen swallowed as "no
    // event yet".
    .select('at, to_stage_name, cells(code), by:profiles!cell_events_by_fkey(username, full_name)')
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
