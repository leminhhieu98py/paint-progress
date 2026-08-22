import {
  Alert, Button, Descriptions, InputNumber, Modal, Space, Table, Typography,
} from 'antd'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AREA_DIVERGENCE_THRESHOLD, areaDivergence, buildMeshFromGuides,
  divergesBeyondThreshold, mergeCells, prorateCellAreas,
} from '../../domain/geometry'
import type { Guide, MeshCell, Stage } from '../../domain/types'
import {
  getDrawingUrl, listCells, listGuides, replaceCells, saveGuides,
  updateDeckArea, zoneImpactOf, type DeckRow, type ZoneImpact,
} from '../../lib/decksApi'
import { listStages } from '../../lib/projectsApi'
import { DrawingCanvas } from './DrawingCanvas'

const area = new Intl.NumberFormat('vi-VN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
type DraftGuide = Omit<Guide, 'id'>

/** Pending destructive edit, held while the warning is on screen. */
interface PendingEdit {
  kind: 'delete' | 'merge'
  cells: MeshCell[]
  impact: ZoneImpact[]
  zoneLinks: Record<string, string[]>
  /** Cells whose recorded progress this edit discards, with the stage name. */
  progressLoss: { code: string; stageName: string }[]
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
  const diverges = divergesBeyondThreshold(totalArea, cells)
  const divergence = areaDivergence(totalArea, cells)

  /** Guides on one axis, sorted, with the span to the previous one. */
  const axisRows = (axis: 'x' | 'y') =>
    guides
      .map((g, index) => ({ ...g, index }))
      .filter((g) => g.axis === axis)
      .sort((a, b) => a.pos - b.pos)
      .map((g, i, all) => ({ ...g, spanMm: i === 0 ? 0 : g.offsetMm - all[i - 1].offsetMm }))

  /** The admin types spans; offsets are the running sum of them. */
  const setSpan = (axis: 'x' | 'y', rowIndex: number, spanMm: number) => {
    const rows = axisRows(axis)
    let running = rows[0]?.offsetMm ?? 0
    const nextOffsets = new Map<number, number>()
    rows.forEach((row, i) => {
      if (i > 0) running += i === rowIndex ? spanMm : row.spanMm
      nextOffsets.set(row.index, i === 0 ? row.offsetMm : running)
    })
    setGuides((prev) => prev.map((g, i) => (nextOffsets.has(i) ? { ...g, offsetMm: nextOffsets.get(i)! } : g)))
  }

  /**
   * Whether any guide carries a real dimension. All-zero offsets mean the admin
   * never typed the spans -- usually because the drawing does not print usable
   * ones -- so per-cell areas have to be pro-rated from the deck total instead
   * of measured, and the deck records area_source: 'prorated' so a report can
   * disclose that its figures are estimates.
   */
  const hasRealSpans = useMemo(() => guides.some((g) => g.offsetMm > 0), [guides])

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
    let zoneLinks: Record<string, string[]> = {}
    if (kind === 'delete') {
      next = cells.filter((c) => !selected.includes(c.code))
    } else {
      try {
        const merged = mergeCells(chosen)
        next = [...cells.filter((c) => !selected.includes(c.code)), merged]
        // Spec 8.3: the survivor inherits every zone its sources belonged to.
        zoneLinks = { [merged.code]: chosen.map((c) => c.code) }
      } catch (e) {
        setError((e as Error).message)
        return
      }
    }

    try {
      // Persisted cells carry ids; a freshly generated mesh does not, and cannot
      // belong to a zone yet, so there is nothing to warn about in that case.
      const persisted = await listCells(deck.id)
      const affectedIds = persisted.filter((p) => selected.includes(p.code)).map((p) => p.id)
      const impact = await zoneImpactOf(deck.id, affectedIds)

      // Which of the touched cells carry recorded progress that this edit
      // discards. For a delete that is all of them; for a merge it is every
      // source except the survivor, whose stage replaceCells carries forward.
      const survivor = kind === 'merge' ? next[next.length - 1]?.code : undefined
      const progressLoss = persisted
        .filter((p) => selected.includes(p.code) && p.stageId && p.code !== survivor)
        .map((p) => ({
          code: p.code,
          stageName: stages.find((s) => s.id === p.stageId)?.name ?? 'không rõ',
        }))

      if (impact.length > 0 || progressLoss.length > 0) {
        setPending({ kind, cells: next, impact, zoneLinks, progressLoss })
        return
      }
      await apply(next, zoneLinks)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const apply = async (next: MeshCell[], zoneLinks: Record<string, string[]> = {}) => {
    setBusy(true)
    try {
      await replaceCells(deck.id, next, zoneLinks)
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
    <Table
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
        { title: 'Toạ độ thật (mm)', dataIndex: 'offsetMm' },
      ]}
    />
  )

  return (
    <Space direction="vertical" style={{ width: '100%' }} size="middle">
      {error && <Alert type="error" message={error} closable onClose={() => setError(null)} />}

      {diverges && (
        <Alert
          type="warning"
          message={`Tổng diện tích các ô lệch ${(Math.abs(divergence) * 100).toFixed(1)}% so với diện tích sàn`}
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
          children: <InputNumber value={totalArea} min={0} step={10} onChange={(n) => setTotalArea(n ?? 0)} />,
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

      <Modal
        open={pending !== null}
        title={pending?.kind === 'delete' ? 'Xoá ô sẽ ảnh hưởng zone' : 'Gộp ô sẽ ảnh hưởng zone'}
        okText={pending?.kind === 'delete' ? 'Vẫn xoá' : 'Vẫn gộp'}
        cancelText="Huỷ"
        confirmLoading={busy}
        onCancel={() => setPending(null)}
        onOk={() => pending && void apply(pending.cells, pending.zoneLinks)}
      >
        <Typography.Paragraph>
          Các ô này đang thuộc zone. Xoá hoặc gộp sẽ làm chúng rời khỏi zone đó, và
          kế hoạch tiến độ của zone sẽ nhỏ lại mà không có cảnh báo nào khác.
        </Typography.Paragraph>
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
            <Typography.Paragraph type="secondary">
              Ô sống sót giữ tiến độ của chính nó. Không có cách gộp nào trung
              thực cho phần còn lại: lấy lớp cao nhất thì báo vượt, lấy lớp thấp
              nhất thì bỏ mất công đã làm.
            </Typography.Paragraph>
          </>
        )}
      </Modal>
    </Space>
  )
}
