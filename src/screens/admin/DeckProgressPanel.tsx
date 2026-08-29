import {
  Alert, App, Button, Card, Col, DatePicker, Form, Input, Modal, Popconfirm,
  Row, Select, Space, Spin, Table, Typography,
} from 'antd'
import dayjs from 'dayjs'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { DrawingCanvas } from '../../canvas/DrawingCanvas'
import { cellsInBox } from '../../domain/geometry'
import {
  codesNotReaching, paintLensColors, scaffoldLensColors, zoneLensColors,
  SCAFFOLD_PENDING_COLOR, ZONE_PALETTE,
} from '../../domain/lens'
import { NOT_STARTED_COLOR, NOT_STARTED_LABEL } from '../../domain/pieSlices'
import { formatPlanRange } from '../../domain/plan'
import { computeDeckProgress } from '../../domain/progress'
import type { Stage, Zone } from '../../domain/types'
import { getDrawingUrl } from '../../lib/decksApi'
import { formatAreaM2 } from '../../lib/format'
import { loadDeckProgress, type DeckProgressEntry } from '../../lib/progressApi'
import {
  createZone, deleteZone, listDeckZones, setZoneActual, updateZone,
} from '../../lib/zonesApi'
import { StageSpecTable } from '../../components/StageSpecTable'

/**
 * What each fill on the canvas above means.
 *
 * Not decoration. Driving the real deck, both lenses were a wall of colour with
 * nothing saying which grey was Coat 2 and which was "nobody has touched this" --
 * and the admin reading it is the person deciding what to pay for.
 */
function ColorKey({
  testId,
  items,
}: {
  testId: string
  items: { color: string; label: string }[]
}) {
  return (
    <Space size="middle" wrap data-testid={testId} style={{ marginTop: 8 }}>
      {items.map((item) => (
        <Space size={6} key={item.label}>
          <span
            aria-hidden
            style={{
              display: 'inline-block',
              width: 12,
              height: 12,
              borderRadius: 2,
              background: item.color,
              border: '1px solid rgba(0,0,0,0.15)',
            }}
          />
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {item.label}
          </Typography.Text>
        </Space>
      ))}
    </Space>
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
   * Which coat the left lens is showing, or null for all of them.
   *
   * Filtering swaps what the lens MEANS. Unfiltered it colours each bay by the
   * coat it has reached, which is the progress question. Filtered it colours by
   * planned group, because the coat is already fixed and painting every bay one
   * constant colour would say nothing -- the question becomes "which group is
   * this bay in, and how does it sit against its neighbours".
   */
  const [stageFilter, setStageFilter] = useState<string | null>(null)
  const [windows, setWindows] = useState<Record<string, StageWindow>>({})
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
  /** The zones of the filtered coat, in seq order -- the order both the marker
   *  numbering and the colour hand-out follow. */
  const filteredZones = useMemo(
    () => (stageFilter ? zones.filter((z) => z.stageId === stageFilter) : zones),
    [zones, stageFilter],
  )

  const paintColors = useMemo(
    () => {
      if (!entry) return {}
      return stageFilter
        ? zoneLensColors(filteredZones, entry.deck.cells)
        : paintLensColors(entry.deck.cells, entry.stages)
    },
    [entry, stageFilter, filteredZones],
  )
  const scaffoldColors = useMemo(
    () => (entry ? scaffoldLensColors(entry.deck.cells, entry.stages) : {}),
    [entry],
  )
  /**
   * The bays the zone lens has to hatch.
   *
   * Only when a coat is being filtered on. Unfiltered, each bay already wears
   * the colour of the coat it has reached, so "done" and "not done" are
   * different fills and a hatch would say nothing the colour does not. Filtered,
   * every bay of a zone wears the same zone colour, and without a second
   * channel the drawing cannot say which of them have actually had that coat --
   * which is the whole question the filtered lens is asked.
   */
  const pendingCodes = useMemo(
    () => (entry && stageFilter ? codesNotReaching(entry.deck.cells, entry.stages, stageFilter) : []),
    [entry, stageFilter],
  )
  /**
   * Per-zone: how many of its bays have reached the filtered coat.
   *
   * The legend used to be a swatch and a name. On a plan whose whole purpose is
   * "is Zone A going to make its date", a colour key that cannot say 32/56 is
   * a colour key nobody has a reason to read.
   */
  const zoneProgress = useMemo(() => {
    if (!entry || !stageFilter) return {}
    const pending = new Set(pendingCodes)
    const codeById = new Map(entry.deck.cells.map((c) => [c.id, c.code]))
    return Object.fromEntries(filteredZones.map((z) => {
      const codes = z.cellIds.map((id) => codeById.get(id)).filter((c): c is string => !!c)
      const done = codes.filter((c) => !pending.has(c)).length
      return [z.id, { done, total: codes.length }]
    }))
  }, [entry, stageFilter, filteredZones, pendingCodes])
  /**
   * Zone id -> colour, from the same list in the same order `zoneLensColors`
   * hands them out, so the swatch in the table and the fill on the drawing are
   * always the same zone.
   *
   * Nothing writes text onto this canvas. It carried a short marker for a
   * while -- `Z1` on every bay of a zone -- and on a two-hundred-bay deck that
   * is two hundred labels over the plan the admin is trying to read. The colour
   * already says which group a bay is in; the table beside it says which group
   * that is. The GS screen still labels bays with the date range, because a
   * foreman has no table to look a colour up in.
   */
  const zoneColors = useMemo(() => Object.fromEntries(
    filteredZones.map((z, i) => [z.id, ZONE_PALETTE[i % ZONE_PALETTE.length]]),
  ), [filteredZones])

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

  return (
    <Space direction="vertical" style={{ width: '100%' }} size="middle">
      {error && <Alert type="error" message={error} closable onClose={() => setError(null)} />}

      {!entry && (
        <Typography.Text type="secondary">Không tải được tiến độ sàn</Typography.Text>
      )}

      {entry && !entry.imagePath && (
        <Typography.Text type="secondary">Sàn này chưa có bản vẽ</Typography.Text>
      )}

      {entry && entry.imagePath && imageUrl && (
        <Row gutter={16}>
          <Col xs={24} lg={12}>
            <Card
              size="small"
              title={stageFilter ? 'Kế hoạch theo zone' : 'Lớp sơn đã đạt'}
              extra={
                <Select
                  size="small"
                  style={{ width: 200 }}
                  value={stageFilter ?? ''}
                  aria-label="Lọc theo lớp sơn"
                  onChange={(v) => setStageFilter(v === '' ? null : v)}
                  options={[
                    { value: '', label: 'Tất cả lớp sơn' },
                    ...entry.stages.map((st) => ({ value: st.id, label: st.name })),
                  ]}
                />
              }
            >
              <div data-testid="paint-lens">
                <DrawingCanvas
                  imageUrl={imageUrl}
                  imageW={entry.imageW ?? 0}
                  imageH={entry.imageH ?? 0}
                  cells={entry.deck.cells}
                  selectedCodes={editable ? selectedCodes : []}
                  cellColors={paintColors}
                  hatchedCodes={pendingCodes}
                  panZoom
                  onCellClick={editable ? ((code) => toggleCell(code)) : undefined}
                  onSelectDraw={editable ? sweep : undefined}
                />
              </div>
              {/* The key follows what the lens is showing. Filtered, the stage
                  colours would name something the canvas is not drawing. */}
              <ColorKey
                testId="paint-legend"
                items={stageFilter
                  ? filteredZones.map((z) => {
                    const p = zoneProgress[z.id] ?? { done: 0, total: 0 }
                    return {
                      color: zoneColors[z.id],
                      // The count travels IN the legend label rather than in a
                      // table below it, so the swatch, the name and the number
                      // are one thing to read.
                      label: `${z.name} · ${p.done}/${p.total}`,
                    }
                  })
                  : [
                    ...entry.stages.map((st) => ({ color: st.color, label: st.name })),
                    { color: NOT_STARTED_COLOR, label: NOT_STARTED_LABEL },
                  ]}
              />
              {stageFilter && (
                <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block' }}>
                  Ô tô theo màu zone · ô có gạch chéo là chưa đạt lớp sơn đang lọc.
                </Typography.Text>
              )}
              {stageFilter && filteredZones.length === 0 && (
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  Lớp sơn này chưa có zone nào được lên kế hoạch.
                </Typography.Text>
              )}
            </Card>
          </Col>
          <Col xs={24} lg={12}>
            <Card size="small" title="Tháo giáo">
              <div data-testid="scaffold-lens">
                <DrawingCanvas
                  imageUrl={imageUrl}
                  imageW={entry.imageW ?? 0}
                  imageH={entry.imageH ?? 0}
                  cells={entry.deck.cells}
                  selectedCodes={[]}
                  cellColors={scaffoldColors}
                  panZoom
                />
              </div>
              <ColorKey
                testId="scaffold-legend"
                items={[
                  {
                    color: entry.stages[entry.stages.length - 1]?.color ?? NOT_STARTED_COLOR,
                    label: 'Đã tháo giáo',
                  },
                  { color: SCAFFOLD_PENDING_COLOR, label: 'Chưa tháo giáo' },
                ]}
              />
            </Card>
          </Col>
        </Row>
      )}

      {entry && (
        <Card size="small" title={`Tiến độ — ${formatAreaM2(entry.deck.totalAreaM2)} m²`}>
          <div data-testid="deck-spec">
            <StageSpecTable stages={progress?.stages ?? []} />
          </div>
        </Card>
      )}

      {entry && (
        <Card
          size="small"
          title="Kế hoạch tháo giàn giáo"
          extra={editable && (
            <Space>
              <Typography.Text type="secondary">
                {selectedCodes.length > 0 ? `${selectedCodes.length} ô đang chọn` : ''}
              </Typography.Text>
              {selectedCodes.length > 0 && (
                <Button onClick={() => setSelectedCodes([])}>Bỏ chọn</Button>
              )}
              <Button
                type="primary"
                disabled={selectedCodes.length === 0}
                onClick={() => setZoneFormOpen(true)}
              >
                Gộp thành zone ({selectedCodes.length})
              </Button>
            </Space>
          )}
        >
          {editable && (
            <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
              Giữ Shift rồi kéo trên bản vẽ để quét chọn nhiều ô, hoặc bấm từng ô.
            </Typography.Text>
          )}

          {zones.length === 0 && (
            <Typography.Text type="secondary">Sàn này chưa có zone nào</Typography.Text>
          )}

          {zones.length > 0 && (
            <div data-testid="zone-table">
              <Table<Zone>
                size="small"
                rowKey="id"
                pagination={false}
                dataSource={zones}
                columns={[
                  {
                    title: 'Màu',
                    key: 'swatch',
                    width: 60,
                    // How a row is matched to the drawing, now that no text is
                    // written on it. Blank for a zone of another coat: it is not
                    // being drawn, so it has no colour to claim.
                    render: (_, z) => (zoneColors[z.id] ? (
                      <span
                        aria-label={`Màu của ${z.name}`}
                        style={{
                          display: 'inline-block',
                          width: 14,
                          height: 14,
                          borderRadius: 2,
                          background: zoneColors[z.id],
                          border: '1px solid rgba(0,0,0,0.15)',
                        }}
                      />
                    ) : null),
                  },
                  { title: 'Zone', dataIndex: 'name', key: 'name' },
                  { title: 'Công đoạn', key: 'stage', render: (_, z) => stageName(z.stageId) },
                  {
                    title: 'Số ô',
                    key: 'cells',
                    align: 'right',
                    render: (_, z) => z.cellIds.length,
                  },
                  {
                    title: 'Bắt đầu',
                    key: 'start',
                    render: (_, z) => (editable ? (
                      <DatePicker
                        size="small"
                        format="DD/MM/YYYY"
                        // aria-label rather than a <label>: the cell has no room
                        // for visible text, and every row needs a name that says
                        // WHICH zone it belongs to.
                        aria-label={`Ngày bắt đầu của ${z.name}`}
                        value={z.startDate ? dayjs(z.startDate) : null}
                        onChange={(v) => void patchZoneDate(z, 'startDate', v)}
                      />
                    ) : (z.startDate ? dayjs(z.startDate).format('DD/MM') : '—')),
                  },
                  {
                    title: 'Kết thúc',
                    key: 'finish',
                    render: (_, z) => (editable ? (
                      <DatePicker
                        size="small"
                        format="DD/MM/YYYY"
                        aria-label={`Ngày kết thúc của ${z.name}`}
                        value={z.finishDate ? dayjs(z.finishDate) : null}
                        onChange={(v) => void patchZoneDate(z, 'finishDate', v)}
                      />
                    ) : (z.finishDate ? dayjs(z.finishDate).format('DD/MM') : '—')),
                  },
                  {
                    title: 'Kế hoạch',
                    key: 'plan',
                    render: (_, z) => formatPlanRange(z.startDate, z.finishDate) || '—',
                  },
                  {
                    title: '',
                    key: 'actions',
                    align: 'right',
                    render: (_, z) => (!editable ? null : (
                      <Space>
                        <Button size="small" onClick={() => void applyZone(z)}>
                          Ghi thực tế
                        </Button>
                        <Popconfirm
                          title="Xoá zone này?"
                          description="Kế hoạch bị xoá, tiến độ đã ghi trên các ô vẫn giữ nguyên."
                          okText="Xoá zone"
                          cancelText="Huỷ"
                          onConfirm={() => void removeZone(z)}
                        >
                          <Button size="small" danger>Xoá</Button>
                        </Popconfirm>
                      </Space>
                    )),
                  },
                ]}
              />
            </div>
          )}
        </Card>
      )}

      {editable && (
      <Modal
        title={`Gộp ${selectedCodes.length} ô thành zone`}
        open={zoneFormOpen}
        onCancel={() => setZoneFormOpen(false)}
        okText="Tạo zone"
        cancelText="Huỷ"
        onOk={() => void submitZones()}
        width={640}
        destroyOnHidden
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
    </Space>
  )
}
