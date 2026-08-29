import { ExpandOutlined, MinusOutlined, PlusOutlined } from '@ant-design/icons'
import {
  Alert, App, Button, DatePicker, Form, Input, Modal, Segmented,
  Select, Space, Spin, Table, Tooltip, Typography,
} from 'antd'
import dayjs from 'dayjs'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { DrawingCanvas } from '../../canvas/DrawingCanvas'
import { cellsInBox } from '../../domain/geometry'
import { codesNotReaching, zoneLensColors, ZONE_PALETTE } from '../../domain/lens'
import { buildStageSlices } from '../../domain/pieSlices'
import { formatPlanRange } from '../../domain/plan'
import { computeDeckProgress } from '../../domain/progress'
import type { Stage, Zone } from '../../domain/types'
import { getDrawingUrl } from '../../lib/decksApi'
import { formatAreaM2, formatPercent } from '../../lib/format'
import { subscribeDeckCells } from '../../lib/gsApi'
import {
  listCellNotes, loadDeckProgress, type CellNote, type DeckProgressEntry,
} from '../../lib/progressApi'
import {
  createZone, deleteZone, listDeckZones, setZoneActual, updateZone,
} from '../../lib/zonesApi'
import { ConsequenceModal } from '../../components/ConsequenceModal'
import { Donut } from '../../components/Donut'
import { EmptyState } from '../../components/EmptyState'
import { NoteThread } from '../../components/NoteThread'
import { ProgressBar } from '../../components/ProgressBar'
import { RulesDisclosure } from '../../components/RulesDisclosure'
import { SectionCard } from '../../components/SectionCard'
import { StageSpecTable } from '../../components/StageSpecTable'
import { modalProps } from '../../components/modalChrome'
import { palette, shadowCard } from '../../theme'
import type { Cell } from '../../domain/types'


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

const PROGRESS_RULES = [
  {
    id: 'ZON-R5',
    text: 'Xoá zone chỉ xoá kế hoạch; tiến độ đã ghi trên các ô vẫn giữ nguyên.',
  },
  {
    id: 'LNS-R1',
    text: 'Ô tô theo màu zone của lớp đang xem, hoặc màu lớp đó nếu chưa có zone. Ô gạch chéo là chưa đạt lớp đang xem; ô tô đặc là đã đạt.',
  },
  {
    id: 'LNS-R2',
    text: 'Panel tự làm mới khi GS ghi tiến độ: số liệu ở đây bám theo dữ liệu thật, không cần tải lại trang.',
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
  const [entry, setEntry] = useState<DeckProgressEntry | null>(null)
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
  /** The coat each lens is showing. Null only before the stages have loaded. */
  const [viewA, setViewA] = useState<string | null>(null)
  const [viewB, setViewB] = useState<string | null>(null)
  /**
   * Shared by both lenses, which is the whole point of the split view: two
   * drawings free to sit at different scales are not a comparison.
   */
  const [zoom, setZoom] = useState(1)
  /** The zone whose date popover is open. */
  const [datesFor, setDatesFor] = useState<Zone | null>(null)
  /** The zone whose deletion is being confirmed. */
  const [removingZone, setRemovingZone] = useState<Zone | null>(null)
  const [windows, setWindows] = useState<Record<string, StageWindow>>({})
  /** The bay whose note is open, and the names to attribute it to. */
  const [noteCell, setNoteCell] = useState<Cell | null>(null)
  /** Every note ever left on the open bay, newest first. */
  const [notes, setNotes] = useState<CellNote[]>([])
  const [noteLoading, setNoteLoading] = useState(false)
  const [noteError, setNoteError] = useState<string | null>(null)
  const { message } = App.useApp()
  const [form] = Form.useForm()

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      setEntry(await loadDeckProgress(deckId))
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
      setZones(await listDeckZones(deckId))
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
    const stop = subscribeDeckCells(deckId, {
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

  // Reported in an effect rather than during render: this sets state on the
  // parent, and doing that while rendering a child is a React error.
  useEffect(() => {
    onProgress?.(progress ? progress.progress : null)
  }, [progress, onProgress])
  /**
   * The coats each lens is showing, resolved.
   *
   * A default rather than a nullable everywhere below: the panel is useless
   * without a coat selected, and the first coat is the one every deck has.
   */
  const stages = entry?.stages ?? []
  const stageA = stages.find((st) => st.id === viewA) ?? stages[0] ?? null
  const stageB = stages.find((st) => st.id === viewB) ?? stages[stages.length - 1] ?? null

  /**
   * Everything one lens needs, for one coat.
   *
   * Both lenses read the same deck through this, so the split view cannot drift
   * into showing two differently-computed pictures.
   *
   * Bays are coloured by ZONE where the coat has one planned, and by the coat's
   * own colour where it does not. A zone-only rule would leave an unplanned
   * deck blank, which is most decks before the plan is drawn; a coat-only rule
   * would lose the grouping the plan exists to show. Either way the FILL says
   * "which group", and the HATCH says "not there yet" -- solid means the bay has
   * reached this coat.
   */
  const lensFor = (stage: Stage | null) => {
    if (!entry || !stage) {
      return { stage: null, colors: {}, pending: [], zones: [], zoneColors: {}, reached: 0, total: 0 }
    }
    const zonesHere = zones.filter((z) => z.stageId === stage.id)
    const colorById = Object.fromEntries(
      zonesHere.map((z, i) => [z.id, ZONE_PALETTE[i % ZONE_PALETTE.length]]),
    )
    const pending = codesNotReaching(entry.deck.cells, entry.stages, stage.id)
    const pendingSet = new Set(pending)
    const zoned = zoneLensColors(zonesHere, entry.deck.cells)
    const colors: Record<string, string> = {}
    for (const cell of entry.deck.cells) colors[cell.code] = zoned[cell.code] ?? stage.color

    const codeById = new Map(entry.deck.cells.map((c) => [c.id, c.code]))
    const zoneRows = zonesHere.map((z) => {
      const codes = z.cellIds.map((id) => codeById.get(id)).filter((c): c is string => !!c)
      const done = codes.filter((c) => !pendingSet.has(c)).length
      return { zone: z, color: colorById[z.id], done, total: codes.length }
    })

    return {
      stage,
      colors,
      pending,
      zones: zoneRows,
      zoneColors: colorById,
      reached: entry.deck.cells.length - pending.length,
      total: entry.deck.cells.length,
    }
  }

  const lensA = lensFor(stageA)
  const lensB = lensFor(stageB)

  /**
   * The ring: how the bays that have been started are spread across the coats.
   *
   * Deliberately not the weighted deck percentage -- that number is already the
   * largest type on the screen, in the header above. This answers the other
   * question: where is the work actually sitting right now.
   */
  const ringSlices = useMemo(() => {
    if (!entry) return []
    return buildStageSlices(entry.deck.totalAreaM2, entry.deck.cells, entry.stages)
      .filter((sl) => sl.areaM2 > 0)
      .map((sl) => ({
        label: sl.label,
        value: entry.deck.totalAreaM2 > 0 ? sl.areaM2 / entry.deck.totalAreaM2 : 0,
        color: sl.color,
      }))
  }, [entry])

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
  const openNote = (code: string) => {
    const cell = entry?.deck.cells.find((c) => c.code === code)
    if (!cell || (cell.note ?? '').trim() === '') return
    setNoteCell(cell)
    setNotes([])
    setNoteError(null)
    setNoteLoading(true)
    listCellNotes(cell.id)
      .then((rows) => setNotes(rows))
      .catch((e) => {
        // The dialog falls back to `cells.note`, which is already in hand and
        // is the note the drawing's flag is showing. Losing the history must
        // not lose the sentence the admin tapped the bay to read.
        setNoteError((e as Error).message)
      })
      .finally(() => setNoteLoading(false))
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

  const setWindow = (stageId: string, field: keyof StageWindow, value: dayjs.Dayjs | null) => {
    setWindows((prev) => ({
      ...prev,
      [stageId]: {
        startDate: prev[stageId]?.startDate ?? null,
        finishDate: prev[stageId]?.finishDate ?? null,
        [field]: value,
      },
    }))
  }

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
        }, cellIds)
      }
      setZoneFormOpen(false)
      setSelectedCodes([])
      setWindows({})
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
  const patchZoneDate = async (
    zone: Zone,
    field: 'startDate' | 'finishDate',
    value: dayjs.Dayjs | null,
  ) => {
    try {
      // null is a value, not "leave alone": it says the date is no longer
      // known, which is how a slipped zone is expressed.
      await updateZone(zone.id, { [field]: value ? value.format('YYYY-MM-DD') : null })
      await refreshZones()
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
  const renderLens = (lens: ReturnType<typeof lensFor>, side: 'A' | 'B') => {
    if (!entry || !lens.stage || !imageUrl) return null
    const pct = lens.total > 0 ? (lens.reached / lens.total) * 100 : 0
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
        <div style={{ padding: '13px 14px' }}>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, letterSpacing: '-0.015em' }}>
            {`Tiến độ · ${lens.stage.name}`}
          </h3>
          <div style={{ fontSize: 12, lineHeight: 1.35, color: palette.textTertiary, marginTop: 4 }}>
            {splitView
              ? (side === 'A' ? 'Lớp bên trái' : 'Lớp bên phải · cùng mức zoom để so sánh')
              : 'Ô tô theo màu zone · ô chưa đạt lớp này có gạch chéo mờ'}
          </div>
        </div>

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
            hatchedCodes={lens.pending}
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
          <div
            style={{
              position: 'absolute',
              zIndex: 3,
              left: 12,
              top: 12,
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
              style={{
                width: 14,
                height: 14,
                borderRadius: 4,
                background: lens.stage.color,
                boxShadow: 'inset 0 0 0 1px #16202B47',
              }}
            />
            <span style={{ fontSize: 12, fontWeight: 600 }}>{lens.stage.name}</span>
            <span style={{ fontSize: 12, fontWeight: 600, color: palette.accent }}>
              {formatPercent(pct / 100)}
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'baseline', gap: 9, padding: '12px 14px 8px' }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: palette.textTertiary }}>
            {`Tiến độ từng zone · ${lens.stage.name}`}
          </span>
          <span style={{ marginLeft: 'auto', fontSize: 12, color: palette.textTertiary }}>
            {`${lens.reached} / ${lens.total} ô`}
          </span>
        </div>

        <div style={{ padding: '0 10px 10px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {lens.zones.length === 0 && (
            <div style={{ padding: '7px 9px', fontSize: 12, color: palette.textTertiary }}>
              Lớp sơn này chưa có zone nào được lên kế hoạch.
            </div>
          )}
          {lens.zones.map((row) => {
            const zonePct = row.total > 0 ? row.done / row.total : 0
            const planned = formatPlanRange(row.zone.startDate, row.zone.finishDate)
            const line = (
              <>
                <span
                  aria-hidden
                  style={{
                    width: 15,
                    height: 15,
                    borderRadius: 5,
                    flex: 'none',
                    background: row.color,
                    boxShadow: 'inset 0 0 0 1px #16202B47',
                  }}
                />
                <span style={{ fontSize: 12, fontWeight: 600, flex: 'none' }}>{row.zone.name}</span>
                <span style={{ fontSize: 11, color: palette.textTertiary, flex: 'none' }}>
                  {`${String(row.done).padStart(2, '0')}/${row.total}`}
                </span>
                <span style={{ flex: 1, minWidth: 24 }}>
                  <ProgressBar ratio={zonePct} color={row.color} height={5} />
                </span>
                <span
                  style={{ fontSize: 12, fontWeight: 600, flex: 'none', minWidth: 44, textAlign: 'right' }}
                >
                  {formatPercent(zonePct)}
                </span>
                <span
                  style={{
                    fontSize: 11,
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
            <Segmented
              size="small"
              value={splitView ? 'split' : 'single'}
              onChange={(v) => setSplitView(v === 'split')}
              options={[
                { value: 'single', label: 'Một lớp' },
                { value: 'split', label: 'So sánh hai lớp' },
              ]}
            />
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
                  fontSize: 12,
                  fontWeight: 600,
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
        <div style={{ padding: '16px 20px 18px' }}>
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

          {entry && entry.imagePath && imageUrl && (
            <>
              <div style={{ display: 'flex', gap: 14, alignItems: 'flex-end', marginBottom: 16 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                  <label
                    htmlFor="lens-a-stage"
                    style={{ fontSize: 11, fontWeight: 600, color: palette.textTertiary }}
                  >
                    {splitView ? 'Lớp bên trái' : 'Lớp sơn đang xem'}
                  </label>
                  <Select
                    id="lens-a-stage"
                    style={{ minWidth: 190 }}
                    value={stageA?.id}
                    onChange={setViewA}
                    options={entry.stages.map((st) => ({ value: st.id, label: st.name }))}
                  />
                </div>
                {splitView && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                    <label
                      htmlFor="lens-b-stage"
                      style={{ fontSize: 11, fontWeight: 600, color: palette.textTertiary }}
                    >
                      Lớp bên phải
                    </label>
                    <Select
                      id="lens-b-stage"
                      style={{ minWidth: 190 }}
                      value={stageB?.id}
                      onChange={setViewB}
                      options={entry.stages.map((st) => ({ value: st.id, label: st.name }))}
                    />
                  </div>
                )}
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
                    <Tooltip
                      title={
                        selectedCodes.length > 0
                          ? 'Gộp các ô đang chọn thành một zone'
                          : 'Chọn ô trên bản vẽ trước — bấm từng ô, hoặc giữ Shift rồi kéo'
                      }
                    >
                      {/* A span, because antd Tooltip cannot anchor a disabled button. */}
                      <span>
                        <Button
                          type="primary"
                          icon={<PlusOutlined aria-hidden />}
                          disabled={selectedCodes.length === 0}
                          onClick={() => {
                            setWindows({})
                            form.resetFields()
                            setZoneFormOpen(true)
                          }}
                        >
                          {`Gộp thành zone (${selectedCodes.length})`}
                        </Button>
                      </span>
                    </Tooltip>
                  </Space>
                )}
              </div>

              {editable && (
                <div style={{ fontSize: 12, color: palette.textTertiary, marginBottom: 12 }}>
                  Giữ Shift rồi kéo trên bản vẽ để quét chọn nhiều ô, hoặc bấm từng ô.
                </div>
              )}

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
                      <div style={{ padding: '13px 15px 12px', borderBottom: `1px solid ${palette.borderSplit}` }}>
                        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, letterSpacing: '-0.015em' }}>
                          Ô đang ở lớp nào
                        </h3>
                        <div style={{ fontSize: 12, lineHeight: 1.4, color: palette.textTertiary, marginTop: 4 }}>
                          Phần diện tích đang dừng ở mỗi lớp, không cộng dồn
                        </div>
                      </div>
                      <div style={{ padding: '18px 15px', display: 'flex', alignItems: 'center', gap: 18 }}>
                        <Donut slices={ringSlices} size={168} thickness={30}>
                          <span style={{ fontSize: 10, fontWeight: 600, color: palette.textTertiary }}>
                            Tiến độ sàn
                          </span>
                          <span
                            style={{
                              fontSize: 24,
                              fontWeight: 700,
                              letterSpacing: '-0.03em',
                              marginTop: 5,
                            }}
                          >
                            {formatPercent(progress?.progress ?? 0)}
                          </span>
                          <span style={{ fontSize: 10, color: palette.textTertiary, marginTop: 3 }}>
                            {`${formatAreaM2(entry.deck.totalAreaM2)} m²`}
                          </span>
                        </Donut>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
                          {ringSlices.map((sl) => (
                            <div
                              key={sl.label}
                              style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}
                            >
                              <span
                                aria-hidden
                                style={{
                                  width: 15,
                                  height: 15,
                                  borderRadius: 5,
                                  flex: 'none',
                                  background: sl.color,
                                  boxShadow: 'inset 0 0 0 1px #16202B47',
                                }}
                              />
                              <span style={{ fontSize: 12, fontWeight: 600, flex: 1, minWidth: 0 }}>
                                {sl.label}
                              </span>
                              <span style={{ fontSize: 12, color: palette.textTertiary, flex: 'none' }}>
                                {formatPercent(sl.value)}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div
                        style={{
                          padding: '12px 15px',
                          borderTop: `1px solid ${palette.borderSplit}`,
                          background: palette.bgSubtle,
                          display: 'flex',
                          alignItems: 'center',
                          gap: 9,
                        }}
                      >
                        <span style={{ fontSize: 12, fontWeight: 500, color: palette.textSecondary }}>
                          Tiến độ sàn
                        </span>
                        <span
                          style={{ marginLeft: 'auto', fontSize: 11, color: palette.textTertiary }}
                        >
                          {`${entry.deck.cells.length} ô`}
                        </span>
                        <span style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.025em' }}>
                          {formatPercent(progress?.progress ?? 0)}
                        </span>
                      </div>
                    </div>
                  )}
              </div>

              <div data-testid="deck-spec" style={{ marginTop: 18 }}>
                <StageSpecTable stages={progress?.stages ?? []} />
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
          <NoteThread notes={notes} current={noteCell?.note} />
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
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {`${stageName(datesFor.stageId)} · ${datesFor.cellIds.length} ô. Để trống nghĩa là chưa lên kế hoạch.`}
            </Typography.Text>
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                <label htmlFor="zone-start" style={{ fontSize: 12, fontWeight: 600, color: palette.textSecondary }}>
                  Bắt đầu
                </label>
                <DatePicker
                  id="zone-start"
                  format="DD/MM/YYYY"
                  placeholder="Chọn ngày"
                  aria-label={`Ngày bắt đầu của ${datesFor.name}`}
                  value={datesFor.startDate ? dayjs(datesFor.startDate) : null}
                  onChange={(v) => void patchZoneDate(datesFor, 'startDate', v)}
                />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                <label htmlFor="zone-finish" style={{ fontSize: 12, fontWeight: 600, color: palette.textSecondary }}>
                  Kết thúc
                </label>
                <DatePicker
                  id="zone-finish"
                  format="DD/MM/YYYY"
                  placeholder="Chọn ngày"
                  aria-label={`Ngày kết thúc của ${datesFor.name}`}
                  value={datesFor.finishDate ? dayjs(datesFor.finishDate) : null}
                  onChange={(v) => void patchZoneDate(datesFor, 'finishDate', v)}
                />
              </div>
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
        consequence="Chỉ kế hoạch bị xoá. Tiến độ GS đã ghi trên các ô vẫn giữ nguyên, và các ô đó quay về trạng thái chưa được lên kế hoạch cho lớp sơn này (ZON-R5)."
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

        <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
          Đặt ngày cho từng công đoạn. Công đoạn để trống nghĩa là chưa lên kế hoạch.
        </Typography.Text>

        <div data-testid="stage-windows">
          <Table
            className="pp-table"
            size="small"
            rowKey="id"
            pagination={false}
            dataSource={entry?.stages ?? []}
            columns={[
              { title: 'Công đoạn', dataIndex: 'name', key: 'name' },
              {
                title: 'Bắt đầu',
                key: 'start',
                render: (_, st: Stage) => (
                  <DatePicker
                    size="small"
                    format="DD/MM/YYYY"
                    aria-label={`Bắt đầu ${st.name}`}
                    value={windows[st.id]?.startDate ?? null}
                    onChange={(v) => setWindow(st.id, 'startDate', v)}
                  />
                ),
              },
              {
                title: 'Kết thúc',
                key: 'finish',
                render: (_, st: Stage) => (
                  <DatePicker
                    size="small"
                    format="DD/MM/YYYY"
                    aria-label={`Kết thúc ${st.name}`}
                    value={windows[st.id]?.finishDate ?? null}
                    onChange={(v) => setWindow(st.id, 'finishDate', v)}
                  />
                ),
              },
            ]}
          />
        </div>
      </Modal>
      )}
    </SectionCard>
  )
}
