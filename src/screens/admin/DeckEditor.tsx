import {
  Alert, Button, Descriptions, InputNumber, Modal, Space, Table, Typography,
} from 'antd'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AREA_DIVERGENCE_THRESHOLD, areaDivergence, buildMeshFromGuides, cellReshaped,
  divergesBeyondThreshold, hasUndeclaredArea, interpolateOffsetMm, mergeCells,
  moveGuideClamped, offsetsFromSpans, prorateCellAreas, spansFromOffsets,
} from '../../domain/geometry'
import type { Guide, MeshCell, Stage } from '../../domain/types'
import {
  getDrawingUrl, listCells, listGuides, saveGuides, syncCells,
  updateDeckArea, zoneImpactOf, type DeckRow, type ZoneImpact,
} from '../../lib/decksApi'
import { formatAreaM2, formatMm, formatPercent } from '../../lib/format'
import { listStages } from '../../lib/projectsApi'
import { DrawingCanvas } from './DrawingCanvas'

type DraftGuide = Omit<Guide, 'id'>

/** A guide table row: the guide, its index into the unsorted `guides` array, and the span to the guide before it. */
type AxisRow = DraftGuide & { index: number; spanMm: number }

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
  const [guides, setGuides] = useState<DraftGuide[]>([])
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

  const load = useCallback(async () => {
    try {
      const [g, c, s] = await Promise.all([
        listGuides(deck.id),
        listCells(deck.id),
        listStages(deck.projectId),
      ])
      setStages(s)
      setGuides(g.map(({ axis, pos, offsetMm }) => ({ axis, pos, offsetMm })))
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
  const hasRealSpans = useMemo(() => {
    const typed = (axis: 'x' | 'y') => guides.some((g) => g.axis === axis && g.offsetMm > 0)
    return typed('x') && typed('y')
  }, [guides])

  const generateMesh = () => {
    const withIds: Guide[] = guides.map((g, i) => ({ ...g, id: String(i) }))
    const mesh = buildMeshFromGuides(withIds)
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
          description="Chưa có guide nào mang kích thước mm, nên diện tích từng ô được chia từ tổng diện tích sàn theo tỉ lệ pixel. Nhập khoảng cách thật vào bảng guide bên dưới để có số đo chính xác."
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
          // Clamped, never applied raw: a drag moves `pos` and leaves the mm
          // chain alone, so a guide dragged past its neighbour puts pos-order
          // and offset-order in disagreement -- and every area is computed from
          // the offsets in pos-order. See moveGuideClamped for what that costs.
          onGuideMove={(index, pos) => setGuides((prev) => moveGuideClamped(prev, index, pos))}
          // Interpolated, not a bare 0: an offset smaller than a real
          // neighbour to its left breaks the mm chain's pos-order
          // monotonicity and produces a negative span -- A6's dragging
          // defect, reached through the other door. See interpolateOffsetMm.
          onGuideAdd={(axis, pos) =>
            setGuides((prev) => [...prev, { axis, pos, offsetMm: interpolateOffsetMm(prev, axis, pos) }])
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
        {guideTable('x', 'Guide dọc (cột)')}
        {guideTable('y', 'Guide ngang (hàng)')}
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
