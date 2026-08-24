import {
  Alert, Button, Descriptions, Input, InputNumber, Modal, Slider, Space, Table, Typography,
} from 'antd'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { distributeChain, moveGuideOnAxis, parseDimensionChain, type ChainParse } from '../../domain/dimensionChain'
import {
  AREA_DIVERGENCE_THRESHOLD, areaDivergence, buildMeshFromGuides, cellReshaped,
  divergesBeyondThreshold, hasUndeclaredArea, interpolateOffsetMm, mergeCells,
  offsetsFromSpans, prorateCellAreas, spansFromOffsets,
} from '../../domain/geometry'
import { nameBays, type BayOptions } from '../../domain/bayDetect'
import type { Guide, MeshCell, Stage } from '../../domain/types'
import {
  getDrawingUrl, listCells, listGuides, saveGuides, syncCells,
  updateDeckArea, zoneImpactOf, type DeckRow, type ZoneImpact,
} from '../../lib/decksApi'
import { formatAreaM2, formatMm, formatPercent } from '../../lib/format'
import { listStages } from '../../lib/projectsApi'
import { randomUUID } from '../../lib/uuid'
import { DrawingCanvas } from '../../canvas/DrawingCanvas'
import { detectBaysFromImage, DETECT_RENDER_WIDTH } from '../../canvas/rgbFromImage'

/** A guide table row: the guide, its index into the unsorted `guides` array, and the span to the guide before it. */
type AxisRow = Guide & { index: number; spanMm: number }

/** An edit that replaces the deck's cell set, held while the warning is on screen. */
interface PendingEdit {
  kind: EditKind
  cells: MeshCell[]
  impact: ZoneImpact[]
  inheritFrom: Record<string, string[]>
  /** Cells whose recorded progress this edit discards, with the stage name. */
  progressLoss: { code: string; stageName: string }[]
  /**
   * Cells whose code survives this edit, and whose recorded stage therefore
   * survives with it, but whose area moves by more than
   * CELL_RESHAPE_THRESHOLD -- so the stage's "completed" area quietly
   * grows or shrinks onto a different extent than whoever ticked it signed
   * off on.
   */
  reshaped: { code: string; stageName: string; fromAreaM2: number; toAreaM2: number }[]
  /**
   * How many persisted cells this edit removes when it leaves the deck with no
   * cells at all. Zero unless the result set is empty.
   *
   * Wiping a deck's whole geometry is categorically different from editing it,
   * and it is reachable without any of the disclosures above ever firing: a deck
   * with no progress and no zones has nothing for them to report, so "Chọn tất
   * cả" then "Xoá ô đã chọn" used to delete every row with no confirmation at
   * all.
   */
  wipes: number
}

/**
 * The three ways the cell set can change. 'mesh' is a regenerated grid being
 * saved wholesale; it has no selection and no survivor, but it can still drop
 * a zoned or ticked cell, so it goes through the same gate as the other two.
 */
type EditKind = 'delete' | 'merge' | 'mesh'

const EDIT_CONFIRM: Record<EditKind, string> = {
  delete: 'Vẫn xoá',
  merge: 'Vẫn gộp',
  mesh: 'Vẫn lưu',
}

/**
 * The Main Deck's real across-chain, shown as the paste box's placeholder on
 * both axes so the admin sees the expected shape (numbers separated by
 * spaces or line breaks) rather than an empty box. Illustrative only -- it is
 * never read as a value, only displayed until something is typed.
 */
/**
 * Per axis, because the placeholder is read as guidance and a horizontal chain
 * shown above the vertical table teaches the wrong thing. Both are the real
 * Main Deck's own chains, so an admin holding that drawing recognises them.
 */
const CHAIN_PLACEHOLDER: Record<'x' | 'y', string> = {
  x: '2500 9500 14500 14500 9500 7600',
  y: '5500 16000 16000 16000',
}

/** One axis' paste-box state: the raw text, and the last "Xem trước" result for it. */
interface ChainDraft {
  text: string
  preview: ChainParse | null
}

const EMPTY_CHAIN_DRAFT: ChainDraft = { text: '', preview: null }

/**
 * Domain merge errors, in the admin's language.
 *
 * geometry.ts throws in English and stays that way -- it has no business
 * knowing the UI language -- but all four of mergeCells' own errors are
 * routine validation an admin hits by selecting an L-shape or the same cell
 * twice, not infrastructure failures, so they cannot be surfaced raw. Matched
 * on a stable marker rather than the whole sentence so a reworded domain
 * message still translates, and anything unrecognised falls through unchanged
 * so a new domain error is never swallowed.
 *
 * Exported so its one hard-to-reach branch (a duplicate cell in the
 * selection) can be unit tested directly: `cells` and `selected` both hold
 * unique codes by construction under every UI path that reaches mergeCells,
 * so there is no way to drive that branch through the rendered screen.
 */
export function mergeErrorInVietnamese(message: string): string {
  if (message.includes('solid rectangle')) {
    return 'Các ô đã chọn phải ghép thành một hình chữ nhật kín. Bỏ chọn ô lẻ, hoặc chọn thêm ô để bù chỗ trống.'
  }
  if (message.includes('overlapping cells')) {
    return 'Các ô đã chọn bị trùng nhau nên không gộp được. Sinh lại lưới ô rồi chọn lại.'
  }
  if (message.includes('at least two cells')) {
    return 'Cần chọn ít nhất hai ô để gộp.'
  }
  if (message.includes('same cell more than once')) {
    return 'Danh sách ô chọn có ô bị lặp lại. Bỏ chọn rồi chọn lại.'
  }
  return message
}

export function DeckEditor({ deck, onClose }: { deck: DeckRow; onClose: () => void }) {
  /**
   * The guides being edited, each carrying the id it is identified by.
   *
   * The ids are real: `listGuides` supplies the database's own, and a guide the
   * admin adds gets one minted here. They used to be discarded on load and
   * re-invented as array indices on the way into buildMeshFromGuides, which left
   * saveGuides no identity to diff on -- so it deleted every guide for the deck
   * and re-inserted, and a failed insert lost the whole mm chain. See saveGuides.
   */
  const [guides, setGuides] = useState<Guide[]>([])
  const [stages, setStages] = useState<Stage[]>([])
  const [cells, setCells] = useState<MeshCell[]>([])
  /**
   * Recorded stage id per cell code, as last read from the database --
   * `MeshCell` itself carries no stage, so this is the only place that
   * information survives once `cells` is trimmed down to geometry.
   *
   * Not re-derived on every local edit (delete/merge/generateMesh): it is a
   * fact about what is PERSISTED, refreshed only where `cells` is refreshed
   * from the server (load, and the error-recovery re-read in `apply`). A
   * generated mesh deliberately keeps showing a stale entry's colour when its
   * code collides with a persisted one -- that collision is exactly the
   * progress this edit is about to discard, and Task 7 / B2 exist so the
   * admin can see it before confirming.
   */
  const [cellStages, setCellStages] = useState<Record<string, string | null>>({})
  const [selected, setSelected] = useState<string[]>([])
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [totalArea, setTotalArea] = useState(deck.totalAreaM2)
  /**
   * Where the areas currently in `cells` came from -- measured off the guide
   * chain, or pro-rated from the deck total by pixel share.
   *
   * Provenance of the cell set, carried WITH the cell set, decided in
   * generateMesh where the choice is actually made and initialised from the
   * persisted value on load. It used to be re-derived from `hasRealSpans` at
   * save time, which put the areas and their label on different clocks:
   * generate a mesh before typing the mm spans (pro-rated areas), then type
   * them, then save, and the deck recorded `area_source: 'guides'` over cells
   * that were pixel estimates. Pro-rated areas sum to total_area_m2 exactly, so
   * the divergence banner -- the only guard against precisely this -- can never
   * fire, and Phase 4's report has no reason to disclose that its figures are
   * estimates. On Main Deck that reads 50.9% for a deck truly at 48.5%.
   */
  const [areaSource, setAreaSource] = useState<'guides' | 'prorated'>(deck.areaSource)
  const [pending, setPending] = useState<PendingEdit | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  /**
   * Whether the last load left this screen holding an incomplete picture of the
   * deck. `load` fetches with Promise.all, so any one failure -- likely enough
   * on a site tether -- leaves `cells` at [] behind the error Alert, and saving
   * from there would write that empty set over the deck's real geometry.
   */
  const [loadFailed, setLoadFailed] = useState(false)
  /** Each axis' paste-box text and its last preview, kept independent per axis. */
  const [chainDrafts, setChainDrafts] = useState<Record<'x' | 'y', ChainDraft>>({
    x: EMPTY_CHAIN_DRAFT,
    y: EMPTY_CHAIN_DRAFT,
  })
  /**
   * Whether a chain was applied to either axis since the mesh was last
   * (re)generated. The existing cells are untouched by "Áp dụng" -- only the
   * guides change -- so without this note nothing on screen says the mesh is
   * now stale until the admin happens to notice the guide table changed.
   */
  const [chainAppliedNote, setChainAppliedNote] = useState(false)
  /**
   * How wide a hole in a beam to bridge, as a fraction of the image width.
   *
   * The one control detection has left. Beams break wherever the sheet draws
   * something over them -- a symbol bubble, a pedestal outline, a leader line --
   * and an unbridged break is a door between two bays the drawing shows as
   * separate, so raising this finds MORE bays, not fewer. Measured on the
   * customer's sheet: 12px gave 103 bays covering 63% of the deck, 29px gave 123
   * at 66%, 54px gave 145 at 63%, 90px gave 163 at 68%, and 144px gave 220 but
   * began bridging the dimension chain into the deck.
   */
  const [bridge, setBridge] = useState(0.025)
  /** Only for the detect button's own spinner -- distinct from `busy`, which gates the save/delete/merge round trips. */
  const [detecting, setDetecting] = useState(false)
  /**
   * The deck's rectangle on the sheet, normalized 0..1, as drawn by the admin.
   * `null` until they draw one.
   *
   * It bounds the search and walls off a bay whose own outer beam is
   * interrupted -- see detectBays. It is NOT a measurement any more: nothing is
   * scaled to it, so a box dragged loosely costs nothing. Measured on the real
   * sheet, tight, loose and very loose boxes all returned the same 129 bays.
   *
   * Deliberately NOT persisted. It is an input to detection, not a property of
   * the deck: what the deck keeps is the cells detection produced. Re-detecting
   * months later costs one more drag, and a stored crop would be one more
   * thing that can silently go stale against a re-uploaded drawing.
   */
  const [crop, setCrop] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  /** Whether the canvas is waiting for the crop drag right now. */
  const [cropping, setCropping] = useState(false)
  /**
   * Whether clicking a guide deletes it.
   *
   * A mode rather than a plain click-to-delete, because a stray click on a
   * dense grid would silently change the mesh, and rather than a slider,
   * because no single sensitivity is right everywhere on a real deck --
   * secondary steel clears the bar a real beam needs. Be generous with the
   * slider, then click off the few wrong lines.
   */
  const [deletingGuides, setDeletingGuides] = useState(false)

  const load = useCallback(async () => {
    try {
      const [g, c, s] = await Promise.all([
        listGuides(deck.id),
        listCells(deck.id),
        listStages(deck.projectId),
      ])
      setStages(s)
      // Ids kept, not stripped: they are what saveGuides diffs on, so an
      // untouched guide keeps its row instead of being deleted and re-inserted.
      setGuides(g)
      setCells(c.map(({ code, x, y, w, h, areaM2 }) => ({ code, x, y, w, h, areaM2 })))
      setCellStages(Object.fromEntries(c.map((p) => [p.code, p.stageId])))
      if (deck.imagePath) setImageUrl(await getDrawingUrl(deck.imagePath))
      setLoadFailed(false)
      setError(null)
    } catch (e) {
      setLoadFailed(true)
      setError((e as Error).message)
    }
  }, [deck.id, deck.imagePath, deck.projectId])

  useEffect(() => {
    void load()
  }, [load])

  const sumCellArea = useMemo(() => cells.reduce((s, c) => s + c.areaM2, 0), [cells])
  // No cells means nothing to diverge FROM: the divergence of an empty set
  // against a declared area is 100% by arithmetic, which would put a
  // "lệch 100,0%" banner on every deck the admin has not drawn a mesh on yet.
  const diverges = cells.length > 0 && divergesBeyondThreshold(totalArea, cells)
  const divergence = areaDivergence(totalArea, cells)
  const undeclaredArea = hasUndeclaredArea(totalArea, cells)

  /**
   * Stage colour per cell code, fed to DrawingCanvas so the admin can see
   * which cells carry recorded progress while choosing what to select --
   * Task 7 established that a cell keeps its own stage colour underneath the
   * selection overlay; this is what actually supplies it. Not cosmetic: the
   * confirmation gate in reviewEdit warns that an edit will discard recorded
   * progress, and this is the only way to see which cells that would be
   * BEFORE picking a selection, not after.
   */
  const cellColors = useMemo(() => {
    const colors: Record<string, string> = {}
    for (const cell of cells) {
      const stageId = cellStages[cell.code]
      if (!stageId) continue
      const stage = stages.find((s) => s.id === stageId)
      if (stage) colors[cell.code] = stage.color
    }
    return colors
  }, [cells, cellStages, stages])

  /** Guides on one axis, sorted, with the span to the previous one. */
  const axisRows = (axis: 'x' | 'y'): AxisRow[] => {
    const sorted = guides
      .map((g, index) => ({ ...g, index }))
      .filter((g) => g.axis === axis)
      .sort((a, b) => a.pos - b.pos)
    const spans = spansFromOffsets(sorted.map((g) => g.offsetMm))
    return sorted.map((g, i) => ({ ...g, spanMm: spans[i] }))
  }

  /**
   * The admin types spans; offsets are the running sum of them, so editing one
   * span shifts every guide downstream of it. `rowIndex` is the sorted position
   * antd's render(_v, _r, i) hands back, not the index into `guides`.
   */
  const setSpan = (axis: 'x' | 'y', rowIndex: number, spanMm: number) => {
    const rows = axisRows(axis)
    const spans = rows.map((row, i) => (i === rowIndex ? spanMm : row.spanMm))
    const offsets = offsetsFromSpans(rows[0]?.offsetMm ?? 0, spans)
    const nextOffsets = new Map(rows.map((row, i) => [row.index, offsets[i]]))
    setGuides((prev) => prev.map((g, i) => (nextOffsets.has(i) ? { ...g, offsetMm: nextOffsets.get(i)! } : g)))
  }

  /**
   * Whether BOTH axes carry real dimensions. All-zero offsets mean the admin
   * never typed the spans -- usually because the drawing does not print usable
   * ones -- so per-cell areas have to be pro-rated from the deck total instead
   * of measured, and the deck records area_source: 'prorated' so a report can
   * disclose that its figures are estimates.
   *
   * Both axes, not either: a cell's area is spanX × spanY, so a chain typed on
   * one axis only still measures every cell at 0 m² -- and recording that as
   * area_source: 'guides' would present those zeroes as measured fact. A
   * half-filled chain belongs in the prorate fallback.
   *
   * Read ONLY by generateMesh. This is a fact about the guide table right now,
   * not about the cells currently held, so nothing on a save path may consult
   * it: the guides can change after a mesh is generated, and the areas already
   * computed do not change with them.
   */
  /**
   * Which axes carry a real mm chain, and whether BOTH do.
   *
   * Both is the condition for measured areas -- one axis alone would multiply a
   * real span by a pixel ratio. The per-axis flags exist because the banner used
   * to say "no guide carries a mm dimension" whenever this was false, which is
   * plainly untrue once one axis has been filled in: the admin pastes a chain on
   * one axis, the screen tells them nothing has been entered, and they conclude
   * the feature is broken. It reads as a bug and cost real trust.
   */
  const spanAxes = useMemo(() => {
    const typed = (axis: 'x' | 'y') => guides.some((g) => g.axis === axis && g.offsetMm > 0)
    const x = typed('x')
    const y = typed('y')
    return { x, y, both: x && y, neither: !x && !y }
  }, [guides])
  const hasRealSpans = spanAxes.both

  const generateMesh = () => {
    // `guides` carries real ids, so there is nothing to substitute. This used to
    // overwrite every id with the array index -- harmless for the mesh, which
    // reads only axis/pos/offsetMm, but it is why the ids were being thrown away
    // on load in the first place, and why saveGuides had no identity to diff on.
    const mesh = buildMeshFromGuides(guides)
    if (mesh.length === 0) {
      // The brief's own draft used "đường giống dọc/ngang" here ("giống" =
      // "similar to"), which does not mean anything in this context. Every
      // other label in this file calls these lines "guide" (see the table
      // titles below), so this message is corrected to match.
      setError('Cần ít nhất 2 đường guide dọc và 2 đường guide ngang để sinh lưới.')
      return
    }
    // The areas and their provenance are set in the same statement, from the
    // same condition. That is the whole point: they cannot drift apart later.
    const measured = hasRealSpans
    setCells(measured ? mesh : prorateCellAreas(totalArea, mesh))
    setAreaSource(measured ? 'guides' : 'prorated')
    setSelected([])
    setError(null)
    // Regenerating is the "update the cells" step the stale note asks for.
    setChainAppliedNote(false)
  }

  /**
   * Reads the bays out of the drawing inside `region` and makes them the deck's
   * cells, replacing whatever was there.
   *
   * Cells, not guides: a bay is a closed region on the sheet, and the sheet's
   * bays are not the crossings of a grid -- one wide where nothing divides it,
   * three narrow where beams do. There is nothing to generate afterwards, so
   * this sets `cells` and the admin can go straight to curating them.
   *
   * Areas are prorated from the deck total, and `areaSource` says so: a detected
   * bay carries no printed dimension, so its area is its share of the deck's
   * pixels. The banner above says this in as many words.
   *
   * Wrapped in its own busy flag (`detecting`), not `apply`'s `busy`: this
   * touches no persisted data and gates nothing else on screen, so tying it to
   * the same flag would needlessly disable Save/Delete/Merge while a detection
   * that has nothing to do with them is in flight.
   */
  const detectGrid = async (
    region: { x: number; y: number; w: number; h: number },
    options: BayOptions = { closeFraction: bridge },
  ) => {
    if (!imageUrl) return
    setDetecting(true)
    setError(null)
    try {
      const bays = await detectBaysFromImage(imageUrl, region, options)
      const mesh = nameBays(bays).map(({ code, x, y, w, h }) => ({ code, x, y, w, h, areaM2: 0 }))
      setCells(prorateCellAreas(totalArea, mesh))
      setAreaSource('prorated')
      setSelected([])
      setChainAppliedNote(false)
    } catch {
      // The pixel pass and the browser Image load are the only things that can
      // fail here (a broken URL, a CORS-tainted canvas, decode failure). None of
      // that is the admin's to fix by retyping anything, so this is a plain
      // refusal, not a validation message -- and it must say something rather
      // than leave the screen exactly as it was with no sign anything happened.
      setError('Không tự động dò được ô từ bản vẽ này. Hãy kẻ guide thủ công.')
    } finally {
      setDetecting(false)
    }
  }

  /**
   * The crop drag finished: remember the region and STAY in crop mode.
   *
   * Detection deliberately does not run here. Getting the box right takes more
   * than one attempt -- the admin has to see it against the sheet and decide
   * whether the title block and the off-deck structure are outside it -- and
   * detecting on mouse-up replaced the whole guide table on every attempt.
   * Re-dragging replaces the box; "Dò ô trong khung" is what commits it.
   */
  const onCropDraw = (rect: { x: number; y: number; w: number; h: number }) => {
    setCrop(rect)
  }

  /**
   * The bridge slider settled: re-detect at the new value.
   *
   * On settle rather than on every tick, and re-running the whole pass rather
   * than a cached half of it: the pixel work is ~800ms on the customer's sheet,
   * which is fine once per adjustment and useless as a drag preview. Only when
   * a box has been drawn -- there is nothing to detect without one.
   */
  const onBridgeChange = (value: number) => {
    setBridge(value)
    if (crop) void detectGrid(crop, { closeFraction: value })
  }

  /**
   * Parses the axis' current paste-box text and holds the result for the
   * preview to render. Re-running this on the same, unedited text is
   * idempotent -- the preview IS the parse result, not a separate summary of
   * it, so there is nothing for the two to disagree about.
   */
  const previewChain = (axis: 'x' | 'y') => {
    setChainDrafts((prev) => ({
      ...prev,
      [axis]: { ...prev[axis], preview: parseDimensionChain(prev[axis].text) },
    }))
  }

  /**
   * Replaces one axis' guides with distributeChain's placement of the
   * previewed chain, reusing that axis' current edge positions -- so
   * applying a chain does not also relocate guides the admin already placed
   * by hand at the drawing's true edges. Only reachable once `preview.ok`,
   * which the "Áp dụng" button enforces by staying disabled until then: the
   * preview is the only thing standing between a mis-typed separator and a
   * deck whose every percentage is wrong, so nothing may apply straight from
   * the textarea.
   */
  const applyChain = (axis: 'x' | 'y') => {
    const preview = chainDrafts[axis].preview
    if (!preview || !preview.ok) return

    const existing = axisRows(axis)
    const firstPos = existing.length >= 2 ? existing[0].pos : 0
    const lastPos = existing.length >= 2 ? existing[existing.length - 1].pos : 1
    const distributed = distributeChain(preview.spansMm, firstPos, lastPos)

    setGuides((prev) => [
      ...prev.filter((g) => g.axis !== axis),
      ...distributed.map((d) => ({ id: randomUUID(), axis, pos: d.pos, offsetMm: d.offsetMm })),
    ])
    // The applied text is spent -- clearing it (and the preview with it)
    // stops the admin re-applying the same chain a second time by re-reading
    // stale text, and matches the textarea coming back empty on screen.
    setChainDrafts((prev) => ({ ...prev, [axis]: EMPTY_CHAIN_DRAFT }))
    setChainAppliedNote(true)
  }

  /**
   * `busy` is set here for the whole of beginEdit, not just apply(): it
   * awaits two round trips (listCells + zoneImpactOf, inside reviewEdit)
   * before either opening the confirmation dialog or applying directly, and
   * nothing disabled the delete/merge buttons across that gap. A double-tap
   * on a tablet fired two overlapping passes, and whichever one's `pending`
   * write landed second is the proposal the admin actually confirmed --
   * possibly not the one they read. Cleared in `finally` regardless of which
   * branch reviewEdit took: if it opened `pending`, busy should already be
   * back off by the time the dialog is on screen (its own confirmLoading is
   * driven by apply(), not by this); if it went straight to apply(), apply()
   * has already flipped busy off itself by the time this runs, so this is a
   * harmless no-op there.
   */
  const beginEdit = async (kind: 'delete' | 'merge') => {
    setError(null)
    const chosen = cells.filter((c) => selected.includes(c.code))
    if (chosen.length === 0) return

    setBusy(true)
    try {
      let next: MeshCell[]
      let inheritFrom: Record<string, string[]> = {}
      let survivor: string | undefined
      if (kind === 'delete') {
        next = cells.filter((c) => !selected.includes(c.code))
      } else {
        try {
          const merged = mergeCells(chosen)
          next = [...cells.filter((c) => !selected.includes(c.code)), merged]
          // Named from `merged` itself, not from next's last element: the
          // survivor's identity is what the progress-loss warning turns on, and
          // reading it back out of the array only works while this function
          // happens to append it last.
          survivor = merged.code
          // Spec 8.3: the survivor inherits every zone its sources belonged to.
          inheritFrom = { [merged.code]: chosen.map((c) => c.code) }
        } catch (e) {
          setError(mergeErrorInVietnamese((e as Error).message))
          return
        }
      }

      await reviewEdit(kind, next, { inheritFrom, survivor })
    } finally {
      setBusy(false)
    }
  }

  /**
   * The one gate every cell-set replacement goes through: name the zones and
   * the recorded progress this edit would cost, and either apply it or hold it
   * behind the confirmation dialog.
   *
   * The warning is possible precisely BECAUSE cells are matched by code. A
   * regenerated mesh mints no ids and knows nothing about zones, but it reuses
   * R1C1, R1C2, ... -- so its codes collide with persisted cells that a zone
   * plans and a GS has ticked. Comparing the proposal's codes against the
   * persisted ones is what turns "this cell has no id yet" into "this cell is
   * about to take a zoned, ticked cell's place", which is the whole disclosure.
   * Saving a mesh without coming through here would bypass it silently.
   *
   * It is also where the two refusals live. Everything else here discloses and
   * lets the admin decide, because the admin knows things this screen does not;
   * these two are cases where no answer they could give makes the write correct.
   */
  const reviewEdit = async (
    kind: EditKind,
    next: MeshCell[],
    opts: { inheritFrom?: Record<string, string[]>; survivor?: string } = {},
  ) => {
    setError(null)
    const inheritFrom = opts.inheritFrom ?? {}

    // Saving state that is known to be incomplete cannot be right, whatever the
    // admin decides, so this is a refusal and not a disclosure.
    if (loadFailed) {
      setError(
        'Không lưu được: lần tải dữ liệu gần nhất thất bại nên lưới ô trên màn hình có thể '
        + 'chưa đầy đủ. Đóng và mở lại sàn này để tải lại dữ liệu trước khi lưu.',
      )
      return
    }
    // Cells against a zero total: every ratio divides by total_area_m2, so this
    // write cannot produce a correct number no matter what else is right.
    // Judged on `next`, not on what is currently on screen -- clearing the cell
    // set is a legitimate way out of this state.
    if (hasUndeclaredArea(totalArea, next)) {
      setError('Không lưu được: chưa khai báo diện tích sàn. Nhập diện tích sàn (m²) trước khi lưu.')
      return
    }

    try {
      const persisted = await listCells(deck.id)
      // What this edit takes away. A delete or a merge takes the selection; a
      // regenerated mesh has no selection, so it takes every persisted cell
      // whose code the new mesh no longer contains.
      //
      // A merge's survivor is NOT taken away: its code is in nextCodes, so
      // syncCells updates its row in place and it keeps its id, its zone_cells
      // links and its recorded stage. Excluding it here is what stops the gate
      // announcing "Zone 1: R1C1" -- and so crying wolf on the most common
      // authoring operation there is -- over a cell that never leaves its zone.
      const nextCodes = new Set(next.map((c) => c.code))
      const touched = kind === 'mesh'
        ? persisted.filter((p) => !nextCodes.has(p.code))
        : persisted.filter((p) => selected.includes(p.code) && p.code !== opts.survivor)
      const impact = await zoneImpactOf(deck.id, touched.map((p) => p.id))

      // Which of the touched cells carry recorded progress that this edit
      // discards. For a delete or a mesh save that is all of them; for a merge
      // the survivor is already out of `touched`, for the same reason.
      const progressLoss = touched
        .filter((p) => p.stageId)
        .map((p) => ({
          code: p.code,
          stageName: stages.find((s) => s.id === p.stageId)?.name ?? 'không rõ',
        }))

      // Cells whose code survives this edit -- so their recorded stage
      // survives with it, untouched by syncCells -- but whose area moves by
      // more than CELL_RESHAPE_THRESHOLD. That stage's "completed" area
      // then quietly covers a different extent than whoever ticked it
      // inspected, with no other signal that it happened.
      const reshaped = persisted
        .filter((p) => p.stageId && nextCodes.has(p.code))
        .flatMap((p) => {
          const match = next.find((n) => n.code === p.code)
          if (!match || !cellReshaped(p.areaM2, match.areaM2)) return []
          return [{
            code: p.code,
            stageName: stages.find((s) => s.id === p.stageId)?.name ?? 'không rõ',
            fromAreaM2: p.areaM2,
            toAreaM2: match.areaM2,
          }]
        })

      // Leaving the deck with no cells at all. Counted from the persisted set,
      // so a deck that has no cells yet is not accused of losing any -- saving
      // guides and an area before the mesh exists is ordinary work, and a
      // dialog announcing "0 cells will be removed" would be noise.
      const wipes = next.length === 0 ? persisted.length : 0

      if (impact.length > 0 || progressLoss.length > 0 || reshaped.length > 0 || wipes > 0) {
        setPending({ kind, cells: next, impact, inheritFrom, progressLoss, reshaped, wipes })
        return
      }
      await apply(next, inheritFrom)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  /**
   * The one write. Guides, the deck area with its provenance, and the cell set
   * all go down together.
   *
   * They were two buttons, and that window was the defect: `cells.area_m2`,
   * `decks.total_area_m2` and `decks.area_source` have to agree with each other,
   * and two independent saves cannot guarantee that -- whichever one the admin
   * clicks second describes cells the other one wrote.
   *
   * Order is chosen for the half-failed case. `updateDeckArea` goes before
   * `syncCells`, so if the run stops in between, the deck is labelled for cells
   * it does not yet hold (under-claiming accuracy, harmless) rather than holding
   * pro-rated estimates labelled as measured (the defect itself).
   */
  const apply = async (next: MeshCell[], inheritFrom: Record<string, string[]> = {}) => {
    setBusy(true)
    try {
      await saveGuides(deck.id, guides)
      await updateDeckArea(deck.id, totalArea, areaSource)
      await syncCells(deck.id, next, inheritFrom)
      setCells(next)
      setSelected([])
      setPending(null)
      setError(null)
    } catch (e) {
      setError((e as Error).message)
      setPending(null)
      // syncCells is three round trips with no transaction, so a failure can
      // leave the database holding part of the edit: a merge whose upsert
      // widened the survivor and whose delete then failed holds the widened
      // cell AND its source, overlapping, double-counting about 5% of the deck.
      // Re-reading is the cheap half of the fix -- it removes the "screen shows
      // something the database does not hold" half, and makes the remaining
      // overlap visible through the divergence banner instead of hidden behind
      // stale state. THE ATOMICITY GAP IS STILL OPEN: closing it needs a
      // transactional RPC, which is Phase 3 work. Only the cells are re-read,
      // not the guides -- reloading those would throw away the mm chain the
      // admin has typed and not yet managed to save.
      try {
        const fresh = await listCells(deck.id)
        setCells(fresh.map(({ code, x, y, w, h, areaM2 }) => ({ code, x, y, w, h, areaM2 })))
        setCellStages(Object.fromEntries(fresh.map((p) => [p.code, p.stageId])))
      } catch {
        // Now the screen matches neither the database nor a successful read.
        // Refuse the next save rather than let it write this over the deck.
        setLoadFailed(true)
      }
    } finally {
      setBusy(false)
    }
  }

  const guideTable = (axis: 'x' | 'y', title: string) => (
    <Table<AxisRow>
      rowKey="index"
      size="small"
      pagination={false}
      title={() => title}
      dataSource={axisRows(axis)}
      columns={[
        { title: '#', render: (_v, _r, i) => i + 1, width: 50 },
        {
          title: 'Khoảng cách tới đường trước (mm)',
          dataIndex: 'spanMm',
          render: (v: number, _r, i) =>
            i === 0 ? (
              <Typography.Text type="secondary">gốc</Typography.Text>
            ) : (
              <InputNumber
                value={v}
                min={0}
                step={100}
                // A Vietnamese admin types "14500,5". Without this antd parses
                // that as 14500 and every guide downstream of this one -- and
                // every cell area on this axis -- shifts by the lost
                // half-millimetre. The deck-area and stage-weight fields both
                // carry this same fix already, each with this same comment.
                decimalSeparator=","
                onChange={(n) => setSpan(axis, i, n ?? 0)}
              />
            ),
        },
        { title: 'Toạ độ thật (mm)', dataIndex: 'offsetMm', render: (v: number) => formatMm(v) },
        {
          title: '',
          key: 'remove',
          width: 70,
          // row.index, never the rendered position: the table is sorted by pos
          // and `guides` is not, so the two disagree the moment a guide is
          // added anywhere but the far edge -- and deleting by the rendered
          // position would then remove a different guide than the one the
          // admin clicked. A stray guide is not cosmetic: a double-click on a
          // cell adds one at offsetMm 0, which the next mesh turns into a
          // zero-width column of 0 m² cells.
          render: (_v, row) => (
            <Button
              size="small"
              danger
              onClick={() => setGuides((prev) => prev.filter((_, i) => i !== row.index))}
            >
              Xoá
            </Button>
          ),
        },
      ]}
    />
  )

  /**
   * Paste the printed mm chain instead of double-clicking and dragging every
   * guide by hand -- see dimensionChain.ts. The preview is not decoration: it
   * is the only thing standing between a mis-typed separator and a deck whose
   * every percentage is wrong, so "Áp dụng" stays disabled until a preview of
   * the CURRENT text has actually succeeded. Editing the text after a
   * successful preview clears it (see the TextArea's onChange below), so a
   * stale preview can never be applied against different text than it
   * describes.
   */
  const chainPasteBox = (axis: 'x' | 'y') => {
    const preview = chainDrafts[axis].preview

    let previewBody: ReactNode = null
    if (preview && !preview.ok) {
      previewBody = (
        <Alert
          type="error"
          message={`Không đọc được "${preview.badToken}". Mỗi số cách nhau bằng dấu cách hoặc xuống dòng.`}
        />
      )
    } else if (preview && preview.ok) {
      // 0..1 here is purely to read back offsetMm's running sum for display;
      // the pos it also computes is discarded -- applying uses the axis' own
      // edge positions, not 0 and 1. See applyChain.
      const distributed = distributeChain(preview.spansMm, 0, 1)
      previewBody = (
        <div>
          {preview.spansMm.map((span, i) => (
            <div key={i}>
              {formatMm(span)} mm — cộng dồn {formatMm(distributed[i + 1].offsetMm)} mm
            </div>
          ))}
          <div>
            <strong>{`Tổng: ${formatMm(distributed[distributed.length - 1].offsetMm)} mm`}</strong>
          </div>
        </div>
      )
    }

    return (
      <Space direction="vertical" size="small" style={{ width: '100%' }} data-testid={`chain-box-${axis}`}>
        <Input.TextArea
          rows={1}
          placeholder={CHAIN_PLACEHOLDER[axis]}
          value={chainDrafts[axis].text}
          onChange={(e) => {
            const text = e.target.value
            // The preview describes OLD text the moment new text is typed --
            // clearing it here is what keeps "Áp dụng" disabled until the
            // admin re-previews, rather than applying stale spans.
            setChainDrafts((prev) => ({ ...prev, [axis]: { text, preview: null } }))
          }}
        />
        <Space>
          <Button onClick={() => previewChain(axis)}>Xem trước</Button>
          <Button type="primary" disabled={!preview?.ok} onClick={() => applyChain(axis)}>
            Áp dụng
          </Button>
        </Space>
        {previewBody}
      </Space>
    )
  }

  return (
    <Space direction="vertical" style={{ width: '100%' }} size="middle">
      {error && <Alert type="error" message={error} closable onClose={() => setError(null)} />}

      {/*
        Error level, not warning, and not closable: this is not a discrepancy to
        weigh up, it is a deck whose every reported percentage is guaranteed to
        be 0 until the field above it is filled in. The divergence banner cannot
        cover it -- areaDivergence returns 0 for a zero total to avoid dividing
        by zero, which reads as "no divergence" -- and computeProjectProgress
        gives such a deck weight 0, so it also contributes nothing to the project
        rollup. Silently, and permanently.
      */}
      {undeclaredArea && (
        <Alert
          type="error"
          message="Chưa khai báo diện tích sàn. Tiến độ của sàn này sẽ luôn là 0% cho tới khi nhập diện tích."
        />
      )}

      {diverges && (
        <Alert
          type="warning"
          // areaDivergence is signed: positive means the cells under-cover the
          // declared area (thiếu = short), negative means they over-cover it
          // (vượt = exceeds). Naming the direction here means the admin does
          // not have to open the description to know which way to correct.
          message={`Tổng diện tích các ô ${divergence > 0 ? 'thiếu' : 'vượt'} ${formatPercent(Math.abs(divergence))} so với diện tích sàn`}
          description={`Các ô cộng lại ${formatAreaM2(sumCellArea)} m², sàn khai báo ${formatAreaM2(totalArea)} m². Lệch quá ${formatPercent(AREA_DIVERGENCE_THRESHOLD)} thường là do nhập sai khoảng cách guide — nhưng sàn thật vẫn có thể lệch vì có opening hoặc E-house không phải là ô, nên đây chỉ là cảnh báo.`}
        />
      )}

      {/*
        Keyed on the provenance of the cells actually held, not on whether the
        guide table happens to carry mm right now. Those differ exactly when the
        defect this banner warns about is live: pro-rated cells on screen while
        the guides have since been given real spans.
      */}
      {areaSource === 'prorated' && cells.length > 0 && (
        <Alert
          type="info"
          message="Diện tích ô đang được chia theo tỉ lệ, không phải đo thật"
          description={
            spanAxes.neither
              ? 'Chưa có guide nào mang kích thước mm, nên diện tích từng ô được chia từ tổng diện tích sàn theo tỉ lệ pixel.'
              : `Trục ${spanAxes.x ? 'ngang' : 'dọc'} đã có kích thước mm, nhưng trục ${spanAxes.x ? 'dọc' : 'ngang'} thì chưa — cần cả hai trục mới đo được diện tích thật, nên hiện tại diện tích đang chia theo tỉ lệ pixel.`
          }
        />
      )}

      {/*
        Applying a chain replaces guides only -- the cells already on screen
        are untouched until "Sinh lưới ô" regenerates them -- and nothing else
        here says that happened. Closable, and also cleared by generateMesh
        itself once the admin acts on it.
      */}
      {chainAppliedNote && (
        <Alert
          type="info"
          closable
          onClose={() => setChainAppliedNote(false)}
          message={'Đã đổi guide. Bấm "Sinh lưới ô" để cập nhật các ô.'}
        />
      )}

      <Descriptions size="small" column={4} bordered items={[
        { key: 'name', label: 'Sàn', children: `${deck.name} (${deck.code})` },
        { key: 'cells', label: 'Số ô', children: cells.length },
        { key: 'sum', label: 'Σ diện tích ô (m²)', children: formatAreaM2(sumCellArea) },
        {
          key: 'total', label: 'Diện tích sàn (m²)',
          children: (
            <InputNumber
              value={totalArea}
              min={0}
              step={10}
              // A Vietnamese admin types "5258,5". Without this antd parses
              // that as 5258 and the deck silently loses half a square metre
              // from the denominator of every percentage on the project.
              decimalSeparator=","
              onChange={(n) => setTotalArea(n ?? 0)}
            />
          ),
        },
      ]} />

      {/*
        Detect first, hand-tune after: moving either slider replaces every
        guide on screen from the cached profile, so a hand-placed guide does
        not survive a later slider move. The note below says so; nothing here
        stops the admin using it anyway, the same way nothing stops them
        clicking "Sinh lưới ô" over cells they already curated -- both are
        ordinary, reversible authoring actions, not destructive-edit territory
        (see PendingEdit / reviewEdit, which gate deck-level SAVES, not local
        edits to the working guide table).
      */}
      <Space direction="vertical" size="small" style={{ width: '100%' }}>
        <Space wrap align="start">
          {cropping ? (
            <>
              <Button
                type="primary"
                disabled={!crop}
                onClick={() => {
                  if (!crop) return
                  setCropping(false)
                  void detectGrid(crop)
                }}
              >
                Dò ô trong khung
              </Button>
              <Button onClick={() => setCropping(false)}>Huỷ chọn vùng sàn</Button>
            </>
          ) : (
            <>
              <Button loading={detecting} disabled={!imageUrl} onClick={() => setCropping(true)}>
                {crop ? 'Chọn lại vùng sàn' : 'Chọn vùng sàn để dò ô'}
              </Button>
              <Button
                danger={deletingGuides}
                disabled={guides.length === 0}
                onClick={() => setDeletingGuides((on) => !on)}
              >
                {deletingGuides ? 'Tắt xoá đường' : 'Bật xoá đường'}
              </Button>
            </>
          )}
          <Space direction="vertical" size={0} style={{ width: 260 }}>
            <Typography.Text>Nối khe hở dầm</Typography.Text>
            <Slider
              min={0.005}
              max={0.05}
              step={0.005}
              value={bridge}
              disabled={!crop}
              ariaLabelForHandle="Nối khe hở dầm"
              tooltip={{ formatter: (v) => `${Math.round((v ?? 0) * DETECT_RENDER_WIDTH)} px` }}
              // Both handlers: the slider is controlled, so without onChange
              // its value never moves during the gesture and onChangeComplete
              // reports the number it started from.
              onChange={setBridge}
              onChangeComplete={onBridgeChange}
            />
          </Space>
          <Typography.Text>{`${cells.length} ô`}</Typography.Text>
        </Space>
        <Typography.Text type={cropping || deletingGuides ? 'warning' : 'secondary'}>
          {cropping
            ? 'Kéo một khung bao quanh sàn. Không cần chính xác — thừa ra ngoài mép sàn một chút là được — nhưng đừng trùm cả tờ giấy, vì khung tên và hàng kích thước lọt vào sẽ làm hỏng kết quả. Kéo lại bao nhiêu lần cũng được; xong thì bấm “Dò ô trong khung”.'
            : deletingGuides
              ? 'Bấm vào một đường xanh trên bản vẽ để xoá đường đó. Đang bật thì không kéo được đường.'
              : 'Dò ô sẽ thay toàn bộ ô đang có. Kéo thanh “Nối khe hở dầm” lên nếu vài ô bị dính vào nhau, hạ xuống nếu một ô bị chia vụn.'}
        </Typography.Text>
      </Space>

      <Space wrap>
        <Button onClick={generateMesh}>Sinh lưới ô</Button>
        <Button onClick={() => setSelected(cells.map((c) => c.code))}>Chọn tất cả</Button>
        <Button onClick={() => setSelected([])} disabled={selected.length === 0}>Bỏ chọn</Button>
        {/*
          `|| busy`: beginEdit awaits two round trips (listCells,
          zoneImpactOf) before it can even open the confirmation dialog, and
          without this guard nothing stopped a double-tap on a tablet from
          firing two overlapping reviews of the same selection.
        */}
        <Button danger disabled={selected.length === 0 || busy} onClick={() => void beginEdit('delete')}>
          Xoá ô đã chọn
        </Button>
        <Button disabled={selected.length < 2 || busy} onClick={() => void beginEdit('merge')}>
          Gộp ô đã chọn
        </Button>
        {/*
          One save button. There were two -- guides-and-area, and the cell set --
          on the reasoning that replacing the cell set is a separate decision
          needing its own gate. That reasoning was wrong, and this button is the
          correction: the invariant that matters is that cells.area_m2,
          total_area_m2 and area_source agree with each other, and two
          independent saves cannot hold it. Both now go through reviewEdit, so
          the gate is not lost. See `apply` for the write order.
        */}
        <Button type="primary" loading={busy} onClick={() => void reviewEdit('mesh', cells)}>
          Lưu bản vẽ và lưới ô
        </Button>
        <Button onClick={onClose}>Đóng</Button>
      </Space>

      {imageUrl && deck.imageW && deck.imageH ? (
        <DrawingCanvas
          imageUrl={imageUrl}
          imageW={deck.imageW}
          imageH={deck.imageH}
          guides={guides}
          cells={cells}
          selectedCodes={selected}
          cellColors={cellColors}
          cropRect={crop}
          // Only while waiting for the drag: passing it always would leave the
          // canvas permanently unable to drag a guide or select a cell.
          onCropDraw={cropping ? onCropDraw : undefined}
          // Same rule, and the two modes cannot both be on: `cropping` renders
          // its own button pair, so the toggle below is unreachable while it is
          // set, and the canvas ignores guide clicks in crop mode anyway.
          onGuideClick={deletingGuides ? (index) => setGuides((prev) => prev.filter((_g, i) => i !== index)) : undefined}
          // Clamped, never applied raw: a drag moves `pos` and leaves the mm
          // chain alone, so a guide dragged past its neighbour puts pos-order
          // and offset-order in disagreement -- and every area is computed from
          // the offsets in pos-order. See moveGuideClamped for what that costs.
          //
          // Re-railed after the clamp: if the just-clamped guide is now the
          // first or last on its axis, rerailAxisGuides recomputes every
          // INTERIOR guide's pos from the mm chain between the two edges --
          // so dragging only the two edges is enough to place a whole chain.
          // See rerailAxisGuides for its own guards (degenerate chain,
          // interior-only drags, edges out of order).
          // moveGuideOnAxis, not moveGuideClamped-then-rerail: an edge drag must
          // not be stopped by the interior guide next to it, or the chain can
          // never be compressed onto the deck's real extent. See its docblock.
          onGuideMove={(index, pos) => setGuides((prev) => moveGuideOnAxis(prev, index, pos))}
          // Interpolated, not a bare 0: an offset smaller than a real
          // neighbour to its left breaks the mm chain's pos-order
          // monotonicity and produces a negative span -- A6's dragging
          // defect, reached through the other door. See interpolateOffsetMm.
          // The id is minted here, not by the database, so the guide carries its
          // identity from the moment it exists -- saveGuides' upsert keys on it,
          // which makes a new guide an INSERT of a known row rather than
          // something to match up afterwards. See lib/uuid.ts for why this is
          // not a bare crypto.randomUUID() call.
          onGuideAdd={(axis, pos) =>
            setGuides((prev) => [
              ...prev,
              { id: randomUUID(), axis, pos, offsetMm: interpolateOffsetMm(prev, axis, pos) },
            ])
          }
          onCellClick={(code, additive) =>
            setSelected((prev) =>
              additive
                ? prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]
                : prev.includes(code) && prev.length === 1 ? [] : [code],
            )
          }
        />
      ) : (
        <Alert type="info" message="Sàn này chưa có bản vẽ. Upload PDF hoặc ảnh trước khi kẻ guide." />
      )}

      <Space align="start" wrap>
        <Space direction="vertical" size="small">
          {chainPasteBox('x')}
          {guideTable('x', 'Guide dọc (cột)')}
        </Space>
        <Space direction="vertical" size="small">
          {chainPasteBox('y')}
          {guideTable('y', 'Guide ngang (hàng)')}
        </Space>
      </Space>

      {/*
        The dialog can open for any of three independent reasons -- zone
        impact, progress loss, or a reshape -- in any combination, so no
        sentence anywhere in this dialog may make a claim about a list it does
        not own. The title only ever distinguishes zone impact (the one that
        also affects a zone's progress plan) from everything else; the lead
        paragraph states nothing about specific cells; and each section below
        carries its own sentence immediately above its own list, rendering
        only when that list is non-empty. A merge whose survivor's area moves
        by more than AREA_DIVERGENCE_THRESHOLD lands in BOTH the progress-loss
        section (for its discarded sources) and the reshape section (for
        itself) at once -- see R6 in task-8-fix-3 -- so this is not a
        theoretical case to design for.
      */}
      <Modal
        open={pending !== null}
        destroyOnHidden
        title={
          pending &&
          (pending.impact.length > 0
            ? 'Thao tác này ảnh hưởng đến zone'
            // Zone impact still wins the title when both apply: it is the one
            // that reaches outside this deck's geometry into a zone's plan. The
            // wipe still gets its own sentence below either way -- every claim
            // in this dialog is owned by the section that renders it.
            : pending.wipes > 0
              ? 'Xoá toàn bộ lưới ô của sàn'
              : 'Xác nhận thay đổi lưới ô')
        }
        okText={pending ? EDIT_CONFIRM[pending.kind] : undefined}
        cancelText="Huỷ"
        confirmLoading={busy}
        onCancel={() => setPending(null)}
        onOk={() => pending && void apply(pending.cells, pending.inheritFrom)}
      >
        <Typography.Paragraph>
          Kiểm tra các mục dưới đây trước khi xác nhận.
        </Typography.Paragraph>

        {/*
          Unconditional, because it is always true: `apply` writes saveGuides and
          updateDeckArea on every path through this dialog, not only on a mesh
          save. Since A1 collapsed the two save buttons into one, confirming a
          delete or a merge also commits whatever the admin has done to the guide
          table and to the deck-area field -- a guide nudged by accident, or an
          area typed while thinking it over -- with nothing here saying so.

          A conditional version (only when the guides or the area actually
          differ from what was loaded) was rejected: it would need a second
          baseline to diff against, kept in step with the one `cells` already
          has, and a disclosure that is sometimes absent is one more thing to get
          wrong on the dialog whose whole job is to be trusted.
        */}
        <Typography.Paragraph>
          Thao tác này cũng lưu luôn bảng guide và diện tích sàn đang nhập trên
          màn hình — kể cả khi bạn chỉ định xoá hoặc gộp ô.
        </Typography.Paragraph>

        {pending && pending.wipes > 0 && (
          <Typography.Paragraph strong>
            Sau thao tác này sàn sẽ không còn ô nào: {pending.wipes} ô hiện có sẽ bị
            xoá khỏi cơ sở dữ liệu. Muốn kẻ lại lưới thì phải sinh lưới ô mới.
          </Typography.Paragraph>
        )}

        {pending && pending.impact.length > 0 && (
          <>
            <Typography.Paragraph strong>
              Các ô này đang thuộc zone. Xoá hoặc gộp sẽ làm chúng rời khỏi zone:
            </Typography.Paragraph>
            <ul>
              {pending.impact.map((z) => (
                <li key={z.zoneId}>
                  <strong>{z.zoneName}</strong>: {z.cellCodes.join(', ')}
                </li>
              ))}
            </ul>
          </>
        )}

        {pending && pending.progressLoss.length > 0 && (
          <>
            <Typography.Paragraph strong>
              Các ô này sẽ mất tiến độ đã ghi:
            </Typography.Paragraph>
            <ul>
              {pending.progressLoss.map((p) => (
                <li key={p.code}>
                  <strong>{p.code}</strong> — {p.stageName}
                </li>
              ))}
            </ul>
            {pending.kind === 'merge' && (
              <Typography.Paragraph type="secondary">
                Ô sống sót giữ tiến độ của chính nó. Không có cách gộp nào trung
                thực cho phần còn lại: lấy lớp cao nhất thì báo vượt, lấy lớp thấp
                nhất thì bỏ mất công đã làm.
              </Typography.Paragraph>
            )}
          </>
        )}

        {pending && pending.reshaped.length > 0 && (
          <>
            {/*
              R9: structurally unreachable when kind === 'delete' -- a delete
              never changes a surviving cell's geometry (it only removes
              cells), so `reshaped` is always empty on that path and this
              section can never render there. It is reachable, and covered by
              tests, for 'merge' and 'mesh'. Not dead code: kept intentionally.
            */}
            <Typography.Paragraph strong>
              Các ô này giữ tiến độ đã ghi nhưng diện tích thay đổi, nên phần trăm
              hoàn thành sẽ thay đổi theo:
            </Typography.Paragraph>
            <ul>
              {pending.reshaped.map((r) => (
                <li key={r.code}>
                  <strong>{r.code}</strong> — {r.stageName}: {formatAreaM2(r.fromAreaM2)} → {formatAreaM2(r.toAreaM2)} m²
                </li>
              ))}
            </ul>
          </>
        )}
      </Modal>
    </Space>
  )
}
