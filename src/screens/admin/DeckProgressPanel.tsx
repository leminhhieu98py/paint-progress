import { ExpandOutlined, MinusOutlined, PlusOutlined } from '@ant-design/icons'
import {
  Alert, App, Button, DatePicker, Form, Input, Modal, Segmented,
  Select, Space, Spin, Switch, Table, Tooltip, Typography,
} from 'antd'
import dayjs from 'dayjs'
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { DrawingCanvas } from '../../canvas/DrawingCanvas'
import { cellStagesAsOf, HISTORY_FROM_LABEL } from '../../domain/asOf'
import { effortDayKey } from '../../domain/effort'
import { cellsInBox } from '../../domain/geometry'
import {
  codesNotReaching, paintLensColors, zoneColorMap, zoneColorOf, zoneLensLayers, ZONE_PALETTE,
} from '../../domain/lens'
import { zoneLabelBoxes, type ZoneLabel } from '../../domain/plan'
import { buildStageSlices } from '../../domain/pieSlices'
import { formatPlanRange } from '../../domain/plan'
import { computeDeckProgress, summariseDeck } from '../../domain/progress'
import type { DeckEvent, Stage, StageProgress, WorkModel, Zone } from '../../domain/types'
import { getDrawingUrl } from '../../lib/decksApi'
import { DEFAULT_UNIT } from '../../domain/unit'
import { formatAreaM2, formatPercent, formatWeight } from '../../lib/format'
import { subscribeDeckStates } from '../../lib/gsApi'
import {
  listCellNotes, listDeckEvents, loadDeckWorks, setReportNote,
  type CellNote, type DeckProgressEntry, type DeckWorks,
} from '../../lib/progressApi'
import {
  createZone, deleteZone, listDeckZones, setZoneActual, setZoneCells, updateZone,
} from '../../lib/zonesApi'
import { swatchStyle, useControlHeight } from '../../components/swatch'
import { ConsequenceModal } from '../../components/ConsequenceModal'
import { Donut, type DonutSlice } from '../../components/Donut'
import { DECK_RING, ringFigureStep } from '../../components/ringFit'
import { legendRowProps } from '../../components/ringHover'
import { EmptyState } from '../../components/EmptyState'
import { InfoTip } from '../../components/InfoTip'
import { NoteThread } from '../../components/NoteThread'
import { ProgressBar } from '../../components/ProgressBar'
import { RulesDisclosure } from '../../components/RulesDisclosure'
import { SectionCard } from '../../components/SectionCard'
import { StageSpecTable } from '../../components/StageSpecTable'
import { modalProps } from '../../components/modalChrome'
import { searchSelectProps } from '../../components/searchSelect'
import { tablePagination } from '../../components/tablePagination'
import { palette, shadowCard, space, type } from '../../theme'
import type { Cell } from '../../domain/types'


/**
 * The zone colour picker (Feedback Rv2, item 6): one swatch per palette colour
 * this (work, deck)'s stages do NOT wear, as a radio group.
 *
 * Swatches rather than a free colour picker, on purpose. The rule Linh asked
 * for is "never a coat colour", and a fixed set that already excludes them
 * makes the rule true by construction -- there is nothing to validate and
 * nothing to explain when it fails. Ten palette entries minus at most five
 * coats leaves more zones per coat than any plan sheet has carried.
 */
function ZoneColorSwatches({
  colors, value, onChange,
}: {
  colors: string[]
  value: string
  onChange: (color: string) => void
}) {
  // A dialog line, not a table cell: the default control height (CLR-01).
  const diameter = useControlHeight()
  return (
    <div data-testid="zone-color" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ ...type.label, color: palette.textSecondary }}>Màu zone</span>
      {/* 10, not 8: the selected ring and the focus ring reach 4 px past a circle (R2). */}
      <div role="radiogroup" aria-label="Màu zone" style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {colors.map((c) => {
          const selected = c === value.toLowerCase()
          return (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={`Màu ${c}`}
              data-color={c}
              onClick={() => onChange(c)}
              className="pp-swatch"
              style={{
                ...swatchStyle(diameter),
                background: c,
                cursor: 'pointer',
                // The pick is a ring apart from the colour, not an outline
                // drawn on it (CLR-02): a gap in the dialog's own white, then
                // the ring.
                boxShadow: selected
                  ? `0 0 0 2px ${palette.bgContainer}, 0 0 0 4px ${palette.text}`
                  : undefined,
              }}
            />
          )
        })}
      </div>
    </div>
  )
}

/** One row of the create-zone dialog: a stage and the window planned for it. */
interface StageWindow {
  startDate: dayjs.Dayjs | null
  finishDate: dayjs.Dayjs | null
}

/**
 * A deck's progress, inside the deck's own screen.
 *
 * This started life as a separate `/admin/progress`. It is here because the
 * admin asked for it here, and the reason holds: everything on it is about ONE
 * deck, and a screen that made you pick a project and then a deck to see what
 * the deck screen could have shown you was one navigation too many. The
 * project-wide half -- the rollup and the XLSX export -- stayed behind on the
 * decks list, which is where a project-wide thing belongs.
 *
 * Two canvases over one deck, because `cells.stage_id` answers two different
 * questions and reading one for the other is expensive. The left lens colours
 * each bay by the coat it has reached; the right one says only whether the
 * scaffolding is down. A bay at Coat 2 is well along on the left and still
 * blocking access on the right.
 *
 * Every number comes from `computeDeckProgress`, asserted against the customer's
 * own spreadsheet to 1e-9 (spec §3.3). Nothing is recomputed here.
 */
/**
 * How long the realtime re-read waits for a burst to settle.
 *
 * Long enough that a foreman working across a row of bays produces one read,
 * short enough that the admin never notices the delay.
 */
const REFRESH_DEBOUNCE_MS = 400

/**
 * The layer select's value for "Tất cả công đoạn" (RV6-13).
 *
 * A sentinel inside the same `string | null` the select already carried, rather
 * than a second piece of state beside it. The two are mutually exclusive by
 * construction that way -- a layer is on one coat or on all of them, never both
 * and never neither -- and the select needs no special-casing to hold it.
 */
const ALL_STAGES = '__all__'

/**
 * The day one layer is pinned to, if any (RV6-14..16).
 *
 * `cells` is the whole of it: `cellStagesAsOf` hands back the deck's bays in
 * the shape `lensFor` already reads them in, so ONE substitution at the top of
 * `lensFor` moves every figure below -- the colours, the chips, the zone rows,
 * the m² line -- onto the day, and the plan toggle keeps working because it
 * never looked at where the bays came from.
 *
 * `cells` is absent while the history is still being read, which is what the
 * header renders `Đang tải lịch sử…` on: `day` without `cells` is a date
 * picked and not yet answered, and the drawing stays live until it is.
 */
interface LensAsOf {
  /** The bays as they stood. Absent = the live deck. */
  cells?: Cell[]
  /** `DD/MM/YYYY` of the day picked. Absent = live. */
  day?: string
}

/**
 * What one layer is looking at.
 *
 * A union rather than a nullable `Stage`, because "every coat" and "no coat
 * loaded yet" are different pictures and a null would have to carry both. The
 * per-layer date hangs off this same object: the layer's SUBJECT is what the
 * date changes, and everything below already reads the deck through here.
 */
type LensView = ({ kind: 'stage'; stage: Stage } | { kind: 'all' }) & LensAsOf

/** One header chip: a coat, its colour, and the share of the deck that reached it. */
interface LensChip {
  id: string
  name: string
  color: string
  ratio: number
}

/** One row of the `Tiến độ từng zone` table, in m² like everything else here. */
interface ZoneRow {
  zone: Zone
  color: string
  doneM2: number
  totalM2: number
}

/** Everything one layer draws and lists, built by `lensFor`. */
interface Lens {
  /** Null only before the stages have loaded; the layer renders nothing then. */
  view: LensView | null
  /** The coat's name, or `Tất cả công đoạn`. */
  title: string
  colors: Record<string, string>
  opacities: Record<string, number>
  outlines: Record<string, string>
  labels: ZoneLabel[]
  zones: ZoneRow[]
  zoneColors: Record<string, string>
  chips: LensChip[]
  reachedAreaM2: number
}

/**
 * A zone's name without the coat `createZone` suffixed onto it (RV6-11).
 *
 * Zones are stored as `${base} — ${coat}` so one plan drawn across five coats
 * is five readable rows rather than five rows called "Khu A". The rename box
 * therefore holds the base and the suffix is re-applied on save: an admin
 * editing the stored name by hand would otherwise produce, one rename at a
 * time, "Khu A — Topcoat — Topcoat".
 *
 * Matched on the exact suffix rather than on the last separator: a zone
 * legitimately named "Khu A — B" on a coat called something else keeps its
 * name whole. A legacy zone carrying no suffix at all is returned unchanged
 * and gains one on its first rename, which is intended.
 */
function baseZoneName(name: string, stageName: string): string {
  const suffix = ` — ${stageName}`
  return stageName !== '' && name.endsWith(suffix) ? name.slice(0, -suffix.length) : name
}

const EMPTY_LENS: Lens = {
  view: null, title: '', colors: {}, opacities: {}, outlines: {},
  labels: [], zones: [], zoneColors: {}, chips: [], reachedAreaM2: 0,
}

/** Why the zone dialog's add and drop buttons are disabled. */
const ZONE_CELLS_HINT = 'Chọn ô trên bản vẽ rồi quay lại đây để thêm hoặc bỏ.'

/** On screen for assistive technology alone. */
const VISUALLY_HIDDEN = {
  position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, border: 0,
  overflow: 'hidden', clip: 'rect(0, 0, 0, 0)', whiteSpace: 'nowrap',
} as const

/**
 * A button whose tooltip says why it is disabled, reachable without a
 * pointer (CPY-02, Q2). A disabled button takes no focus, so while it is
 * disabled the wrapper the tooltip anchors on joins the tab order as a group
 * named by the button, and the tip opens on focus as on hover; the button
 * itself is described by the same words for a screen reader. No sentence on
 * screen. `tip` is the tooltip at any time; it is the reason while disabled.
 */
function HintedButton({
  label, tip, disabled, onClick, type, icon,
}: {
  label: string
  tip: string | undefined
  disabled: boolean
  onClick: () => void
  type?: 'primary'
  icon?: ReactNode
}) {
  const hintId = useId()
  const hinted = disabled && tip !== undefined
  return (
    <Tooltip title={tip} trigger={['hover', 'focus']}>
      {/* A span, because antd Tooltip cannot anchor a disabled button. */}
      <span
        tabIndex={hinted ? 0 : undefined}
        role={hinted ? 'group' : undefined}
        aria-label={hinted ? label : undefined}
      >
        <Button
          type={type}
          icon={icon}
          disabled={disabled}
          aria-describedby={hinted ? hintId : undefined}
          onClick={onClick}
        >
          {label}
        </Button>
        {hinted && <span id={hintId} style={VISUALLY_HIDDEN}>{tip}</span>}
      </span>
    </Tooltip>
  )
}

const PROGRESS_RULES = [
  {
    id: 'ZON-R5',
    text: 'Xoá zone chỉ xoá kế hoạch; tiến độ đã ghi trên các ô vẫn giữ nguyên.',
  },
  {
    id: 'LNS-R1',
    text: 'Ô đã đạt lớp tô đặc theo màu zone (hoặc màu lớp nếu chưa có zone). Ô có kế hoạch nhưng chưa đạt lớp tô nhạt và viền đứt theo màu zone. Ô chưa đạt và chưa có kế hoạch để trống.',
  },
  {
    id: 'ZON-R6',
    text: 'Màu zone do quản trị viên chọn và không bao giờ trùng màu một lớp sơn ở Cấu hình lớp sơn của cùng công việc, sàn.',
  },
]

export function DeckProgressPanel({
  deckId,
  editable = true,
  onProgress,
}: {
  deckId: string
  /**
   * Reports this deck's percentage upward as soon as it is computed, so the
   * screen's sticky header can carry it without loading the deck a second
   * time. Null while nothing is loaded, and on a deck that failed to load --
   * a stale percentage above a failed panel is worse than none.
   */
  onProgress?: (progress: number | null) => void
  /**
   * Whether the writes are offered. False on the deck's read-only view.
   *
   * Everything on this panel is visible either way. The admin's complaint was
   * fair and the fix is the shape of it: the deck's view used to be five lines
   * of text, and seeing the drawing at all meant pressing "Sửa". Looking is not
   * editing. Filtering the lens stays available read-only too -- it changes what
   * is drawn, not what is stored.
   */
  editable?: boolean
}) {
  /** The deck with one view per bays work it is part of (0024). */
  const [deckWorks, setDeckWorks] = useState<DeckWorks | null>(null)
  /** A lens header's floor: Ghi chú (n) is in A's alone, and B's must match it (Q1). */
  const controlHeight = useControlHeight()
  /** The work the lens, ring, zones and notes are scoped to. */
  const [workId, setWorkId] = useState<string | null>(null)
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [zones, setZones] = useState<Zone[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  /** Cell CODES, because that is what DrawingCanvas selects by. Resolved to ids
   *  only when a zone is written -- zone_cells references cells.id, and two
   *  decks can both carry an R1C1. */
  const [selectedCodes, setSelectedCodes] = useState<string[]>([])
  const [zoneFormOpen, setZoneFormOpen] = useState(false)
  /**
   * One coat at a time, or two side by side.
   *
   * The panel used to be a fixed pair: paint on the left, scaffolding on the
   * right. Scaffolding is simply the last coat in the list, so half the screen
   * was permanently spent on one row of the stage table while the other four
   * coats had no view of their own at all. Now the coat is chosen, and the
   * second lens is something the admin asks for when they have two to compare.
   */
  const [splitView, setSplitView] = useState(false)
  /**
   * Whether the plan is drawn over the progress (RV6-12).
   *
   * Default on, which is the rendering the panel has always had. Off, the
   * drawing answers one question only -- what is DONE -- because the faint
   * zone tints, the dashed frames and the label boxes that answer "what is
   * planned" are noise while that is the question being asked.
   *
   * View state: nothing is written, and it is not remembered between visits.
   */
  const [showPlan, setShowPlan] = useState(true)
  /** The coat each lens is showing. Null only before the stages have loaded. */
  const [viewA, setViewA] = useState<string | null>(null)
  const [viewB, setViewB] = useState<string | null>(null)
  /**
   * The day each layer is pinned to, and the deck those dates were picked on
   * (RV6-14).
   *
   * The deck id travels WITH the dates rather than an effect resetting them
   * afterwards: a deck change means both layers go back to live, and deriving
   * that during render is one render fewer than noticing it in an effect --
   * and one fewer `set-state-in-effect` on a panel that already has two.
   */
  const [asOfPick, setAsOfPick] = useState<{
    deckId: string
    a: dayjs.Dayjs | null
    b: dayjs.Dayjs | null
  }>({ deckId, a: null, b: null })
  /**
   * The deck's whole history, read once and kept.
   *
   * `cell_events` is the only record of where a bay stood yesterday, and it is
   * the heaviest read on this screen -- a paged query over every change ever
   * recorded on the deck. So it is read LAZILY: an admin who never picks a date
   * never pays for it, and one who compares five pairs of dates pays once. Also
   * keyed by deck, so a panel that moves to another deck cannot draw this
   * deck's history over the new deck's bays.
   */
  const [history, setHistory] = useState<{ deckId: string; rows: DeckEvent[] } | null>(null)
  const [historyLoading, setHistoryLoading] = useState(false)
  /**
   * Shared by both lenses, which is the whole point of the split view: two
   * drawings free to sit at different scales are not a comparison.
   */
  const [zoom, setZoom] = useState(1)
  /** The zone whose date popover is open. */
  const [datesFor, setDatesFor] = useState<Zone | null>(null)
  /**
   * What is typed in that dialog's rename box, and which zone it belongs to.
   *
   * Kept together rather than seeded from an effect: `refreshZones` hands the
   * dialog a fresh copy of the zone after every write, so an effect would have
   * to decide whether each new copy should overwrite what the admin is typing.
   * Keyed on the id, an unrecognised zone simply falls back to its stored name
   * -- which is what a revert, a re-open and a landed rename all want.
   */
  const [nameDraft, setNameDraft] = useState<{ zoneId: string; value: string } | null>(null)
  /**
   * The zone whose rename is being written, or null. A ref, not state: it
   * only gates `commitZoneName`, and Enter's blur can land before a render.
   */
  const renamingZoneId = useRef<string | null>(null)
  /** The zone whose deletion is being confirmed. */
  const [removingZone, setRemovingZone] = useState<Zone | null>(null)
  const [windows, setWindows] = useState<Record<string, StageWindow>>({})
  /** The bay whose note is open, and the names to attribute it to. */
  const [noteCell, setNoteCell] = useState<Cell | null>(null)
  /** Every note ever left on the open bay, newest first. */
  const [notes, setNotes] = useState<CellNote[]>([])
  const [noteLoading, setNoteLoading] = useState(false)
  const [noteError, setNoteError] = useState<string | null>(null)
  /** The notes-on-this-deck list, which is how Sửa mode reaches a note. */
  const [notesListOpen, setNotesListOpen] = useState(false)
  /** The note whose report copy is being written, and the draft (0023). */
  const [reportEdit, setReportEdit] = useState<CellNote | null>(null)
  const [reportDraft, setReportDraft] = useState('')
  const [reportSaving, setReportSaving] = useState(false)
  const { message } = App.useApp()
  const [form] = Form.useForm()

  /**
   * The work on screen, and the deck seen through it. Everything below reads
   * `entry` -- the shape this panel always read -- projected for that work:
   * the bays carry the stages and notes of this work and nothing else, so the
   * lens, the zones, the ring and the note dialog stay exactly as they were.
   */
  const activeWork = deckWorks
    ? deckWorks.works.find((w) => w.work.id === workId) ?? deckWorks.works[0] ?? null
    : null
  /** Every figure on this panel is the active work's, so its unit labels them all (RV6-35). */
  const unit = activeWork?.work.unit ?? DEFAULT_UNIT
  const entry = useMemo<DeckProgressEntry | null>(() => {
    if (!deckWorks) return null
    return {
      seq: deckWorks.seq,
      deck: { ...deckWorks.deck, cells: activeWork?.cells ?? deckWorks.deck.cells },
      stages: activeWork?.stages ?? [],
      imagePath: deckWorks.imagePath,
      imageW: deckWorks.imageW,
      imageH: deckWorks.imageH,
      areaSource: deckWorks.areaSource,
      audit: activeWork?.audit ?? {},
    }
  }, [deckWorks, activeWork])

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      setDeckWorks(await loadDeckWorks(deckId))
      setError(null)
    } catch (e) {
      // The deck is NOT cleared. A failed refresh on a flaky connection is the
      // common case, and blanking the panel takes away numbers that are still
      // correct.
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [deckId])

  const refreshZones = useCallback(async () => {
    try {
      const next = await listDeckZones(deckId)
      setZones(next)
      // The "Mốc ngày" dialog holds a COPY of the zone, and the picker reads
      // its value from that copy. Left behind after a write it shows the dates
      // as they were, which is exactly what Linh reported as "không sửa được"
      // (Feedback Rv4): the write had landed every time, the dialog just never
      // said so. Dropped when the zone is gone -- deleted from another tab.
      setDatesFor((open) => (open === null ? null : next.find((z) => z.id === open.id) ?? null))
    } catch (e) {
      setError((e as Error).message)
    }
  }, [deckId])

  useEffect(() => {
    void refresh()
    void refreshZones()
  }, [refresh, refreshZones])

  /**
   * GAP-01, closed: the panel follows the deck while the crew works on it.
   *
   * A re-read rather than patching the row into local state. The realtime
   * payload carries the cell, but this panel also renders who recorded it and
   * when (`entry.audit`), the zone counts and the weighted deck figure -- and a
   * hand-merged cell that leaves the audit stale attributes a foreman's note to
   * whoever happened to be there before. One extra query per burst is cheap
   * against a screen that quietly disagrees with the database.
   *
   * Debounced because a foreman ticking a row of bays fires an event each, and
   * one re-read per bay is a query storm for a picture that would be identical
   * either way. Trailing edge, so the read happens after the burst settles.
   */
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const nudge = () => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        void refresh()
        void refreshZones()
      }, REFRESH_DEBOUNCE_MS)
    }
    const stop = subscribeDeckStates(deckId, {
      onStateChange: nudge,
      onCellChange: nudge,
      onCellDelete: nudge,
      // Nothing on this screen depends on the socket being up: the admin is on
      // a laptop and can reload. The banner belongs on the tablet, where the
      // foreman is writing and needs to know a write may not have landed.
      onStatus: () => {},
    })
    return () => {
      clearTimeout(timer)
      stop()
    }
  }, [deckId, refresh, refreshZones])

  /**
   * The signed drawing URL. Cleared before each fetch, so a deck change can
   * never leave the previous deck's plan under this deck's bays -- the colours
   * would land on the wrong geometry and look entirely plausible.
   */
  useEffect(() => {
    const path = entry?.imagePath
    if (!path) {
      setImageUrl(null)
      return
    }
    let cancelled = false
    setImageUrl(null)
    getDrawingUrl(path)
      .then((url) => { if (!cancelled) setImageUrl(url) })
      .catch(() => { if (!cancelled) setImageUrl(null) })
    return () => { cancelled = true }
  }, [entry?.imagePath])


  const progress = useMemo(
    () => (entry ? computeDeckProgress(entry.deck, entry.stages) : null),
    [entry],
  )

  /**
   * The deck across its works: P_wd per work with the admin's deck weight, and
   * the tổng hợp the header shows. Built as the work model so the domain does
   * the averaging -- one formula, tested there.
   */
  const workModels = useMemo<WorkModel[]>(() => (deckWorks
    ? deckWorks.works.map((v) => ({
      work: v.work,
      decks: [{ deck: { ...deckWorks.deck, cells: v.cells }, stages: v.stages, weight: v.weight }],
    }))
    : []), [deckWorks])
  const deckSummary = useMemo(
    () => (deckWorks ? summariseDeck(deckWorks.deck.id, workModels) : null),
    [deckWorks, workModels],
  )

  // Reported in an effect rather than during render: this sets state on the
  // parent, and doing that while rendering a child is a React error. The
  // figure is the deck's tổng hợp, not the open work's.
  useEffect(() => {
    onProgress?.(deckSummary ? deckSummary.progress : null)
  }, [deckSummary, onProgress])
  /**
   * The coats each lens is showing, resolved.
   *
   * A default rather than a nullable everywhere below: the panel is useless
   * without a coat selected, and the first coat is the one every deck has.
   */
  const stages = entry?.stages ?? []
  const stageA = viewA === ALL_STAGES
    ? null
    : stages.find((st) => st.id === viewA) ?? stages[0] ?? null
  const stageB = viewB === ALL_STAGES
    ? null
    : stages.find((st) => st.id === viewB) ?? stages[stages.length - 1] ?? null

  /**
   * The dates, and the history, read back for THIS deck. A leftover from the
   * deck the panel was showing before reads as "live" and "not loaded".
   */
  const dateA = asOfPick.deckId === deckId ? asOfPick.a : null
  const dateB = asOfPick.deckId === deckId ? asOfPick.b : null
  const historyRows = history && history.deckId === deckId ? history.rows : null

  /**
   * Read the history, unless it is already in hand for this deck.
   *
   * Called from the pickers rather than from an effect: picking a date is the
   * event that needs it, and an effect watching the dates would fire a second
   * time for the second layer before the first read had landed.
   */
  const ensureHistory = async () => {
    if (historyRows !== null || historyLoading) return
    setHistoryLoading(true)
    try {
      setHistory({ deckId, rows: await listDeckEvents(deckId) })
    } catch (e) {
      // The panel's own banner, like every other failed read here. The layer
      // keeps drawing the live deck, which is still true -- it is just not the
      // day that was asked for, and the header says the history is missing.
      setError((e as Error).message)
    } finally {
      setHistoryLoading(false)
    }
  }

  const setLayerDate = (side: 'a' | 'b', date: dayjs.Dayjs | null) => {
    setAsOfPick((prev) => {
      const base = prev.deckId === deckId ? prev : { deckId, a: null, b: null }
      return side === 'a' ? { ...base, deckId, a: date } : { ...base, deckId, b: date }
    })
    if (date) void ensureHistory()
  }

  /**
   * The deck as it stood at the end of one day, or nothing while that cannot
   * be answered yet -- no date, or the history still in flight.
   */
  const asOfFor = (date: dayjs.Dayjs | null): LensAsOf => {
    if (!date) return {}
    const day = date.format('DD/MM/YYYY')
    if (!entry || !activeWork || !historyRows) return { day }
    return {
      day,
      cells: cellStagesAsOf(
        entry.deck.cells, historyRows, date.format('YYYY-MM-DD'),
        activeWork.work.name, entry.stages,
      ),
    }
  }

  /** The select's value and the picker's, read back as what the layer is showing. */
  const viewOf = (
    picked: string | null, stage: Stage | null, date: dayjs.Dayjs | null,
  ): LensView | null => {
    const asOf = asOfFor(date)
    if (picked === ALL_STAGES) return { kind: 'all', ...asOf }
    return stage ? { kind: 'stage', stage, ...asOf } : null
  }

  /**
   * Everything one lens needs, for one coat -- or for every coat at once.
   *
   * Both lenses read the same deck through this, so the split view cannot drift
   * into showing two differently-computed pictures.
   *
   * On ONE coat: a bay that has REACHED it is filled: by its zone's colour
   * where the coat has one planned, by the coat's own colour where it does
   * not. A zone-only rule would leave an unplanned deck blank, which is most
   * decks before the plan is drawn; a coat-only rule would lose the grouping
   * the plan exists to show. A bay that has NOT reached the coat but is
   * planned for it wears its zone colour faintly, under a dashed frame
   * (Feedback Rv2, item 5: it used to get nothing, and a plan drawn before the
   * work started was invisible on the screen it was drawn on). Unplanned and
   * unreached, the drawing shows through. The table itself is `zoneLensLayers`.
   *
   * On EVERY coat (RV6-13): `paintLensColors`, which is exactly the foreman's
   * live view -- each bay in the colour of the furthest coat it has reached.
   * No overlay of any kind, because a zone belongs to ONE coat: a faint tint
   * here would be the plan for a coat the picture is not about.
   *
   * Zone colours come from `zoneColorMap` per coat with the stage colours
   * reserved, so a zone is one colour on every coat's view, in the GS screen
   * and in the report -- and never a coat's colour (item 6). Settled per coat
   * rather than over the whole list so the all-coats table's swatches are the
   * ones the coat's own layer draws.
   */
  const lensFor = (view: LensView | null): Lens => {
    if (!entry || !view) return EMPTY_LENS

    // THE substitution (RV6-16). One list of bays feeds the colours, the
    // chips, the zone rows and the m² line below, so a layer pinned to a day
    // and a live one are the same code over a different deck-shaped thing --
    // there is no second rendering path to keep in step. Geometry, area and
    // note are the live ones either way; only the coats move.
    const cells = view.cells ?? entry.deck.cells

    // The coats this layer speaks for. Sorted by seq rather than taken in
    // array order: `listWorkStages` sorts, but nothing here should depend on
    // that, and the all-coats table is ordered by coat then by zone.
    const inView = view.kind === 'all'
      ? [...entry.stages].sort((a, b) => a.seq - b.seq)
      : [view.stage]
    const pendingByStage = new Map(inView.map((st) => (
      [st.id, new Set(codesNotReaching(cells, entry.stages, st.id))] as const
    )))
    const areaReaching = (stageId: string) => {
      const pending = pendingByStage.get(stageId)
      return cells
        .reduce((sum, c) => (pending?.has(c.code) ? sum : sum + c.areaM2), 0)
    }

    // In m², like everything else on this panel now: a zone of three bays at
    // "2/3" said nothing about how much of it was done when the bays differ
    // in size, and they usually do.
    const cellById = new Map(cells.map((c) => [c.id, c]))
    const zoneColors: Record<string, string> = {}
    const zoneRows: ZoneRow[] = []
    const stageColorList = entry.stages.map((st) => st.color)
    const zonesOf = (stageId: string) => zones.filter((z) => z.stageId === stageId)
    for (const st of inView) {
      const mine = zonesOf(st.id)
      const colorById = zoneColorMap(mine, stageColorList)
      const pending = pendingByStage.get(st.id)
      for (const z of mine) {
        zoneColors[z.id] = colorById[z.id]
        const zoneCells = z.cellIds.flatMap((id) => {
          const c = cellById.get(id)
          return c ? [c] : []
        })
        zoneRows.push({
          zone: z,
          color: colorById[z.id],
          totalM2: zoneCells.reduce((sum, c) => sum + c.areaM2, 0),
          doneM2: zoneCells.reduce((sum, c) => (pending?.has(c.code) ? sum : sum + c.areaM2), 0),
        })
      }
    }

    // One chip per coat in view, each carrying the share of the DECK that has
    // reached it -- cumulative, the same ratio the spec table and the report
    // carry. On a single coat that is the one figure the header always showed.
    const chips: LensChip[] = inView.map((st) => ({
      id: st.id,
      name: st.name,
      color: st.color,
      ratio: entry.deck.totalAreaM2 > 0 ? areaReaching(st.id) / entry.deck.totalAreaM2 : 0,
    }))
    // The m² line under the drawing. On every coat at once that is the area
    // that has STARTED -- the first coat's share -- because there is no one
    // "reached" for five coats and the chips already break it down.
    const reachedAreaM2 = inView.length > 0 ? areaReaching(inView[0].id) : 0

    if (view.kind === 'all') {
      return {
        view,
        title: 'Tất cả công đoạn',
        colors: paintLensColors(cells, entry.stages),
        opacities: {},
        outlines: {},
        labels: [],
        zones: zoneRows,
        zoneColors,
        chips,
        reachedAreaM2,
      }
    }

    const { stage } = view
    const zonesHere = zonesOf(stage.id)
    const layers = zoneLensLayers(cells, entry.stages, stage, zonesHere, zoneColors)
    // With the plan hidden (RV6-12) the reached bays wear the COAT's colour at
    // full opacity and nothing else is drawn. Built from `zoneLensLayers`' own
    // reachedCodes rather than from a second pass over the zones, so the two
    // renderings can never disagree about which bays are done.
    if (!showPlan) {
      return {
        view,
        title: stage.name,
        colors: Object.fromEntries(layers.reachedCodes.map((code) => [code, stage.color])),
        opacities: {},
        outlines: {},
        labels: [],
        zones: zoneRows,
        zoneColors,
        chips,
        reachedAreaM2,
      }
    }
    return {
      view,
      title: stage.name,
      colors: layers.colors,
      opacities: layers.opacities,
      outlines: layers.outlines,
      // The zones named where they are, not only in the list beside the drawing
      // (Feedback Rv3, item 4) -- the same labels the foreman's screen draws.
      labels: zoneLabelBoxes(zonesHere, cells),
      zones: zoneRows,
      zoneColors,
      chips,
      reachedAreaM2,
    }
  }

  /**
   * The colours a new zone may take: the palette minus this (work, deck)'s
   * stage colours. Built here so the dialog cannot offer a conflict at all;
   * `createZone` still refuses one, for any other caller.
   */
  const stageColors = (entry?.stages ?? []).map((st) => st.color.toLowerCase())
  const freeColors = ZONE_PALETTE.filter((c) => !stageColors.includes(c))
  const [zoneColor, setZoneColor] = useState<string | null>(null)
  const defaultZoneColor = zoneColorOf({ color: null }, 0, stageColors)
  const chosenZoneColor = zoneColor ?? defaultZoneColor

  const lensA = lensFor(viewOf(viewA, stageA, dateA))
  const lensB = lensFor(viewOf(viewB, stageB, dateB))

  /**
   * The ring: how the bays that have been started are spread across the coats.
   *
   * Deliberately not the weighted deck percentage -- that number is already the
   * largest type on the screen, in the header above. This answers the other
   * question: where is the work actually sitting right now.
   */
  const ringSlices = useMemo(() => {
    if (!entry) return []
    const total = entry.deck.totalAreaM2
    /** A coat row's figures, as the row prints them. */
    const figures = (areaM2: number, ratio: number) =>
      `${formatAreaM2(areaM2)} / ${formatAreaM2(total)} ${unit} · ${formatPercent(ratio)}`
    return buildStageSlices(total, entry.deck.cells, entry.stages)
      .filter((sl) => sl.areaM2 > 0)
      .map((sl) => {
        const value = total > 0 ? sl.areaM2 / total : 0
        const row = progress?.stages.find((sp) => sp.stage.id === sl.key)
        return {
          key: sl.key,
          label: sl.label,
          areaM2: sl.areaM2,
          value,
          color: sl.color,
          /*
            The slice is the area standing at the coat now; its row beside the
            ring is cumulative (Feedback Rv3, item 1). The tooltip says both,
            the row's figures exactly as the row prints them, so hovering a
            half-ring slice beside a row reading 100% explains itself. Chưa
            bắt đầu and Chưa chia ô have no row, only their own figure.
          */
          detail: row
            ? [
                `Đang ở lớp này: ${figures(sl.areaM2, value)}`,
                `Cộng dồn: ${figures(row.cumulativeAreaM2, row.ratio)}`,
              ]
            : figures(sl.areaM2, value),
        }
      })
  }, [entry, progress, unit])

  /**
   * Bays carrying a note, by code.
   *
   * The foreman's half of this feature has been live since the note column
   * landed; this is the half that lets anyone read what they wrote. Without it
   * a note is a string in a table nobody opens.
   */
  const notedCodes = useMemo(
    () => (entry?.deck.cells ?? []).filter((c) => (c.note ?? '').trim() !== '').map((c) => c.code),
    [entry],
  )

  /*
    Names are fetched the first time a note is opened, not on mount. This panel
    already makes the heaviest read on the screen; the admin who never taps a
    flagged bay should not pay for a user list as well.
  */
  /*
    The history is fetched on open, not on mount. This panel already makes the
    heaviest read on the screen; an admin who never taps a flagged bay should
    not pay for a per-bay event query as well.
  */
  const loadNotes = (cellId: string) => {
    setNotes([])
    setNoteError(null)
    setNoteLoading(true)
    listCellNotes(cellId)
      .then((rows) => setNotes(rows))
      .catch((e) => {
        // The dialog falls back to `cells.note`, which is already in hand and
        // is the note the drawing's flag is showing. Losing the history must
        // not lose the sentence the admin tapped the bay to read.
        setNoteError((e as Error).message)
      })
      .finally(() => setNoteLoading(false))
  }

  const openNote = (code: string) => {
    const cell = entry?.deck.cells.find((c) => c.code === code)
    if (!cell || (cell.note ?? '').trim() === '') return
    setNoteCell(cell)
    loadNotes(cell.id)
  }

  /**
   * The admin's report-facing decisions about a note (0023): a version for
   * the XLSX, or keeping it out of the XLSX. Neither touches what the foreman
   * wrote, and both are reversible through the same call.
   *
   * Offered in Sửa mode only -- the thread gets the handlers below only when
   * `editable` -- because Xem carries no write on this screen. The draft is
   * seeded when the box opens and dropped when it closes by any path, so a
   * half-typed version never survives a cancel.
   */
  const openReportEdit = (n: CellNote) => {
    setReportEdit(n)
    setReportDraft(n.reportNote ?? n.note)
  }
  const closeReportEdit = () => {
    setReportEdit(null)
    setReportDraft('')
  }
  const writeReportNote = async (
    n: CellNote, reportNote: string | null, hidden: boolean, done: string,
  ) => {
    if (!noteCell) return
    setReportSaving(true)
    try {
      await setReportNote(n.id, reportNote, hidden)
      message.success(done)
      closeReportEdit()
      // The thread is what the admin is looking at; it has to show the stamp.
      loadNotes(noteCell.id)
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setReportSaving(false)
    }
  }
  const saveReportNote = () => {
    if (!reportEdit) return
    const trimmed = reportDraft.trim()
    // An emptied box is "print the original again", and says so.
    void writeReportNote(
      reportEdit,
      trimmed === '' ? null : trimmed,
      reportEdit.reportHidden,
      trimmed === '' ? 'Đã khôi phục bản gốc' : 'Đã lưu bản cho báo cáo',
    )
  }
  const restoreReportNote = () => {
    if (!reportEdit) return
    void writeReportNote(reportEdit, null, reportEdit.reportHidden, 'Đã khôi phục bản gốc')
  }
  const toggleHidden = (n: CellNote) => {
    void writeReportNote(
      n,
      n.reportNote,
      !n.reportHidden,
      n.reportHidden ? 'Đã hiện lại trong báo cáo' : 'Đã ẩn khỏi báo cáo',
    )
  }

  const toggleCell = (code: string) => {
    setSelectedCodes((prev) => (
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]
    ))
  }

  const sweep = (rect: { x: number; y: number; w: number; h: number }) => {
    if (!entry) return
    // Additive: a band adds to what is already picked, so a zone can be built
    // out of two sweeps across a deck the admin has to scroll.
    const swept = cellsInBox(entry.deck.cells, rect)
    setSelectedCodes((prev) => [...new Set([...prev, ...swept])])
  }

  /** One RangePicker per coat writes both ends at once; either may be empty. */
  const setWindowRange = (stageId: string, range: [dayjs.Dayjs | null, dayjs.Dayjs | null] | null) =>
    setWindows((prev) => ({
      ...prev,
      [stageId]: { startDate: range?.[0] ?? null, finishDate: range?.[1] ?? null },
    }))

  const iso = (d: dayjs.Dayjs | null | undefined) => (d ? d.format('YYYY-MM-DD') : null)

  /**
   * One dialog, one set of bays, a window per coat.
   *
   * A zone row in the database is still one stage over one date range -- the
   * schema is unchanged, and `unique (deck_id, stage_id, seq)` counts per stage.
   * What changed is the admin's side of it: a zone's cell membership does not
   * move between coats, so picking the same forty bays five times to say when
   * each coat happens was five times the work for one decision.
   *
   * A coat with no dates at all creates nothing. Leaving a stage blank means
   * "not planned yet", which is a different statement from planning it for an
   * unknown window, and an empty zone would still label the drawing.
   */
  const submitZones = async () => {
    if (!entry) return
    const values = await form.validateFields()
    const byCode = new Map(entry.deck.cells.map((c) => [c.code, c.id]))
    const cellIds = selectedCodes.map((c) => byCode.get(c)).filter((id): id is string => !!id)

    const planned = entry.stages.filter((st) => {
      const w = windows[st.id]
      return Boolean(w?.startDate || w?.finishDate)
    })
    if (planned.length === 0) {
      setError('Đặt ít nhất một mốc ngày cho một công đoạn')
      return
    }

    try {
      // Sequential: each insert reads the next seq for its own stage, and two
      // in flight against one stage would both read the same one.
      for (const st of planned) {
        await createZone(entry.deck.id, {
          // Suffixed per coat so the plan sheet and the zone table stay
          // readable -- five rows called "Khu A" name nothing.
          name: `${values.name as string} — ${st.name}`,
          stageId: st.id,
          startDate: iso(windows[st.id]?.startDate),
          finishDate: iso(windows[st.id]?.finishDate),
          color: chosenZoneColor,
        }, cellIds, entry.stages)
      }
      setZoneFormOpen(false)
      setSelectedCodes([])
      setWindows({})
      setZoneColor(null)
      form.resetFields()
      await refreshZones()
      message.success(`Đã tạo ${planned.length} zone`)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  /**
   * One field of one zone, written as it changes.
   *
   * A patch, never a delete-and-remake: rebuilding a zone loses its cell
   * membership and takes its plan off the foreman's drawing in between.
   */
  const patchZoneDates = async (
    zone: Zone,
    range: [dayjs.Dayjs | null, dayjs.Dayjs | null] | null,
  ) => {
    try {
      // null is a value, not "leave alone": it says the date is no longer
      // known, which is how a slipped zone is expressed. Both ends travel
      // together because one picker now holds them (owner request).
      await updateZone(zone.id, {
        startDate: range?.[0] ? range[0].format('YYYY-MM-DD') : null,
        finishDate: range?.[1] ? range[1].format('YYYY-MM-DD') : null,
      })
      await refreshZones()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  /** The coat a zone plans, by name, or '' while the stage list is loading. */
  const zoneStageName = (zone: Zone) =>
    entry?.stages.find((st) => st.id === zone.stageId)?.name ?? ''

  /** The rename box's content for the open zone: what is being typed, or the
   *  stored name with its coat suffix stripped off. */
  const zoneNameValue = (zone: Zone) => (
    nameDraft?.zoneId === zone.id ? nameDraft.value : baseZoneName(zone.name, zoneStageName(zone))
  )

  /**
   * A zone renamed from its own dialog (RV6-11, docx item 4).
   *
   * Committed on blur or Enter rather than behind a Save, like the dates and
   * the colour beside it -- there is nothing here to validate across fields
   * that would need a commit step. Empty or unchanged reverts instead of
   * writing: an empty name is not a statement, and a no-op write would still
   * move the row under anyone else looking at this plan.
   *
   * The coat suffix is re-applied here, so the modal title, the zone table,
   * the label boxes on the drawing, the foreman's screen and the XLSX -- all
   * of which read `zones.name` -- follow without further change.
   *
   * Enter and the blur that usually follows it both commit, so the second
   * is a no-op while the first is still in flight.
   */
  const commitZoneName = async (zone: Zone) => {
    if (renamingZoneId.current !== null) return
    const stage = zoneStageName(zone)
    const base = baseZoneName(zone.name, stage)
    const next = zoneNameValue(zone).trim()
    if (next === '' || next === base) {
      setNameDraft(null)
      return
    }
    renamingZoneId.current = zone.id
    try {
      await updateZone(zone.id, { name: stage === '' ? next : `${next} — ${stage}` })
      setNameDraft(null)
      await refreshZones()
    } catch (e) {
      // The draft is left standing, so the name that failed is still on screen
      // to try again with rather than silently reverting to the stored one.
      setError((e as Error).message)
    } finally {
      renamingZoneId.current = null
    }
  }

  /** One zone's colour, written as it is picked (item 6). The swatches offered
   *  are already outside the stage palette; the API guards any other path. */
  const recolorZone = async (zone: Zone, color: string) => {
    if (!entry) return
    try {
      await updateZone(zone.id, { color }, entry.stages)
      await refreshZones()
      setDatesFor((current) => (current?.id === zone.id ? { ...current, color } : current))
    } catch (e) {
      setError((e as Error).message)
    }
  }

  /**
   * The bays a zone covers, edited after the fact (Feedback Rv4: "Cho phép
   * thêm/bớt ô trong Zone đã gộp").
   *
   * The selection on the drawing is the input, so adding a block to a zone is
   * the same gesture as building one: pick the bays, then say what to do with
   * them. Removing everything is refused by the API -- that is a delete, and
   * it has its own button and its own confirmation.
   */
  const changeZoneCells = async (zone: Zone, mode: 'add' | 'remove') => {
    if (!entry || selectedCodes.length === 0) return
    const idByCode = new Map(entry.deck.cells.map((c) => [c.code, c.id]))
    const picked = selectedCodes.map((code) => idByCode.get(code)).filter((id) => id !== undefined)
    const next = mode === 'add'
      ? [...new Set([...zone.cellIds, ...picked])]
      : zone.cellIds.filter((id) => !picked.includes(id))
    try {
      await setZoneCells(zone.id, next)
      setSelectedCodes([])
      await refreshZones()
      message.success(mode === 'add' ? 'Đã thêm ô vào zone' : 'Đã bỏ ô khỏi zone')
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const applyZone = async (zone: Zone) => {
    try {
      const written = await setZoneActual(zone.id, zone.stageId)
      message.success(`Đã ghi ${written} ô`)
      // The percentages just moved. Leaving them stale is the defect the decks
      // list carried before its editor re-fetched on close.
      await refresh()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const removeZone = async (zone: Zone) => {
    try {
      await deleteZone(zone.id)
      await refreshZones()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const stageName = (id: string) => entry?.stages.find((st: Stage) => st.id === id)?.name ?? '—'

  if (loading) return <Spin style={{ display: 'block', margin: '8vh auto' }} />

  /**
   * One coat's view of the deck: the drawing, and the zones planned for it.
   *
   * A function rather than a component so the two lenses cannot drift apart --
   * the split view exists to compare, and a comparison whose halves are drawn
   * by different code is not one.
   */
  /**
   * One layer's controls: which coat it shows, and which day (RV6-13, RV6-14).
   *
   * One function for both layers so the pair cannot drift apart, wherever it
   * sits. The ids `lens-a-stage` / `lens-b-stage` and `lens-a-date` /
   * `lens-b-date` are what the labels and the tests reach for.
   *
   * The picker is empty for the live deck and says so in its own placeholder;
   * clearing it is the way back. Days after today cannot be picked: the
   * history has nothing to say about them, and a layer "as of next week"
   * would draw today's deck under tomorrow's date.
   */
  const renderLayerControls = (side: 'a' | 'b') => {
    if (!entry) return null
    const isA = side === 'a'
    const picked = isA ? viewA : viewB
    const stage = isA ? stageA : stageB
    const labelStyle = { ...type.label, color: palette.textTertiary }
    return (
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          {/*
            In the split view the pane's subtitle already names the side, and
            the select picks a coat -- so its label says that, once, rather
            than repeating "Lớp bên trái" directly under it (QA F6).
          */}
          <label htmlFor={`lens-${side}-stage`} style={labelStyle}>
            {splitView ? 'Công đoạn' : 'Lớp sơn đang xem'}
          </label>
          {/*
            `Tất cả công đoạn` first, above the coats (RV6-13): it is the
            whole deck, and the coats below it are the ways of slicing that.
            Same list on both layers, so the split view can hold one coat
            against the whole picture.
          */}
          <Select
            id={`lens-${side}-stage`}
            {...searchSelectProps}
            style={{ minWidth: 190 }}
            value={picked === ALL_STAGES ? ALL_STAGES : stage?.id}
            onChange={isA ? setViewA : setViewB}
            options={[
              { value: ALL_STAGES, label: 'Tất cả công đoạn' },
              ...entry.stages.map((st) => ({ value: st.id, label: st.name })),
            ]}
          />
        </div>
        {/*
          The test id sits on the column, not the picker: antd hands a
          `data-*` prop to the INPUT, and the clear button beside it would
          then be outside the element the id names.
        */}
        <div
          data-testid={`lens-${side}-date`}
          style={{ display: 'flex', flexDirection: 'column', gap: 7 }}
        >
          <label htmlFor={`lens-${side}-date-input`} style={labelStyle}>Ngày</label>
          <DatePicker
            id={`lens-${side}-date-input`}
            style={{ width: 150 }}
            format="DD/MM/YYYY"
            allowClear
            placeholder="Hôm nay"
            value={isA ? dateA : dateB}
            // "Today" is the Vietnam day (effortDayKey, RV5-20), as on every
            // other figure here -- not the browser's clock, which on a machine
            // west of UTC+7 would still refuse a day the site is already working.
            disabledDate={(d) => d.format('YYYY-MM-DD') > effortDayKey(new Date().toISOString())}
            onChange={(d) => setLayerDate(side, d)}
          />
        </div>
      </div>
    )
  }

  const renderLens = (lens: Lens, side: 'A' | 'B') => {
    if (!entry || !lens.view || !imageUrl) return null
    /*
      LNS-R1 describes the plan overlay, so it is only true while the overlay
      is drawn. Every coat at once never draws one (a zone belongs to one
      coat), and RV6-12 switches it off on a single coat; both get the sentence
      that IS true of what is on the screen.
    */
    const legend = lens.view.kind === 'all'
      ? 'Mỗi ô tô theo màu công đoạn cao nhất đã đạt · ô chưa bắt đầu để trắng'
      : showPlan
        ? 'Ô đã đạt lớp tô đặc · ô có kế hoạch chưa đạt tô nhạt, viền đứt · ô chưa đạt, chưa kế hoạch để trắng'
        : 'Ô đã đạt lớp tô đặc theo màu công đoạn · ô chưa đạt để trắng'
    return (
      <div
        data-testid={`lens-${side}`}
        style={{
          border: `1px solid ${palette.borderSplit}`,
          borderRadius: 14,
          overflow: 'hidden',
          background: palette.bgContainer,
          boxShadow: shadowCard,
          minWidth: 0,
        }}
      >
        <div style={{ padding: `${space.md}px ${space.xl}px`, display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          {/* At least a control's height on both lenses, so B's drawing
              starts on the line of A's, whose header also carries the
              default-height Ghi chú button (Q1). */}
          <div style={{ minWidth: 0, flex: 1, minHeight: controlHeight }}>
            <h3 style={{ margin: 0, ...type.cardTitle, letterSpacing: '-0.015em' }}>
              {`Tiến độ · ${lens.title}`}
              {/* The map legend: needed once, not read every visit (CPY-01). */}
              <InfoTip text={legend} />
            </h3>
            {/*
              A layer pinned to a day says so under its title (RV6-16), and
              says how far back the record it was built from goes (RV6-15):
              rows older than the work model name no work and are left out, so
              a day before 24/08 reads as nothing started -- which is true of
              the record, not of the deck, and the line is what keeps the two
              apart. While the history is still being read, or could not be,
              the drawing underneath is the LIVE deck and the header says so
              rather than letting the date above stand over today's colours.
            */}
            {lens.view.day && (
              <div style={{ marginTop: 6, ...type.caption, lineHeight: 1.35 }}>
                <div style={{ color: palette.textSecondary }}>
                  {`Trạng thái ngày ${lens.view.day}`}
                  <InfoTip text={HISTORY_FROM_LABEL} />
                </div>
                {!lens.view.cells && (
                  <div style={{ color: palette.textTertiary, marginTop: 2 }}>
                    {historyLoading
                      ? <><Spin size="small" style={{ marginRight: 6 }} />Đang tải lịch sử…</>
                      : 'Chưa đọc được lịch sử — đang hiện trạng thái hôm nay'}
                  </div>
                )}
              </div>
            )}
          </div>
          {/*
            The other way to a bay's notes. A tap on the drawing opens them
            while looking, but while editing a tap SELECTS -- and the report
            copy (0023) is written while editing. Once per panel, on the left
            lens, so the split view does not grow two of them.
          */}
          {side === 'A' && (
            <Button
              disabled={notedCodes.length === 0}
              onClick={() => setNotesListOpen(true)}
            >
              {`Ghi chú (${notedCodes.length})`}
            </Button>
          )}
        </div>

        {/*
          Comparing two layers, each one's controls sit above its own drawing
          (RV6-17): "tách bộ lọc 2 bên trái phải nằm trên layout". One shared
          row above two drawings made the admin read across two selects to
          work out which drawing a change would land on; here the select is
          over the picture it changes. On a single layer the pair stays in
          the shared row, so nothing moves for the view that had no ambiguity.
        */}
        {splitView && (
          <div style={{ padding: `0 ${space.xl}px ${space.md}px` }}>
            {renderLayerControls(side === 'A' ? 'a' : 'b')}
          </div>
        )}

        <div
          style={{
            position: 'relative',
            borderTop: `1px solid ${palette.borderSplit}`,
            borderBottom: `1px solid ${palette.borderSplit}`,
          }}
        >
          <DrawingCanvas
            imageUrl={imageUrl}
            imageW={entry.imageW ?? 0}
            imageH={entry.imageH ?? 0}
            cells={entry.deck.cells}
            selectedCodes={editable && side === 'A' ? selectedCodes : []}
            cellColors={lens.colors}
            cellOpacities={lens.opacities}
            outlineColors={lens.outlines}
            zoneLabels={lens.labels}
            markedCodes={notedCodes}
            panZoom
            zoom={zoom}
            onZoomChange={setZoom}
            showZoomControls={false}
            // Selecting bays is what a click means while editing; reading what
            // the foreman wrote is what it means while looking. Only the left
            // lens selects -- two canvases writing one selection would let the
            // admin build a zone out of bays picked on two different coats.
            onCellClick={
              editable && side === 'A'
                ? ((code) => toggleCell(code))
                : ((code) => openNote(code))
            }
            onSelectDraw={editable && side === 'A' ? sweep : undefined}
          />
          {/*
            One chip per coat in view (RV6-13). A single coat is the one chip
            the header always carried; `Tất cả công đoạn` is the whole row, so
            the colours on the drawing can be read back without a legend
            elsewhere. Wraps rather than scrolls -- five coats over a narrow
            half of the split view is the case that overflows.
          */}
          <div
            data-testid={`lens-chips-${side}`}
            style={{
              position: 'absolute',
              zIndex: 3,
              left: 12,
              top: 12,
              display: 'flex',
              flexWrap: 'wrap',
              gap: 6,
              maxWidth: 'calc(100% - 24px)',
            }}
          >
            {lens.chips.map((chip) => (
              <span
                key={chip.id}
                data-testid="lens-chip"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 9,
                  background: '#FFFFFFF0',
                  border: `1px solid ${palette.borderSplit}`,
                  borderRadius: 9,
                  padding: '6px 10px',
                }}
              >
                <span
                  aria-hidden
                  data-testid="lens-chip-marker"
                  // A circle of the coat's colour, nothing else (CLR-03).
                  style={{ width: 14, height: 14, borderRadius: '50%', background: chip.color }}
                />
                <span style={type.micro}>{chip.name}</span>
                <span style={{ ...type.micro, color: palette.accent }}>
                  {formatPercent(chip.ratio)}
                </span>
              </span>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'baseline', gap: 9, padding: `${space.md}px ${space.xl}px ${space.sm}px` }}>
          <span style={{ ...type.label, color: palette.textTertiary }}>
            {`Tiến độ từng zone · ${lens.title}`}
          </span>
          <span style={{ marginLeft: 'auto', ...type.caption, color: palette.textTertiary }}>
            {`${formatAreaM2(lens.reachedAreaM2)} / ${formatAreaM2(entry.deck.totalAreaM2)} ${unit}`}
          </span>
        </div>

        <div style={{ padding: '0 10px 10px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {lens.zones.length === 0 && (
            <div style={{ padding: '7px 9px', ...type.caption, color: palette.textTertiary }}>
              Lớp sơn này chưa có zone nào được lên kế hoạch.
            </div>
          )}
          {lens.zones.map((row) => {
            const zonePct = row.totalM2 > 0 ? row.doneM2 / row.totalM2 : 0
            const planned = formatPlanRange(row.zone.startDate, row.zone.finishDate)
            const line = (
              <>
                <span
                  aria-hidden
                  data-testid="zone-marker"
                  // A circle of the zone's colour, nothing else (CLR-03).
                  style={{ width: 15, height: 15, borderRadius: '50%', flex: 'none', background: row.color }}
                />
                <span style={{ ...type.body, flex: 'none' }}>{row.zone.name}</span>
                <span style={{ ...type.caption, color: palette.textTertiary, flex: 'none' }}>
                  {`${formatAreaM2(row.doneM2)} / ${formatAreaM2(row.totalM2)} ${unit}`}
                </span>
                <span style={{ flex: 1, minWidth: 24 }}>
                  <ProgressBar ratio={zonePct} color={row.color} height={5} />
                </span>
                <span
                  style={{ ...type.body, flex: 'none', minWidth: 44, textAlign: 'right' }}
                >
                  {formatPercent(zonePct)}
                </span>
                <span
                  style={{
                    ...type.caption,
                    color: planned ? palette.textTertiary : palette.accent,
                    minWidth: 116,
                    textAlign: 'right',
                    flex: 'none',
                  }}
                >
                  {planned || (editable ? 'đặt ngày' : 'chưa đặt mốc ngày')}
                </span>
              </>
            )
            const rowStyle = {
              display: 'flex',
              alignItems: 'center',
              gap: 9,
              width: '100%',
              padding: '7px 9px',
              background: palette.bgContainer,
              border: `1px solid ${palette.borderSplit}`,
              borderRadius: 9,
              textAlign: 'left' as const,
            }
            // A button only where pressing it does something. In view mode the
            // row is a readout, and a control that opens an empty popover is
            // worse than no control.
            return editable ? (
              <button
                key={row.zone.id}
                type="button"
                aria-label={`Mốc ngày của ${row.zone.name}`}
                onClick={() => setDatesFor(row.zone)}
                style={{ ...rowStyle, cursor: 'pointer' }}
              >
                {line}
              </button>
            ) : (
              <div key={row.zone.id} style={rowStyle}>
                {line}
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  const summary = progress
    ? `${formatPercent(progress.progress)} · ${zones.length} zone`
    : undefined

  return (
    <>
    {/* Three cards, not one: the drawing panel, then the deck across its works
        and per coat as A3.5 and A3.6 (UX-03). Kept at this indentation so the
        panel's 700 lines did not all move for a wrapper. */}
    <SectionCard
      code="A3.4"
      title="Tiến độ theo lớp sơn"
      summary={summary}
      collapsible
      bodyPadding={0}
      footer={<RulesDisclosure rules={PROGRESS_RULES} />}
      extra={
        entry && entry.imagePath && imageUrl ? (
          <Space size={10}>
            {/*
              The plan overlay, on a switch (RV6-12). Before the layer control
              because it changes what every layer draws, where the segmented
              control only changes how many there are. `Hiện kế hoạch` is the
              foreman screen's wording for the same thing, so one plan toggle
              is named one way across the product.
            */}
            <Space size={7}>
              <Switch
                size="small"
                aria-label="Hiện kế hoạch"
                checked={showPlan}
                onChange={setShowPlan}
              />
              <span style={{ ...type.body, color: palette.textSecondary }}>
                Hiện kế hoạch
              </span>
            </Space>
            <Segmented
              value={splitView ? 'split' : 'single'}
              onChange={(v) => setSplitView(v === 'split')}
              options={[
                { value: 'single', label: 'Một lớp' },
                { value: 'split', label: 'So sánh hai lớp' },
              ]}
            />
            {/* One compound control, as a field with its addon button is:
                small buttons inside a frame whose padding and border bring
                it to the Segmented's height, within a pixel (CTL-01, Q3). */}
            <Space
              size={4}
              style={{
                background: palette.bgSubtle,
                border: `1px solid ${palette.borderSplit}`,
                borderRadius: 10,
                padding: 4,
              }}
            >
              <Button
                size="small"
                aria-label="Thu nhỏ"
                icon={<MinusOutlined aria-hidden />}
                onClick={() => setZoom((z) => Math.max(1, z - 0.5))}
              />
              <span
                style={{
                  display: 'inline-flex',
                  justifyContent: 'center',
                  minWidth: 50,
                  ...type.body,
                  color: palette.textSecondary,
                }}
              >
                {`${Math.round(zoom * 100)}%`}
              </span>
              <Button
                size="small"
                aria-label="Phóng to"
                icon={<PlusOutlined aria-hidden />}
                onClick={() => setZoom((z) => Math.min(4, z + 0.5))}
              />
              <Button
                size="small"
                aria-label="Vừa khung"
                icon={<ExpandOutlined aria-hidden />}
                onClick={() => setZoom(1)}
              />
            </Space>
          </Space>
        ) : undefined
      }
    >
      {loading && <Spin style={{ display: 'block', margin: '8vh auto' }} />}

      {!loading && (
        <div style={{ padding: `${space.lg}px ${space.xl}px ${space.xl}px` }}>
          {error && (
            <Alert
              style={{ marginBottom: 14 }}
              type="error"
              message={error}
              closable
              onClose={() => setError(null)}
            />
          )}

          {!entry && <EmptyState
              tone="error"
              title="Không tải được tiến độ sàn"
              description="Thử tải lại trang. Nếu vẫn không được, kiểm tra kết nối tới máy chủ."
            />}

          {entry && !entry.imagePath && (
            <EmptyState
              title="Chưa có gì để hiển thị"
              description="Sàn cần bản vẽ và lưới ô trước khi có tiến độ hay kế hoạch zone."
            />
          )}

          {deckWorks && deckWorks.works.length === 0 && entry?.imagePath && (
            <EmptyState
              title="Sàn này chưa thuộc công việc nào"
              description="Gán sàn vào một công việc ở mục Công việc, rồi cấu hình lớp sơn cho nó."
            />
          )}

          {entry && entry.imagePath && imageUrl && activeWork && (
            <>
              <div style={{ display: 'flex', gap: 14, alignItems: 'flex-end', marginBottom: 16 }}>
                {deckWorks && deckWorks.works.length > 1 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                    <label
                      htmlFor="lens-work"
                      style={{ ...type.label, color: palette.textTertiary }}
                    >
                      Công việc
                    </label>
                    <Select
                      id="lens-work"
                      {...searchSelectProps}
                      style={{ minWidth: 170 }}
                      value={activeWork.work.id}
                      onChange={(id) => {
                        setWorkId(id)
                        // Coat ids belong to a (work, deck); the last work's
                        // selection would name a coat this one does not have.
                        setViewA(null)
                        setViewB(null)
                      }}
                      options={deckWorks.works.map((w) => ({ value: w.work.id, label: w.work.name }))}
                    />
                  </div>
                ) : (
                  <span style={{ ...type.caption, color: palette.textTertiary, alignSelf: 'center' }}>
                    {`Công việc: ${activeWork.work.name}`}
                  </span>
                )}
                {/*
                  On a single layer the pair lives here, in the row it always
                  did. Comparing two, each layer's pair moves into its own pane
                  above its drawing (RV6-17), and this row keeps only what is
                  common to both.
                */}
                {!splitView && renderLayerControls('a')}
                {/*
                  Always on screen in Sửa, disabled rather than hidden. Hiding
                  it until bays are picked takes away the only thing on the
                  panel that says zones can be made here at all -- the admin has
                  to already know the gesture to discover the button for it.
                */}
                {editable && (
                  <Space style={{ marginLeft: 'auto' }}>
                    {selectedCodes.length > 0 && (
                      <Button onClick={() => setSelectedCodes([])}>Bỏ chọn</Button>
                    )}
                    {/*
                      A zone row IS one stage_id, so there is no coat to write
                      while the left layer is showing all of them (RV6-13).
                      Disabled with the reason on it rather than hidden, for
                      the same reason the empty-selection state is.
                    */}
                    <HintedButton
                      type="primary"
                      icon={<PlusOutlined aria-hidden />}
                      label={`Gộp thành zone (${selectedCodes.length})`}
                      tip={
                        viewA === ALL_STAGES
                          ? 'Chọn một công đoạn để tạo zone'
                          : selectedCodes.length > 0
                            ? 'Gộp các ô đang chọn thành một zone'
                            : 'Chọn ô trên bản vẽ trước — bấm từng ô, hoặc giữ Shift rồi kéo'
                      }
                      disabled={selectedCodes.length === 0 || viewA === ALL_STAGES}
                      onClick={() => {
                        setWindows({})
                        form.resetFields()
                        setZoneFormOpen(true)
                      }}
                    />
                  </Space>
                )}
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: splitView
                    ? 'minmax(0,1fr) minmax(0,1fr)'
                    : 'minmax(0,1fr) minmax(300px,352px)',
                  gap: 18,
                  alignItems: 'start',
                }}
              >
                {renderLens(lensA, 'A')}
                {splitView
                  ? renderLens(lensB, 'B')
                  : (
                    <div
                      data-testid="stage-ring"
                      style={{
                        border: `1px solid ${palette.borderCard}`,
                        borderRadius: 14,
                        background: palette.bgContainer,
                        boxShadow: shadowCard,
                        overflow: 'hidden',
                      }}
                    >
                      <div style={{ padding: `${space.md}px ${space.xl}px`, borderBottom: `1px solid ${palette.borderSplit}` }}>
                        <h3 style={{ margin: 0, ...type.cardTitle, letterSpacing: '-0.015em' }}>
                          Tiến độ theo công đoạn · cộng dồn
                          <InfoTip text="Ô đã ở lớp sau thì đã qua các lớp trước, nên tính cho cả các lớp đó" />
                        </h3>
                      </div>
                      <StageRing
                        slices={ringSlices}
                        stages={progress?.stages ?? []}
                        progress={progress?.progress ?? 0}
                        totalAreaM2={entry.deck.totalAreaM2}
                        unit={unit}
                      />
                      <div
                        style={{
                          padding: `${space.md}px ${space.xl}px`,
                          borderTop: `1px solid ${palette.borderSplit}`,
                          background: palette.bgSubtle,
                          display: 'flex',
                          alignItems: 'center',
                          gap: 9,
                        }}
                      >
                        <span style={{ ...type.label, color: palette.textSecondary }}>
                          Tiến độ sàn
                        </span>
                        <span
                          style={{ marginLeft: 'auto', ...type.caption, color: palette.textTertiary }}
                        >
                          {`${formatAreaM2(entry.deck.totalAreaM2)} ${unit}`}
                        </span>
                        <span style={{ ...type.displaySm, letterSpacing: '-0.025em' }}>
                          {formatPercent(progress?.progress ?? 0)}
                        </span>
                      </div>
                    </div>
                  )}
              </div>

            </>
          )}
        </div>
      )}

      {/*
        A dialog rather than a popover anchored to the bay. The bay is a shape
        inside a canvas that pans and zooms, so an anchored bubble has to track
        a moving target -- and the note is prose, which wants room to be read
        rather than a tooltip's width.
      */}
      <Modal
        open={noteCell !== null}
        title={noteCell ? `Ghi chú · ô ${noteCell.code}` : ''}
        onCancel={() => setNoteCell(null)}
        width={560}
        footer={[
          <Button key="close" onClick={() => setNoteCell(null)}>
            Đóng
          </Button>,
        ]}
        {...modalProps}
      >
        {noteLoading && <Spin style={{ display: 'block', margin: '32px auto' }} />}
        {!noteLoading && noteError !== null && (
          <Alert
            type="warning"
            showIcon
            message="Không tải được lịch sử ghi chú"
            description={`${noteError} — ghi chú mới nhất bên dưới vẫn đúng.`}
            style={{ marginBottom: 14 }}
          />
        )}
        {!noteLoading && noteError !== null && noteCell && (
          <Typography.Paragraph style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
            {noteCell.note}
          </Typography.Paragraph>
        )}
        {!noteLoading && noteError === null && (
          <NoteThread
            notes={notes}
            current={noteCell?.note}
            // Xem carries no write on this screen: the handlers, and with them
            // the buttons, exist only while editing.
            onEditReport={editable ? openReportEdit : undefined}
            onToggleHidden={editable ? toggleHidden : undefined}
          />
        )}
      </Modal>

      <Modal
        open={notesListOpen}
        title="Ghi chú trên sàn"
        onCancel={() => setNotesListOpen(false)}
        width={520}
        footer={[
          <Button key="close" onClick={() => setNotesListOpen(false)}>
            Đóng
          </Button>,
        ]}
        {...modalProps}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {(entry?.deck.cells ?? [])
            .filter((c) => notedCodes.includes(c.code))
            .sort((a, b) => a.code.localeCompare(b.code))
            .map((c) => (
              <Button
                key={c.id}
                type="text"
                block
                style={{ justifyContent: 'flex-start', height: 'auto', padding: '8px 10px', textAlign: 'left' }}
                onClick={() => {
                  setNotesListOpen(false)
                  openNote(c.code)
                }}
              >
                <span style={{ ...type.bodyStrong, marginRight: 8 }}>{c.code}</span>
                <span style={{ color: palette.textSecondary, whiteSpace: 'normal' }}>
                  {(c.note ?? '').trim()}
                </span>
              </Button>
            ))}
        </div>
      </Modal>

      <Modal
        open={reportEdit !== null}
        title={reportEdit ? `Bản cho báo cáo · ô ${noteCell?.code ?? ''}` : ''}
        onCancel={closeReportEdit}
        width={520}
        footer={[
          <Button key="cancel" onClick={closeReportEdit} disabled={reportSaving}>
            Huỷ
          </Button>,
          ...(reportEdit?.reportNote !== null && reportEdit?.reportNote !== undefined
            ? [
              <Button key="restore" onClick={restoreReportNote} disabled={reportSaving}>
                Khôi phục bản gốc
              </Button>,
            ]
            : []),
          <Button key="save" type="primary" onClick={saveReportNote} loading={reportSaving}>
            Lưu bản cho báo cáo
          </Button>,
        ]}
        {...modalProps}
      >
        {reportEdit && (
          <>
            <div style={{ ...type.caption, color: palette.textTertiary, marginBottom: 10 }}>
              {`Ghi chú gốc của GS · ${reportEdit.stageName ?? 'Trả về chưa bắt đầu'}`}
            </div>
            <Typography.Paragraph
              style={{
                margin: '0 0 14px',
                padding: '10px 12px',
                borderRadius: 8,
                background: palette.bgSubtle,
                whiteSpace: 'pre-wrap',
              }}
            >
              {reportEdit.note}
            </Typography.Paragraph>
            {/* The (?) beside the label, outside it: inside, a click would move
                focus to the field and the tip would join the field's name. */}
            <div style={{ marginBottom: 6 }}>
              <label htmlFor="report-note" style={type.label}>Bản cho báo cáo</label>
              <InfoTip text="Chỉ file Excel in bản này. GS và màn hình này vẫn thấy ghi chú gốc." />
            </div>
            <Input.TextArea
              id="report-note"
              rows={3}
              value={reportDraft}
              onChange={(e) => setReportDraft(e.target.value)}
            />
          </>
        )}
      </Modal>

      {/*
        The zone's plan, opened off its own row.

        Dates write as they are picked rather than behind a Save: a date that
        looks set but is not is worse than no date, and there is nothing here to
        validate across the two fields that would need a commit step.
      */}
      <Modal
        open={datesFor !== null}
        title={datesFor ? `Mốc ngày · ${datesFor.name}` : ''}
        onCancel={() => setDatesFor(null)}
        footer={[
          <Button key="done" type="primary" onClick={() => setDatesFor(null)}>
            Xong
          </Button>,
        ]}
        {...modalProps}
      >
        {datesFor && (
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            <Typography.Text type="secondary" style={type.caption}>
              {`${stageName(datesFor.stageId)} · ${datesFor.cellIds.length} ô`}
            </Typography.Text>
            {/*
              The name, above the dates (RV6-11). Prefilled with the base, not
              the stored string: the coat suffix is `createZone`'s doing and is
              re-applied on save, so it is never something to retype.
            */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              <label
                htmlFor="zone-name"
                style={{ ...type.label, color: palette.textSecondary }}
              >
                Tên zone
              </label>
              <Input
                id="zone-name"
                value={zoneNameValue(datesFor)}
                onChange={(e) => setNameDraft({ zoneId: datesFor.id, value: e.target.value })}
                onBlur={() => void commitZoneName(datesFor)}
                onPressEnter={() => void commitZoneName(datesFor)}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              <span style={{ ...type.label, color: palette.textSecondary }}>Thời gian</span>
              {/*
                One range, not two dates (owner request, 2026-09-05). Either
                end may be empty -- a zone whose finish has slipped keeps its
                start -- and every partial pick is written, so nothing typed
                is lost when the popup closes.
              */}
              <DatePicker.RangePicker
                data-testid={`zone-range-${datesFor.id}`}
                format="DD/MM/YYYY"
                allowEmpty={[true, true]}
                placeholder={['Bắt đầu', 'Kết thúc']}
                value={[
                  datesFor.startDate ? dayjs(datesFor.startDate) : null,
                  datesFor.finishDate ? dayjs(datesFor.finishDate) : null,
                ]}
                onCalendarChange={(v) => void patchZoneDates(datesFor, v as [dayjs.Dayjs | null, dayjs.Dayjs | null] | null)}
              />
            </div>
            <ZoneColorSwatches
              colors={freeColors}
              value={zoneColorOf(datesFor, 0, stageColors)}
              onChange={(c) => void recolorZone(datesFor, c)}
            />
            {/* The bays, changed after the fact (Feedback Rv4). Reads the
                selection on the drawing behind this dialog, so the count is
                named rather than left to be guessed at. */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              <span style={{ ...type.label, color: palette.textSecondary }}>Ô trong zone</span>
              {/* The reason a button is disabled is on the button, as on
                  Gộp thành zone, and reachable by keyboard on both (CPY-01,
                  CPY-02). */}
              <Space wrap>
                <HintedButton
                  label={`Thêm ${selectedCodes.length} ô đã chọn`}
                  tip={selectedCodes.length === 0 ? ZONE_CELLS_HINT : undefined}
                  disabled={selectedCodes.length === 0}
                  onClick={() => void changeZoneCells(datesFor, 'add')}
                />
                <HintedButton
                  label={`Bỏ ${selectedCodes.length} ô đã chọn`}
                  tip={selectedCodes.length === 0 ? ZONE_CELLS_HINT : undefined}
                  disabled={selectedCodes.length === 0}
                  onClick={() => void changeZoneCells(datesFor, 'remove')}
                />
              </Space>
            </div>
            <Space>
              <Button onClick={() => void applyZone(datesFor)}>Ghi thực tế</Button>
              <Button danger onClick={() => setRemovingZone(datesFor)}>
                Xoá zone
              </Button>
            </Space>
          </Space>
        )}
      </Modal>

      <ConsequenceModal
        open={removingZone !== null}
        tone="danger"
        tag="Thao tác phá huỷ"
        title={`Xoá zone ${removingZone?.name ?? ''}?`}
        description="Kế hoạch của zone này sẽ bị xoá:"
        items={
          removingZone
            ? [{ label: removingZone.name, meta: `${removingZone.cellIds.length} ô` }]
            : []
        }
        consequence="Chỉ kế hoạch bị xoá. Tiến độ GS đã ghi trên các ô vẫn giữ nguyên, và các ô đó quay về trạng thái chưa được lên kế hoạch cho lớp sơn này."
        okText="Vẫn xoá"
        onCancel={() => setRemovingZone(null)}
        onOk={() =>
          void removeZone(removingZone!).then(() => {
            setRemovingZone(null)
            setDatesFor(null)
          })
        }
      />

      {editable && (
      <Modal
        title={`Gộp ${selectedCodes.length} ô thành zone`}
        open={zoneFormOpen}
        onCancel={() => setZoneFormOpen(false)}
        okText="Tạo zone"
        cancelText="Huỷ"
        onOk={() => void submitZones()}
        width={640}
        {...modalProps}
      >
        <Form form={form} layout="vertical">
          <Form.Item
            label="Tên zone"
            name="name"
            rules={[{ required: true, message: 'Đặt tên cho zone' }]}
          >
            <Input placeholder="Khu A" />
          </Form.Item>
        </Form>

        <ZoneColorSwatches
          colors={freeColors}
          value={chosenZoneColor}
          onChange={setZoneColor}
        />

        <div data-testid="stage-windows">
          <Table
            size="small"
            rowKey="id"
            pagination={tablePagination(entry?.stages.length ?? 0)}
            dataSource={entry?.stages ?? []}
            columns={[
              { title: 'Công đoạn', dataIndex: 'name', key: 'name' },
              {
                title: 'Thời gian',
                align: 'center',
                key: 'window',
                render: (_, st: Stage) => (
                  <DatePicker.RangePicker
                    size="small"
                    format="DD/MM/YYYY"
                    allowEmpty={[true, true]}
                    placeholder={['Bắt đầu', 'Kết thúc']}
                    value={[windows[st.id]?.startDate ?? null, windows[st.id]?.finishDate ?? null]}
                    onCalendarChange={(v) => setWindowRange(st.id, v as [dayjs.Dayjs | null, dayjs.Dayjs | null] | null)}
                  />
                ),
              },
            ]}
          />
        </div>
      </Modal>
      )}
    </SectionCard>

    {/*
      The deck across its works, and per coat: boxes inside A3.4 until UX-03,
      which made them the only sections of the deck page without a code. As
      cards of their own the page reads as one ordered list, and each takes
      the card inset (LAY-01). Same guard as the drawing above -- there is
      nothing to sum before the deck has a drawing and cells.
    */}
    {!loading && entry && entry.imagePath && imageUrl && activeWork && deckSummary && (
      <SectionCard
        code="A3.5"
        title="Sàn này theo từng công việc"
        bodyPadding={0}
      >
        <div data-testid="deck-works-table">
          <table style={{ width: '100%', borderCollapse: 'collapse', ...type.body }}>
            {/* Labelled columns: the weight used to sit mid-row with nothing
                saying what it was. Same header look as the antd tables. */}
            <thead>
              <tr style={{ background: palette.bgSubtleAlt, borderBottom: `1px solid ${palette.borderSplit}` }}>
                <th style={{ padding: `${space.sm}px ${space.md}px ${space.sm}px ${space.xl}px`, textAlign: 'left', ...type.label, color: palette.textTertiary }}>Công việc</th>
                <th style={{ padding: `${space.sm}px ${space.md}px`, textAlign: 'center', ...type.label, color: palette.textTertiary }}>Trọng số sàn</th>
                <th style={{ padding: `${space.sm}px ${space.xl}px ${space.sm}px ${space.md}px`, textAlign: 'center', ...type.label, color: palette.textTertiary }}>Tiến độ</th>
              </tr>
            </thead>
            <tbody>
              {deckSummary.perWork.map((row) => (
                <tr key={row.work.id} style={{ borderBottom: `1px solid ${palette.borderSplit}` }}>
                  {/* Edge cells carry the card gutter, as antd's do under `.pp-card`. */}
                  <td style={{ padding: `${space.sm}px ${space.md}px ${space.sm}px ${space.xl}px` }}>{row.work.name}</td>
                  <td style={{ padding: `${space.sm}px ${space.md}px`, color: palette.textTertiary, textAlign: 'center' }}>
                    {formatWeight(row.weight)}
                  </td>
                  <td style={{ padding: `${space.sm}px ${space.xl}px ${space.sm}px ${space.md}px`, textAlign: 'center', minWidth: 72 }}>
                    {formatPercent(row.progress)}
                  </td>
                </tr>
              ))}
              <tr style={{ background: palette.bgSubtle }}>
                <td style={{ padding: `${space.sm}px ${space.md}px ${space.sm}px ${space.xl}px`, ...type.bodyStrong }}>Tổng hợp</td>
                {/* Σ W·D is a project-level share, not a deck weight; it
                    belongs on the decks list, not in this column. */}
                <td />
                <td style={{ padding: `${space.sm}px ${space.xl}px ${space.sm}px ${space.md}px`, textAlign: 'center', ...type.bodyStrong }}>
                  {formatPercent(deckSummary.progress)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </SectionCard>
    )}

    {!loading && entry && entry.imagePath && imageUrl && activeWork && (
      <SectionCard
        code="A3.6"
        title="Diện tích cộng dồn theo công đoạn"
        bodyPadding={0}
      >
        <div data-testid="deck-spec">
          <StageSpecTable stages={progress?.stages ?? []} unit={unit} />
        </div>
      </SectionCard>
    )}
    </>
  )
}

/**
 * The deck's coat ring and its cumulative rows, with the coat under the
 * pointer or focus (CHT-02). Its own component so that hovering re-renders
 * the ring and the rows, not the panel and its two Konva canvases (m-4).
 */
function StageRing({
  slices,
  stages,
  progress,
  totalAreaM2,
  unit,
}: {
  slices: DonutSlice[]
  /** Cumulative, per coat in seq order: the rows. */
  stages: StageProgress[]
  /** The deck figure in the ring's centre. */
  progress: number
  totalAreaM2: number
  unit: string
}) {
  const [active, setActive] = useState<string | null>(null)
  return (
    <div style={{ padding: `${space.lg}px ${space.xl}px`, display: 'flex', alignItems: 'center', gap: 18 }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7 }}>
      <Donut
        label="Diện tích đang dừng ở mỗi lớp"
        slices={slices}
        size={168}
        thickness={30}
        activeKey={active}
        onActiveChange={setActive}
      >
        <span style={{ ...type.micro, color: palette.textTertiary }}>
          Tiến độ sàn
          <InfoTip text="Vòng tròn: diện tích đang dừng ở mỗi lớp, không cộng dồn" />
        </span>
        {/* The largest step that fits the hole, down to bodyStrong (I-2). */}
        <span
          data-testid="ring-figure"
          style={{
            ...ringFigureStep(formatPercent(progress), [type.displaySm, type.cardTitle, type.bodyStrong], DECK_RING),
            letterSpacing: '-0.03em',
            marginTop: 5,
          }}
        >
          {formatPercent(progress)}
        </span>
        <span style={{ ...type.caption, color: palette.textTertiary, marginTop: 3 }}>
          {`${formatAreaM2(totalAreaM2)} ${unit}`}
        </span>
      </Donut>
      </div>
      {/*
        CUMULATIVE, and the ring beside it is not (Feedback
        Rv3, item 1). Linh read "Blast + Coat 1 · 10,05%" off
        this list on a deck where 90,54% of the area had been
        through Blast + Coat 1, because the list was the
        ring's own non-cumulative slices. A bay at Coat 3 has
        been through Coat 2, and the customer is billed on
        the cumulative figure -- so that is what the rows say,
        exactly as the GS screen's rollup card says it. The
        ring keeps its own question and now carries a caption
        saying which one it answers.
      */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
        {stages.map((sp) => (
          <div
            key={sp.stage.id}
            data-testid="stage-legend-row"
            {...legendRowProps(sp.stage.id, active, setActive, {
              display: 'flex', alignItems: 'center', gap: 9, minWidth: 0,
            })}
          >
            <span
              aria-hidden
              data-testid="stage-legend-marker"
              style={{
                // A circle of the coat's colour, nothing else (CLR-03).
                width: 15,
                height: 15,
                borderRadius: '50%',
                flex: 'none',
                background: sp.stage.color,
              }}
            />
            {/*
              Two lines, not three columns: the rail is ~300px
              and "Blast + Coat 1" beside an area and a percent
              wrapped word by word over the numbers (seen in
              Chrome). Name on top, figures beneath it.
            */}
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ ...type.body, lineHeight: 1.3 }}>
                {sp.stage.name}
              </div>
              <div
                style={{
                  display: 'flex',
                  gap: 6,
                  ...type.caption,
                  color: palette.textTertiary,
                  lineHeight: 1.3,
                  marginTop: 1,
                }}
              >
                <span style={{ color: palette.textSecondary, whiteSpace: 'nowrap' }}>
                  {`${formatAreaM2(sp.cumulativeAreaM2)} / ${formatAreaM2(totalAreaM2)} ${unit}`}
                </span>
                <span aria-hidden>·</span>
                <span>{formatPercent(sp.ratio)}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
