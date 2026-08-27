import {
  Alert, App, Button, Card, Col, DatePicker, Form, Input, Modal, Popconfirm,
  Row, Select, Space, Spin, Table, Tabs, Typography,
} from 'antd'
import dayjs from 'dayjs'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { DrawingCanvas } from '../../canvas/DrawingCanvas'
import { paintLensColors, scaffoldLensColors, SCAFFOLD_PENDING_COLOR } from '../../domain/lens'
import { NOT_STARTED_COLOR, NOT_STARTED_LABEL } from '../../domain/pieSlices'
import { computeDeckProgress, computeProjectProgress } from '../../domain/progress'
import { getDrawingUrl } from '../../lib/decksApi'
import { formatAreaM2, formatPercent } from '../../lib/format'
import { loadProjectProgress, type DeckProgressEntry } from '../../lib/progressApi'
import { listProjectNames } from '../../lib/projectsApi'
import { StageSpecTable } from '../gs/StageSpecTable'
import { buildPlanLabels, formatPlanRange } from '../../domain/plan'
import { cellsInBox } from '../../domain/geometry'
import { listDeckZones } from '../../lib/gsApi'
import { createZone, deleteZone, setZoneActual, updateZone } from '../../lib/zonesApi'
import { buildReportWorkbook, reportFileName } from '../../lib/reportXlsx'
import type { Zone } from '../../domain/types'

type ProjectOption = Awaited<ReturnType<typeof listProjectNames>>[number]

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

interface RollupRow {
  key: string
  name: string
  code: string
  share: string
  totalAreaM2: string
  progress: string
}

/**
 * Where the money question gets answered: how far is this project, and which
 * deck is holding it up.
 *
 * Two canvases over one deck, because `cells.stage_id` answers two different
 * questions and reading one for the other is expensive. The left lens colours
 * each bay by the coat it has reached; the right one says only whether the
 * scaffolding is down. A bay at Coat 2 is well along on the left and untouched
 * on the right.
 *
 * Every number on this screen comes from `computeDeckProgress` /
 * `computeProjectProgress`, the pair asserted against the customer's own
 * spreadsheet to 1e-9 (spec §3.3). Nothing is recomputed locally: a second
 * implementation of pᵢ is a second thing that can disagree with the report the
 * client is already reading.
 */
export function ProgressScreen() {
  const [projects, setProjects] = useState<ProjectOption[]>([])
  const [projectId, setProjectId] = useState<string | null>(null)
  const [entries, setEntries] = useState<DeckProgressEntry[]>([])
  const [activeDeckId, setActiveDeckId] = useState<string | null>(null)
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [zones, setZones] = useState<Zone[]>([])
  /** Cell CODES, because that is what DrawingCanvas selects by. Resolved to ids
   *  only at the moment a zone is written -- zone_cells references cells.id,
   *  and two decks can both carry an R1C1. */
  const [selectedCodes, setSelectedCodes] = useState<string[]>([])
  const [zoneFormOpen, setZoneFormOpen] = useState(false)
  const { message } = App.useApp()
  const [form] = Form.useForm()

  useEffect(() => {
    void (async () => {
      try {
        const rows = await listProjectNames()
        setProjects(rows)
        // Seeded once. An explicit later choice must survive a list refresh.
        setProjectId((prev) => prev ?? rows[0]?.id ?? null)
      } catch (e) {
        setError((e as Error).message)
        // Nothing downstream will clear it: the deck load below returns early
        // without a project, and the admin would watch a spinner for ever.
        setLoading(false)
      }
    })()
  }, [])

  const refresh = useCallback(async () => {
    if (!projectId) {
      setEntries([])
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const rows = await loadProjectProgress(projectId)
      setEntries(rows)
      setActiveDeckId(rows[0]?.deck.id ?? null)
      setError(null)
    } catch (e) {
      // The decks are NOT cleared. A failed refresh on a flaky connection is the
      // common case, and blanking the screen takes away numbers that are still
      // correct; the empty state below owns "this project has no decks".
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const active = entries.find((e) => e.deck.id === activeDeckId) ?? null

  /**
   * The signed drawing URL for the open deck.
   *
   * Cleared before each fetch, so a deck change can never leave the previous
   * deck's plan under this deck's bays -- the colours would land on the wrong
   * geometry and look entirely plausible.
   */
  useEffect(() => {
    const path = active?.imagePath
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
  }, [active?.imagePath])

  const deckProgress = useMemo(
    () => (active ? computeDeckProgress(active.deck, active.stages) : null),
    [active],
  )

  const rollup = useMemo(() => computeProjectProgress(entries), [entries])

  const paintColors = useMemo(
    () => (active ? paintLensColors(active.deck.cells, active.stages) : {}),
    [active],
  )
  const scaffoldColors = useMemo(
    () => (active ? scaffoldLensColors(active.deck.cells, active.stages) : {}),
    [active],
  )

  /** The open deck's plan. Re-read after every write so the table, the labels on
   *  the drawing and the database cannot disagree. */
  const refreshZones = useCallback(async (deckId: string) => {
    try {
      setZones(await listDeckZones(deckId))
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])

  useEffect(() => {
    if (!activeDeckId) {
      setZones([])
      return
    }
    // Cleared first: a zone list held across a deck change would annotate this
    // drawing with the previous deck's plan, and every label would look real.
    setZones([])
    setSelectedCodes([])
    void refreshZones(activeDeckId)
  }, [activeDeckId, refreshZones])

  const planLabels = useMemo(
    () => (active ? buildPlanLabels(zones, active.deck.cells) : {}),
    [zones, active],
  )

  const toggleCell = (code: string) => {
    setSelectedCodes((prev) => (
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]
    ))
  }

  const sweep = (rect: { x: number; y: number; w: number; h: number }) => {
    if (!active) return
    // Additive: a band adds to what is already picked, so a zone can be built
    // out of two sweeps across a deck the admin has to scroll.
    const swept = cellsInBox(active.deck.cells, rect)
    setSelectedCodes((prev) => [...new Set([...prev, ...swept])])
  }

  const submitZone = async () => {
    if (!active) return
    const values = await form.validateFields()
    const byCode = new Map(active.deck.cells.map((c) => [c.code, c.id]))
    const cellIds = selectedCodes.map((c) => byCode.get(c)).filter((id): id is string => !!id)
    try {
      await createZone(active.deck.id, {
        name: values.name as string,
        stageId: values.stageId as string,
        // A DatePicker hands back a dayjs; the column is a `date` and every
        // reader treats it as a date-only string. Formatting rather than
        // toISOString: that would render in UTC and shift the day west of
        // Greenwich, which domain/plan.ts already carries a warning about.
        startDate: values.startDate ? dayjs(values.startDate).format('YYYY-MM-DD') : null,
        finishDate: values.finishDate ? dayjs(values.finishDate).format('YYYY-MM-DD') : null,
      }, cellIds)
      setZoneFormOpen(false)
      setSelectedCodes([])
      form.resetFields()
      await refreshZones(active.deck.id)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const applyZone = async (zone: Zone) => {
    if (!active) return
    try {
      const written = await setZoneActual(zone.id, zone.stageId)
      message.success(`Đã ghi ${written} ô`)
      // The percentages on this screen just moved. Leaving them stale is the
      // defect the decks list carried before its editor re-fetched on close.
      await refresh()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  /**
   * One field of one zone, written as it is changed.
   *
   * A patch through `updateZone`, never a delete-and-remake: rebuilding a zone
   * loses its cell membership and takes its plan off the foreman's drawing in
   * between. The plan is re-read afterwards so the labels on the canvas follow
   * the table.
   */
  const patchZoneDate = async (
    zone: Zone,
    field: 'startDate' | 'finishDate',
    value: dayjs.Dayjs | null,
  ) => {
    if (!active) return
    try {
      // null is a value, not "leave alone": it says the date is no longer known,
      // which is how a slipped zone is expressed.
      await updateZone(zone.id, { [field]: value ? value.format('YYYY-MM-DD') : null })
      await refreshZones(active.deck.id)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const removeZone = async (zone: Zone) => {
    if (!active) return
    try {
      await deleteZone(zone.id)
      await refreshZones(active.deck.id)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const [exporting, setExporting] = useState(false)

  /**
   * The XLSX (spec §9), built from EVERY deck of the project.
   *
   * Not from what is on screen: the Overview sheet is the whole job, and
   * exporting whichever tab happened to be open is the shape of a report that
   * quietly under-states it.
   *
   * The zones are fetched here rather than held for every deck all the time.
   * Export is a rare action; a round trip per deck on it is cheaper than a round
   * trip per deck on every screen open.
   */
  const exportReport = async () => {
    if (entries.length === 0) return
    setExporting(true)
    try {
      const decks = await Promise.all(entries.map(async (entry) => ({
        deck: entry.deck,
        stages: entry.stages,
        zones: await listDeckZones(entry.deck.id),
      })))
      const project = projects.find((p) => p.id === projectId)
      const blob = await buildReportWorkbook({
        projectName: project?.name ?? '',
        projectCode: project?.code ?? '',
        decks,
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = reportFileName(project?.code ?? 'export', dayjs().format('YYYY-MM-DD'))
      a.click()
      // Revoked on the next tick, not immediately: Safari has not started the
      // download when click() returns, and a revoked URL gives a silent
      // zero-byte file.
      setTimeout(() => URL.revokeObjectURL(url), 0)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setExporting(false)
    }
  }

  const rollupRows: RollupRow[] = entries.map((entry) => {
    const d = rollup.decks.find((x) => x.deckId === entry.deck.id)
    return {
      key: entry.deck.id,
      name: entry.deck.name,
      code: entry.deck.code,
      share: formatPercent(d?.weight ?? 0),
      totalAreaM2: formatAreaM2(entry.deck.totalAreaM2),
      progress: formatPercent(d?.progress ?? 0),
    }
  })

  return (
    <Space direction="vertical" style={{ width: '100%' }} size="middle">
      {error && <Alert type="error" message={error} closable onClose={() => setError(null)} />}

      <Space>
        <Typography.Title level={4} style={{ margin: 0 }}>
          Tiến độ
        </Typography.Title>
        <Select
          style={{ width: 240 }}
          value={projectId ?? undefined}
          placeholder="Chọn dự án"
          options={projects.map((p) => ({ value: p.id, label: `${p.name} (${p.code})` }))}
          onChange={(v) => setProjectId(v)}
        />
        <Button
          onClick={() => void exportReport()}
          loading={exporting}
          disabled={entries.length === 0}
        >
          Xuất báo cáo
        </Button>
      </Space>

      {loading && <Spin style={{ display: 'block', margin: '12vh auto' }} />}

      {!loading && entries.length === 0 && (
        <Typography.Text type="secondary">Dự án này chưa có sàn nào</Typography.Text>
      )}

      {!loading && entries.length > 0 && (
        <>
          <Tabs
            activeKey={activeDeckId ?? undefined}
            onChange={(k) => setActiveDeckId(k)}
            items={entries.map((e) => ({ key: e.deck.id, label: e.deck.name }))}
          />

          {active && !active.imagePath && (
            <Typography.Text type="secondary">Sàn này chưa có bản vẽ</Typography.Text>
          )}

          {active && active.imagePath && imageUrl && (
            <Row gutter={16}>
              <Col xs={24} lg={12}>
                <Card size="small" title="Lớp sơn đã đạt">
                  <div data-testid="paint-lens">
                    <DrawingCanvas
                      imageUrl={imageUrl}
                      imageW={active.imageW ?? 0}
                      imageH={active.imageH ?? 0}
                      cells={active.deck.cells}
                      selectedCodes={selectedCodes}
                      cellColors={paintColors}
                      planLabels={planLabels}
                      panZoom
                      onCellClick={(code) => toggleCell(code)}
                      onSelectDraw={sweep}
                    />
                  </div>
                  <ColorKey
                    testId="paint-legend"
                    items={[
                      ...active.stages.map((st) => ({ color: st.color, label: st.name })),
                      { color: NOT_STARTED_COLOR, label: NOT_STARTED_LABEL },
                    ]}
                  />
                </Card>
              </Col>
              <Col xs={24} lg={12}>
                <Card size="small" title="Tháo giáo">
                  <div data-testid="scaffold-lens">
                    <DrawingCanvas
                      imageUrl={imageUrl}
                      imageW={active.imageW ?? 0}
                      imageH={active.imageH ?? 0}
                      cells={active.deck.cells}
                      selectedCodes={[]}
                      cellColors={scaffoldColors}
                      panZoom
                    />
                  </div>
                  <ColorKey
                    testId="scaffold-legend"
                    items={[
                      {
                        color: active.stages[active.stages.length - 1]?.color ?? NOT_STARTED_COLOR,
                        label: 'Đã tháo giáo',
                      },
                      { color: SCAFFOLD_PENDING_COLOR, label: 'Chưa tháo giáo' },
                    ]}
                  />
                </Card>
              </Col>
            </Row>
          )}

          {active && (
            <Card
              size="small"
              title={`${active.deck.name} — ${formatAreaM2(active.deck.totalAreaM2)} m²`}
            >
              <div data-testid="deck-spec">
                <StageSpecTable stages={deckProgress?.stages ?? []} />
              </div>
            </Card>
          )}

          {active && (
            <Card
              size="small"
              title="Kế hoạch tháo giàn giáo"
              extra={
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
              }
            >
              <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
                Giữ Shift rồi kéo trên bản vẽ để quét chọn nhiều ô, hoặc bấm từng ô.
              </Typography.Text>

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
                      { title: 'Zone', dataIndex: 'name', key: 'name' },
                      {
                        title: 'Công đoạn',
                        key: 'stage',
                        render: (_, z) =>
                          active.stages.find((st) => st.id === z.stageId)?.name ?? '—',
                      },
                      { title: 'Số ô', key: 'cells', align: 'right', render: (_, z) => z.cellIds.length },
                      {
                        title: 'Bắt đầu',
                        key: 'start',
                        render: (_, z) => (
                          <DatePicker
                            size="small"
                            format="DD/MM/YYYY"
                            // aria-label rather than a <label>: the cell has no
                            // room for visible text, and every row needs a name
                            // that says WHICH zone it belongs to.
                            aria-label={`Ngày bắt đầu của ${z.name}`}
                            value={z.startDate ? dayjs(z.startDate) : null}
                            onChange={(v) => void patchZoneDate(z, 'startDate', v)}
                          />
                        ),
                      },
                      {
                        title: 'Kết thúc',
                        key: 'finish',
                        render: (_, z) => (
                          <DatePicker
                            size="small"
                            format="DD/MM/YYYY"
                            aria-label={`Ngày kết thúc của ${z.name}`}
                            value={z.finishDate ? dayjs(z.finishDate) : null}
                            onChange={(v) => void patchZoneDate(z, 'finishDate', v)}
                          />
                        ),
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
                        render: (_, z) => (
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
                        ),
                      },
                    ]}
                  />
                </div>
              )}
            </Card>
          )}

          <Modal
            title={`Gộp ${selectedCodes.length} ô thành zone`}
            open={zoneFormOpen}
            onCancel={() => setZoneFormOpen(false)}
            okText="Tạo zone"
            cancelText="Huỷ"
            onOk={() => void submitZone()}
            destroyOnHidden
          >
            <Form
              form={form}
              layout="vertical"
              initialValues={{ stageId: active?.stages[active.stages.length - 1]?.id }}
            >
              <Form.Item
                label="Tên zone"
                name="name"
                rules={[{ required: true, message: 'Đặt tên cho zone' }]}
              >
                <Input />
              </Form.Item>
              <Form.Item
                label="Công đoạn"
                name="stageId"
                rules={[{ required: true, message: 'Chọn công đoạn' }]}
              >
                <Select
                  options={(active?.stages ?? []).map((st) => ({ value: st.id, label: st.name }))}
                />
              </Form.Item>
              <Form.Item label="Bắt đầu" name="startDate">
                <DatePicker style={{ width: '100%' }} format="DD/MM/YYYY" />
              </Form.Item>
              <Form.Item label="Kết thúc" name="finishDate">
                <DatePicker style={{ width: '100%' }} format="DD/MM/YYYY" />
              </Form.Item>
            </Form>
          </Modal>

          <Card size="small" title="Toàn dự án">
            <div data-testid="project-rollup">
              <Table<RollupRow>
                size="small"
                pagination={false}
                dataSource={rollupRows}
                columns={[
                  { title: 'Sàn', dataIndex: 'name', key: 'name' },
                  { title: 'Mã', dataIndex: 'code', key: 'code' },
                  { title: 'Tỉ trọng', dataIndex: 'share', key: 'share', align: 'right' },
                  {
                    title: 'Diện tích (m²)',
                    dataIndex: 'totalAreaM2',
                    key: 'totalAreaM2',
                    align: 'right',
                  },
                  { title: 'Tiến độ', dataIndex: 'progress', key: 'progress', align: 'right' },
                ]}
                summary={() => (
                  <Table.Summary.Row>
                    <Table.Summary.Cell index={0} colSpan={4}>
                      <strong>Tổng dự án</strong>
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={4} align="right">
                      <strong>{formatPercent(rollup.progress)}</strong>
                    </Table.Summary.Cell>
                  </Table.Summary.Row>
                )}
              />
            </div>
          </Card>
        </>
      )}
    </Space>
  )
}
