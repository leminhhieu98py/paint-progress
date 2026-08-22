import {
  Alert, Button, Descriptions, InputNumber, Modal, Space, Table, Typography,
} from 'antd'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AREA_DIVERGENCE_THRESHOLD, areaDivergence, buildMeshFromGuides,
  divergesBeyondThreshold, mergeCells, offsetsFromSpans, prorateCellAreas,
  spansFromOffsets,
} from '../../domain/geometry'
import type { Guide, MeshCell, Stage } from '../../domain/types'
import {
  getDrawingUrl, listCells, listGuides, saveGuides, syncCells,
  updateDeckArea, zoneImpactOf, type DeckRow, type ZoneImpact,
} from '../../lib/decksApi'
import { listStages } from '../../lib/projectsApi'
import { DrawingCanvas } from './DrawingCanvas'

const area = new Intl.NumberFormat('vi-VN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const percent = new Intl.NumberFormat('vi-VN', {
  style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1,
})
/** Millimetre coordinates group as 58.100, like every other number on screen. */
const mm = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 })
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
}

/**
 * The three ways the cell set can change. 'mesh' is a regenerated grid being
 * saved wholesale; it has no selection and no survivor, but it can still drop
 * a zoned or ticked cell, so it goes through the same gate as the other two.
 */
type EditKind = 'delete' | 'merge' | 'mesh'

const EDIT_SUBJECT: Record<EditKind, string> = {
  delete: 'Xoá ô',
  merge: 'Gộp ô',
  mesh: 'Lưu lưới ô',
}

const EDIT_CONFIRM: Record<EditKind, string> = {
  delete: 'Vẫn xoá',
  merge: 'Vẫn gộp',
  mesh: 'Vẫn lưu',
}

/**
 * Domain merge errors, in the admin's language.
 *
 * geometry.ts throws in English and stays that way -- it has no business
 * knowing the UI language -- but these three are routine validation an admin
 * hits by selecting an L-shape, not infrastructure failures, so they cannot be
 * surfaced raw. Matched on a stable marker rather than the whole sentence so a
 * reworded domain message still translates, and anything unrecognised falls
 * through unchanged so a new domain error is never swallowed.
 */
function mergeErrorInVietnamese(message: string): string {
  if (message.includes('solid rectangle')) {
    return 'Các ô đã chọn phải ghép thành một hình chữ nhật kín. Bỏ chọn ô lẻ, hoặc chọn thêm ô để bù chỗ trống.'
  }
  if (message.includes('overlapping cells')) {
    return 'Các ô đã chọn bị trùng nhau nên không gộp được. Sinh lại lưới ô rồi chọn lại.'
  }
  if (message.includes('at least two cells')) {
    return 'Cần chọn ít nhất hai ô để gộp.'
  }
  return message
}

export function DeckEditor({ deck, onClose }: { deck: DeckRow; onClose: () => void }) {
  const [guides, setGuides] = useState<DraftGuide[]>([])
  const [stages, setStages] = useState<Stage[]>([])
  const [cells, setCells] = useState<MeshCell[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [totalArea, setTotalArea] = useState(deck.totalAreaM2)
  const [pending, setPending] = useState<PendingEdit | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

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
      if (deck.imagePath) setImageUrl(await getDrawingUrl(deck.imagePath))
      setError(null)
    } catch (e) {
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
    setCells(hasRealSpans ? mesh : prorateCellAreas(totalArea, mesh))
    setSelected([])
    setError(null)
  }

  const beginEdit = async (kind: 'delete' | 'merge') => {
    setError(null)
    const chosen = cells.filter((c) => selected.includes(c.code))
    if (chosen.length === 0) return

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
   */
  const reviewEdit = async (
    kind: EditKind,
    next: MeshCell[],
    opts: { inheritFrom?: Record<string, string[]>; survivor?: string } = {},
  ) => {
    setError(null)
    const inheritFrom = opts.inheritFrom ?? {}
    try {
      const persisted = await listCells(deck.id)
      // What this edit takes away. A delete or a merge takes the selection; a
      // regenerated mesh has no selection, so it takes every persisted cell
      // whose code the new mesh no longer contains.
      const nextCodes = new Set(next.map((c) => c.code))
      const touched = kind === 'mesh'
        ? persisted.filter((p) => !nextCodes.has(p.code))
        : persisted.filter((p) => selected.includes(p.code))
      const impact = await zoneImpactOf(deck.id, touched.map((p) => p.id))

      // Which of the touched cells carry recorded progress that this edit
      // discards. For a delete or a mesh save that is all of them; for a merge
      // it is every source except the survivor, whose row syncCells updates in
      // place and whose stage therefore survives untouched.
      const progressLoss = touched
        .filter((p) => p.stageId && p.code !== opts.survivor)
        .map((p) => ({
          code: p.code,
          stageName: stages.find((s) => s.id === p.stageId)?.name ?? 'không rõ',
        }))

      if (impact.length > 0 || progressLoss.length > 0) {
        setPending({ kind, cells: next, impact, inheritFrom, progressLoss })
        return
      }
      await apply(next, inheritFrom)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const apply = async (next: MeshCell[], inheritFrom: Record<string, string[]> = {}) => {
    setBusy(true)
    try {
      await syncCells(deck.id, next, inheritFrom)
      setCells(next)
      setSelected([])
      setPending(null)
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const persistGuidesAndArea = async () => {
    setBusy(true)
    try {
      await saveGuides(deck.id, guides)
      await updateDeckArea(deck.id, totalArea, hasRealSpans ? 'guides' : 'prorated')
      setError(null)
    } catch (e) {
      setError((e as Error).message)
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
              <InputNumber value={v} min={0} step={100} onChange={(n) => setSpan(axis, i, n ?? 0)} />
            ),
        },
        { title: 'Toạ độ thật (mm)', dataIndex: 'offsetMm', render: (v: number) => mm.format(v) },
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

      {diverges && (
        <Alert
          type="warning"
          message={`Tổng diện tích các ô lệch ${percent.format(Math.abs(divergence))} so với diện tích sàn`}
          description={`Các ô cộng lại ${area.format(sumCellArea)} m², sàn khai báo ${area.format(totalArea)} m². Lệch quá ${AREA_DIVERGENCE_THRESHOLD * 100}% thường là do nhập sai khoảng cách guide — nhưng sàn thật vẫn có thể lệch vì có opening hoặc E-house không phải là ô, nên đây chỉ là cảnh báo.`}
        />
      )}

      {!hasRealSpans && cells.length > 0 && (
        <Alert
          type="info"
          message="Diện tích ô đang được chia theo tỉ lệ, không phải đo thật"
          description="Chưa có guide nào mang kích thước mm, nên diện tích từng ô được chia từ tổng diện tích sàn theo tỉ lệ pixel. Nhập khoảng cách thật vào bảng guide bên dưới để có số đo chính xác."
        />
      )}

      <Descriptions size="small" column={4} bordered items={[
        { key: 'name', label: 'Sàn', children: `${deck.name} (${deck.code})` },
        { key: 'cells', label: 'Số ô', children: cells.length },
        { key: 'sum', label: 'Σ diện tích ô (m²)', children: area.format(sumCellArea) },
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
        <Button danger disabled={selected.length === 0} onClick={() => void beginEdit('delete')}>
          Xoá ô đã chọn
        </Button>
        <Button disabled={selected.length < 2} onClick={() => void beginEdit('merge')}>
          Gộp ô đã chọn
        </Button>
        <Button type="primary" loading={busy} onClick={() => void persistGuidesAndArea()}>
          Lưu guide và diện tích
        </Button>
        {/*
          Two save buttons, deliberately. Guides and the deck area are one
          decision; replacing the persisted cell set is another, and it can drop
          a zoned or ticked cell, so it goes through reviewEdit's gate. Folding
          it into "Lưu guide và diện tích" would bypass that disclosure -- and
          leaving it out entirely (as this screen originally did) means a deck
          needing no delete and no merge can never save its cells at all, while
          the guide offsets and area_source it saves next to them move on
          without them.
        */}
        <Button type="primary" loading={busy} onClick={() => void reviewEdit('mesh', cells)}>
          Lưu lưới ô
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
          onGuideMove={(index, pos) =>
            setGuides((prev) => prev.map((g, i) => (i === index ? { ...g, pos } : g)))
          }
          onGuideAdd={(axis, pos) => setGuides((prev) => [...prev, { axis, pos, offsetMm: 0 }])}
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
        The dialog opens on zone impact OR on progress loss alone, so neither
        the title nor the lead paragraph may assert zone impact unconditionally:
        telling an admin their cells belong to a zone when they do not teaches
        them to skim the one dialog in this screen that must be read.
      */}
      <Modal
        open={pending !== null}
        title={
          pending &&
          (pending.impact.length > 0
            ? `${EDIT_SUBJECT[pending.kind]} sẽ ảnh hưởng zone`
            : `${EDIT_SUBJECT[pending.kind]} sẽ làm mất tiến độ đã ghi`)
        }
        okText={pending ? EDIT_CONFIRM[pending.kind] : undefined}
        cancelText="Huỷ"
        confirmLoading={busy}
        onCancel={() => setPending(null)}
        onOk={() => pending && void apply(pending.cells, pending.inheritFrom)}
      >
        {pending && pending.impact.length > 0 ? (
          <Typography.Paragraph>
            Các ô này đang thuộc zone. Thao tác này sẽ làm chúng rời khỏi zone đó, và
            kế hoạch tiến độ của zone sẽ nhỏ lại mà không có cảnh báo nào khác.
          </Typography.Paragraph>
        ) : (
          <Typography.Paragraph>
            Không có zone nào bị ảnh hưởng. Nhưng thao tác này sẽ xoá tiến độ đã ghi
            của các ô dưới đây.
          </Typography.Paragraph>
        )}
        {pending && pending.impact.length > 0 && (
          <ul>
            {pending.impact.map((z) => (
              <li key={z.zoneId}>
                <strong>{z.zoneName}</strong>: {z.cellCodes.join(', ')}
              </li>
            ))}
          </ul>
        )}

        {pending && pending.progressLoss.length > 0 && (
          <>
            <Typography.Paragraph strong>
              Các ô sau đang có tiến độ đã ghi, và tiến độ đó sẽ bị mất:
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
      </Modal>
    </Space>
  )
}
