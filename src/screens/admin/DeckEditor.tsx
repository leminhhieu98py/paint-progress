import {
  Alert, App, Button, Descriptions, Modal, Space, Typography,
} from 'antd'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AREA_DIVERGENCE_THRESHOLD, areaDivergence, cellReshaped,
  cellsInBox, divergesBeyondThreshold, drawnCell, hasUndeclaredArea, mergeCells, prorateCellAreas,
} from '../../domain/geometry'
import { nameBays, type BayOptions } from '../../domain/bayDetect'
import type { MeshCell, Stage } from '../../domain/types'
import {
  getDrawingUrl, listCells, syncCells,
  updateDeckArea, zoneImpactOf, type DeckRow, type ZoneImpact,
} from '../../lib/decksApi'
import { formatAreaM2, formatPercent } from '../../lib/format'
import { listStages } from '../../lib/projectsApi'
import { DrawingCanvas } from '../../canvas/DrawingCanvas'
import { detectBaysFromImage } from '../../canvas/rgbFromImage'


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

/**
 * A failed round trip, in the admin's language.
 *
 * A dropped connection reaches here as a TypeError carrying the browser's own
 * English -- "Failed to fetch" in Chrome, "Load failed" in Safari,
 * "NetworkError when attempting to fetch resource" in Firefox. Rendering that
 * verbatim told a Vietnamese admin nothing and hid the only thing they can act
 * on: the network, not the deck. Matched on the browsers' markers rather than
 * on the error's type, because postgrest-js and supabase-js both re-wrap the
 * failure before it gets here. Anything unrecognised falls through unchanged
 * rather than being flattened into a generic apology that loses the detail.
 */
function saveErrorInVietnamese(message: string): string {
  if (/failed to fetch|load failed|networkerror|network request failed/i.test(message)) {
    return 'Mất kết nối tới máy chủ. Kiểm tra mạng rồi thử lại.'
  }
  return message
}

/**
 * Refusals from `drawnCell`, in the admin's language. Same rule as
 * mergeErrorInVietnamese: the domain throws in English and stays that way, and
 * both of these are things an admin hits by drawing, not infrastructure
 * failures, so neither may reach them raw.
 */
function drawErrorInVietnamese(message: string): string {
  if (message.includes('too small')) {
    return 'Ô vừa vẽ quá nhỏ. Kéo một khung lớn hơn.'
  }
  if (message.includes('overlaps')) {
    return 'Chỗ đó đã có ô rồi. Chỉ vẽ được vào chỗ còn trống.'
  }
  return message
}

export function DeckEditor({ deck, onSaved }: { deck: DeckRow; onSaved?: () => void }) {
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
  /**
   * The deck's declared area, owned by the screen above.
   *
   * It used to be edited here, and that put it in two places once the deck got
   * a form of its own. Read-only here because every cell area is a share of it:
   * a change has to re-share them, which is the form's job at the moment it
   * writes the new number.
   */
  const totalArea = deck.totalAreaM2
  const [pending, setPending] = useState<PendingEdit | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { message } = App.useApp()

  /**
   * Raises a failure both ways: the Alert holds the detail and stays until it
   * is dismissed, the toast is what actually reaches the admin.
   *
   * The Alert alone was the defect. This screen is as tall as a drawing, the
   * Alert renders at the top of it, and every button that raises one of these
   * messages sits beside the drawing -- measured in the running app at 385px
   * above the top of the viewport while the admin was looking at the deck.
   * A refusal the admin cannot see is indistinguishable from a dead button,
   * and the cells stay on screen either way, because setCells only runs after
   * a write succeeds.
   */
  const fail = (msg: string) => {
    setError(msg)
    message.error(msg)
  }
  const [busy, setBusy] = useState(false)
  /**
   * Whether the last load left this screen holding an incomplete picture of the
   * deck. `load` fetches with Promise.all, so any one failure -- likely enough
   * on a site tether -- leaves `cells` at [] behind the error Alert, and saving
   * from there would write that empty set over the deck's real geometry.
   */
  const [loadFailed, setLoadFailed] = useState(false)
  /** Only for the detect button's own spinner -- distinct from `busy`, which gates the save/delete/merge round trips. */
  const [detecting, setDetecting] = useState(false)
  /**
   * Whether a drag on the drawing adds a bay.
   *
   * Exclusive with `cropping`: both are one drag on the same pixels, and
   * leaving the other listening would make which one fires depend on nothing
   * the admin can see. Not persisted and not a property of the deck -- it is a
   * mode, like crop mode, and it ends when the admin turns it off.
   */
  const [drawingCell, setDrawingCell] = useState(false)
  /**
   * Whether the window's keys belong to this screen.
   *
   * Off until asked for, and that is not politeness. The editor shares its
   * window with the deck-area field -- where Cmd+A means "select this number",
   * the denominator of every percentage the project reports -- and with the
   * browser's own Cmd+S. A screen that took those from the moment it opened
   * would be taking them from an admin who never asked.
   */
  const [shortcuts, setShortcuts] = useState(false)
  /**
   * Cell sets this screen has moved away from, and moved back from.
   *
   * Refs, not state: nothing renders from them, and the key handler has to read
   * the newest values rather than whichever ones its closure captured.
   *
   * Local edits only. A successful save empties both -- see `apply`. Undoing
   * past a write would offer to restore a cell set the database no longer
   * holds, and the admin would have no way to tell that is what they were
   * looking at.
   */
  const past = useRef<MeshCell[][]>([])
  const future = useRef<MeshCell[][]>([])

  const load = useCallback(async () => {
    try {
      const [c, s] = await Promise.all([
        listCells(deck.id),
        listStages(deck.id),
      ])
      setStages(s)
      setCells(c.map(({ code, x, y, w, h, areaM2 }) => ({ code, x, y, w, h, areaM2 })))
      setCellStages(Object.fromEntries(c.map((p) => [p.code, p.stageId])))
      if (deck.imagePath) setImageUrl(await getDrawingUrl(deck.imagePath))
      setLoadFailed(false)
      setError(null)
    } catch (e) {
      setLoadFailed(true)
      setError((e as Error).message)
    }
  }, [deck.id, deck.imagePath])

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



  /**
   * Replaces the cell set and remembers what it replaced, so the edit can be
   * taken back. Every local edit goes through here; the ones that come back
   * from the server do not.
   */
  const commitCells = (next: MeshCell[]) => {
    past.current = [...past.current, cells]
    future.current = []
    setCells(next)
  }

  const undo = () => {
    const previous = past.current.at(-1)
    if (!previous) return
    past.current = past.current.slice(0, -1)
    future.current = [cells, ...future.current]
    setCells(previous)
    // The selection named bays that may not exist in the set being restored.
    setSelected([])
  }

  const redo = () => {
    const next = future.current[0]
    if (!next) return
    future.current = future.current.slice(1)
    past.current = [...past.current, cells]
    setCells(next)
    setSelected([])
  }

  /**
   * Takes the selected bays off the screen, and re-shares the deck's area over
   * what is left.
   *
   * Local, unlike the button of the same name: the admin curating 180 bays
   * deletes a dozen and saves once, and a write per keystroke would also put
   * the zone-and-progress gate in front of them a dozen times. The gate still
   * runs, at the save -- reviewEdit reads every persisted code the new set no
   * longer contains, which is exactly what these deletes took away.
   */
  const deleteSelected = () => {
    if (selected.length === 0) return
    commitCells(prorateCellAreas(totalArea, cells.filter((c) => !selected.includes(c.code))))
    setSelected([])
  }


  /**
   * Adds the bay the admin drew, and re-shares the deck's area across the new
   * set.
   *
   * Re-prorating is not optional: every area here is a share of the deck total,
   * so a bay added without re-sharing leaves the cells summing to more than the
   * deck is, and every percentage the project reports reads low.
   */
  const onCellDraw = (rect: { x: number; y: number; w: number; h: number }) => {
    try {
      const next = [...cells, drawnCell(cells, rect)]
      commitCells(prorateCellAreas(totalArea, next))
      setError(null)
    } catch (e) {
      fail(drawErrorInVietnamese((e as Error).message))
    }
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
  const detectGrid = async (options: BayOptions = {}) => {
    if (!imageUrl) return
    setDetecting(true)
    setError(null)
    try {
      const bays = await detectBaysFromImage(imageUrl, options)
      const mesh = nameBays(bays).map(({ code, x, y, w, h }) => ({ code, x, y, w, h, areaM2: 0 }))
      commitCells(prorateCellAreas(totalArea, mesh))
      setSelected([])
    } catch {
      // The pixel pass and the browser Image load are the only things that can
      // fail here (a broken URL, a CORS-tainted canvas, decode failure). None of
      // that is the admin's to fix by retyping anything, so this is a plain
      // refusal, not a validation message -- and it must say something rather
      // than leave the screen exactly as it was with no sign anything happened.
      fail('Không tự động dò được ô từ bản vẽ này. Kiểm tra lại bản vẽ đã tải lên.')
    } finally {
      setDetecting(false)
    }
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
  const beginMerge = async () => {
    setError(null)
    const chosen = cells.filter((c) => selected.includes(c.code))
    if (chosen.length === 0) return

    setBusy(true)
    try {
      let merged
      try {
        merged = mergeCells(chosen)
      } catch (e) {
        fail(mergeErrorInVietnamese((e as Error).message))
        return
      }
      const next = [...cells.filter((c) => !selected.includes(c.code)), merged]
      // Named from `merged` itself, not from next's last element: the survivor's
      // identity is what the progress-loss warning turns on, and reading it back
      // out of the array only works while this function happens to append it last.
      await reviewEdit('merge', next, {
        // Spec 8.3: the survivor inherits every zone its sources belonged to.
        inheritFrom: { [merged.code]: chosen.map((c) => c.code) },
        survivor: merged.code,
      })
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
      fail(
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
      fail('Không lưu được: chưa khai báo diện tích sàn. Nhập diện tích sàn (m²) trước khi lưu.')
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
      fail(saveErrorInVietnamese((e as Error).message))
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
      await updateDeckArea(deck.id, totalArea, 'prorated')
      await syncCells(deck.id, next, inheritFrom)
      setCells(next)
      // The written set is the new floor: see `past` for why undoing past a
      // write is not offered.
      past.current = []
      future.current = []
      setSelected([])
      onSaved?.()
      setPending(null)
      setError(null)
    } catch (e) {
      fail(saveErrorInVietnamese((e as Error).message))
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



  /**
   * The window's keys, while the admin has handed them over.
   *
   * Re-bound on every render rather than held in refs: the handler reads the
   * cell set and the selection, and a listener registered once would act on
   * whichever ones its closure captured. Binding is cheap; acting on a stale
   * selection is a wrong delete.
   */
  useEffect(() => {
    if (!shortcuts) return
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      const key = e.key.toLowerCase()

      // Save is this screen's wherever the keyboard is. The admin had the
      // deck-area field focused -- the one field on this screen -- and the
      // browser's own save dialog opened over the deck, because the field guard
      // below was handing Cmd+S back. Nobody editing a deck wants the HTML of
      // it saved.
      if (mod && key === 's') {
        // Hands the keys back first: the save opens a dialog on the paths that
        // need confirming, and the dialog's own keyboard is not this screen's.
        setShortcuts(false)
        void reviewEdit('mesh', cells)
        e.preventDefault()
        return
      }

      // Everything else yields to a field that has the keyboard: Cmd+A in the
      // deck-area box means "select this number", and that number is the
      // denominator of every percentage the project reports.
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return
      }
      if (key === 'escape') {
        setSelected([])
      } else if (mod && key === 'a') {
        setSelected(cells.map((c) => c.code))
      } else if (mod && key === 'z') {
        if (e.shiftKey) redo()
        else undo()
      } else if (!mod && key === 'm') {
        // Guarded like the button it replaces: merging awaits two round trips
        // before it can open its dialog, and a second M in that gap starts a
        // second pass over the same selection -- whichever proposal is written
        // second is the one the admin confirmed, and it need not be the one
        // they read.
        if (busy) return
        // The one edit that has to go through the review gate before it can be
        // undone locally: a merge can be refused (a selection that is not a
        // rectangle), and the refusal has to reach the admin as words.
        void beginMerge()
      } else if (!mod && key === 'i') {
        // The mode the admin spends longest in, and the one they leave and
        // come back to most: draw a missing bay, look, draw another.
        setDrawingCell((on) => !on)
      } else if (key === 'delete' || key === 'backspace') {
        deleteSelected()
      } else {
        return
      }
      // Only for the keys actually taken: Cmd+S would open the browser's save
      // dialog over the deck, and Backspace outside a field is Back.
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

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



      <Descriptions size="small" column={2} bordered items={[
        { key: 'cells', label: 'Số ô', children: cells.length },
        { key: 'sum', label: 'Σ diện tích ô (m²)', children: formatAreaM2(sumCellArea) },
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
      <Space wrap align="center">
        <Button loading={detecting} disabled={!imageUrl || shortcuts} onClick={() => void detectGrid()}>
          Dò ô
        </Button>
        {/*
          One button for the whole working session. Off, it is the way in; on,
          it is the way out, and the way out is a save -- there is no third
          state where the admin has been editing and has nowhere to put it.
        */}
        <Button
          type={shortcuts ? 'primary' : 'default'}
          loading={busy}
          onClick={() => {
            if (shortcuts) void reviewEdit('mesh', cells)
            else setShortcuts(true)
          }}
        >
          {shortcuts ? 'Lưu bản vẽ' : 'Bắt đầu thao tác'}
        </Button>
        <Typography.Text>{`${cells.length} ô`}</Typography.Text>
      </Space>

      <Typography.Text type={drawingCell ? 'warning' : 'secondary'}>
        {drawingCell
          ? 'Kéo một khung vào chỗ còn thiếu ô. Cạnh nào gần ô có sẵn sẽ tự dính vào cạnh ô đó. Không vẽ đè lên ô đã có.'
          : 'Dò ô sẽ thay toàn bộ ô đang có. Bấm “Bắt đầu thao tác” rồi dùng phím tắt để sửa.'}
      </Typography.Text>

      {shortcuts && (
        <Descriptions
          size="small"
          column={2}
          bordered
          title="Phím tắt"
          items={[
            { key: 'esc', label: 'Esc', children: 'Bỏ chọn' },
            { key: 'click', label: 'Ctrl/Cmd + bấm ô', children: 'Chọn thêm từng ô' },
            { key: 'band', label: 'Shift + kéo chuột', children: 'Quét chọn cả mảng ô' },
            { key: 'all', label: 'Ctrl/Cmd + A', children: 'Chọn tất cả' },
            { key: 'draw', label: 'I', children: 'Bật/tắt vẽ thêm ô (con trỏ đổi thành dấu +)' },
            { key: 'merge', label: 'M', children: 'Gộp các ô đang chọn' },
            { key: 'del', label: 'Delete / Backspace', children: 'Xoá ô đang chọn (chưa lưu)' },
            { key: 'undo', label: 'Ctrl/Cmd + Z', children: 'Hoàn tác' },
            { key: 'redo', label: 'Ctrl/Cmd + Shift + Z', children: 'Làm lại' },
            { key: 'save', label: 'Ctrl/Cmd + S', children: 'Lưu bản vẽ' },
          ]}
        />
      )}

      {imageUrl && deck.imageW && deck.imageH ? (
        <DrawingCanvas
          imageUrl={imageUrl}
          imageW={deck.imageW}
          imageH={deck.imageH}
          cells={cells}
          selectedCodes={selected}
          cellColors={cellColors}
          onCellDraw={drawingCell ? onCellDraw : undefined}
          // Shift-drag belongs to the same opt-in as the keys: it is the
          // mouse half of the same way of working, and an admin who has not
          // asked for it should not find their drags doing something new.
          onSelectDraw={shortcuts ? (rect) => setSelected(cellsInBox(cells, rect)) : undefined}
          onCellClick={(code, additive) =>
            setSelected((prev) =>
              additive
                ? prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]
                : prev.includes(code) && prev.length === 1 ? [] : [code],
            )
          }
        />
      ) : (
        <Alert type="info" message="Sàn này chưa có bản vẽ. Upload PDF hoặc ảnh trước khi dò ô." />
      )}


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
