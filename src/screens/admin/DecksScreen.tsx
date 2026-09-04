import {
  ArrowRightOutlined, DeleteOutlined, DownloadOutlined, PlusOutlined,
} from '@ant-design/icons'
import { Alert, App, Button, Select, Space, Table, Tooltip, Typography } from 'antd'
import dayjs from 'dayjs'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { renderDeckDrawing, renderDeckPie } from '../../canvas/deckSnapshot'
import { computeProjectProgress, summariseDeck } from '../../domain/progress'
import type { WorkKind } from '../../domain/types'
import { listGsUsers } from '../../lib/adminApi'
import { deleteDeck, getDrawingUrl, listDecks, type DeckRow } from '../../lib/decksApi'
import { formatAreaM2, formatPercent, formatWeight } from '../../lib/format'
import { listDeckEvents, loadProjectModel } from '../../lib/progressApi'
import type { ProjectModel } from '../../lib/workModel'
import { listDeckZones } from '../../lib/zonesApi'
import { listProjectNames } from '../../lib/projectsApi'
import { buildReportWorkbook, reportFileName, type DeckImages } from '../../lib/reportXlsx'
import { NEW_DECK } from '../../config'
import { ConsequenceModal } from '../../components/ConsequenceModal'
import { Donut, type DonutSlice } from '../../components/Donut'
import { EmptyState } from '../../components/EmptyState'
import { PageBody, PageHeader } from '../../components/PageHeader'
import { ProgressBar } from '../../components/ProgressBar'
import { RulesDisclosure } from '../../components/RulesDisclosure'
import { SectionCard } from '../../components/SectionCard'
import { StatusPill } from '../../components/StatusPill'
import { palette } from '../../theme'

interface RollupRow {
  key: string
  name: string
  code: string
  share: string
  totalAreaM2: string
  progress: number
}

/** One work of the project in the table under the decks (DCK-R7). */
interface WorkRow {
  key: string
  name: string
  kind: WorkKind
  weight: string
  counts: boolean
  progress: number
}

const WORK_KIND_LABEL: Record<WorkKind, string> = { bays: 'Theo ô', manual: 'Nhập tay' }

/**
 * Three shades of the one accent, cycled.
 *
 * Deck contributions are parts of a single quantity -- the project's own
 * percentage -- so they belong to one hue. Giving each deck a colour of its own
 * would put a fourth palette on a screen that already carries the stage
 * colours, and would imply the decks differ in kind rather than in size.
 */
const DECK_SHADES = ['#0A8175', '#3AA396', '#6FC2B7']

const RULES = [
  {
    id: 'DCK-R2',
    text: 'Tỉ trọng của sàn là trọng số hiệu dụng: tổng (trọng số công việc × trọng số sàn trong công việc) qua các công việc có tính vào tổng. Cả hai trọng số đặt ở mục Công việc, không nhập ở đây.',
  },
  {
    id: 'DCK-R3',
    text: 'Làm mới thất bại thì số cũ ở lại trên màn hình, không xoá trắng con số ai đó đang đọc.',
  },
  {
    id: 'DCK-R6',
    text: 'Xuất báo cáo dựng bản vẽ lần lượt từng sàn, không song song, và không đưa ra tệp một phần nếu hỏng giữa chừng.',
  },
]

type ProjectOption = Awaited<ReturnType<typeof listProjectNames>>[number]

/**
 * The decks of one project, as a way in and nothing more.
 *
 * Creating a deck and attaching its drawing both used to happen here, in
 * modals over the list. They belong to a deck, and a deck has its own address
 * now: this screen names them and gets out of the way.
 */
export function DecksScreen() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [projects, setProjects] = useState<ProjectOption[]>([])
  const [projectId, setProjectId] = useState<string | null>(null)
  const [decks, setDecks] = useState<DeckRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  /**
   * Every work of the project with its decks, stages and bay states (0024).
   *
   * This is the project-wide half of what used to be `/admin/progress`. The
   * per-deck half moved into the deck's own screen; the rollup and the export
   * are about the PROJECT, and this list is the only screen that has one
   * selected.
   */
  const [model, setModel] = useState<ProjectModel | null>(null)
  const [exporting, setExporting] = useState(false)
  /** The deck whose deletion is being confirmed, and the write in flight. */
  const [removingDeck, setRemovingDeck] = useState<DeckRow | null>(null)
  const [removing, setRemoving] = useState(false)
  const [confirmingExport, setConfirmingExport] = useState(false)
  const { message } = App.useApp()

  useEffect(() => {
    void (async () => {
      try {
        const rows = await listProjectNames()
        setProjects(rows)
        // Only seed the default once: an explicit later choice must not be
        // clobbered if the project list happens to refresh.
        //
        // `?project=` wins when it names a project that still exists. That is
        // how the projects list hands one over, and falling back to the first
        // would quietly show the admin a different project's decks than the row
        // they clicked. An id that no longer resolves -- a bookmark to a
        // deleted project -- falls back rather than showing an empty screen.
        const requested = searchParams.get('project')
        const wanted = rows.some((r) => r.id === requested) ? requested : null
        setProjectId((prev) => prev ?? wanted ?? rows[0]?.id ?? null)
        setError(null)
      } catch (e) {
        setError((e as Error).message)
      }
    })()
    // Read once, on mount: this seeds the initial choice, and re-running it
    // when the admin's own selection rewrites the query string would fight
    // with that selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const refreshDecks = useCallback(async () => {
    // Clear `loading` before returning, not after. It initialises true so the
    // table spins on first paint, and with no project to load -- an empty
    // project list, or listProjects throwing -- nothing downstream would ever
    // turn it off again: the admin gets a spinner forever instead of an empty
    // state. UsersScreen carries a note about the same failure mode.
    if (!projectId) {
      setDecks([])
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      setDecks(await listDecks(projectId))
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    void refreshDecks()
  }, [refreshDecks])

  useEffect(() => {
    if (!projectId) {
      setModel(null)
      return
    }
    let cancelled = false
    // Not cleared first, deliberately: a failed reload leaves the last good
    // rollup on screen rather than blanking a number the admin was reading.
    loadProjectModel(projectId)
      .then((m) => { if (!cancelled) setModel(m) })
      .catch((e) => { if (!cancelled) setError((e as Error).message) })
    return () => { cancelled = true }
  }, [projectId])

  const modelDecks = model?.decks ?? []
  const rollup = useMemo(() => computeProjectProgress(model?.models ?? []), [model])
  /**
   * Each deck across its works: P_d, and the weight it carries in P, which is
   * Σ W·D over the counted bays works it is in -- no longer its m² share. A
   * deck in no work is still listed, at zero, so nothing the project has goes
   * missing from the one screen that lists it.
   */
  const summaries = useMemo(
    () => (model ? model.decks.map((d) => summariseDeck(d.id, model.models)) : []),
    [model],
  )

  const rollupRows: RollupRow[] = modelDecks.map((deck, i) => ({
    key: deck.id,
    name: deck.name,
    code: deck.code,
    share: formatPercent(summaries[i]?.effectiveWeight ?? 0),
    totalAreaM2: formatAreaM2(deck.totalAreaM2),
    progress: summaries[i]?.progress ?? 0,
  }))
  /**
   * Feedback Rv2, item 4: a deck in no counted work weighs nothing in P, and a
   * row that will read 0,00% for ever is noise in the one table that says how
   * the project is going. It is hidden here, not removed: the Sàn list above
   * says what exists, the works table says what counts, and one line under
   * this table says how many rows it is not showing. `totalArea` and the ring
   * are unchanged -- the ring already gets nothing from a zero weight.
   */
  const visibleRollup = rollupRows.filter((_, i) => (summaries[i]?.effectiveWeight ?? 0) > 0)
  const hiddenDecks = rollupRows.length - visibleRollup.length
  const workRows: WorkRow[] = rollup.works.map((w) => ({
    key: w.work.id,
    name: w.work.name,
    kind: w.work.kind,
    weight: formatWeight(w.work.weight),
    counts: w.work.counts,
    progress: w.progress,
  }))
  /** What the decks carry of P; the rest sits in manual works. */
  const effectiveTotal = summaries.reduce((sum, d) => sum + d.effectiveWeight, 0)

  /*
    Each slice is a weight TIMES a progress -- what it actually contributes to
    the project number -- not a progress alone: a deck's effective weight times
    its tổng hợp, then a counted manual work's weight times its figure. The
    slices therefore sum to exactly P, and the ring's empty part is the work
    left. A ring of raw percentages would sum to something meaningless and
    read as though the project were further along.
  */
  const slices: DonutSlice[] = [
    ...modelDecks.map((deck, i) => ({
      label: deck.name,
      value: (summaries[i]?.effectiveWeight ?? 0) * (summaries[i]?.progress ?? 0),
      color: DECK_SHADES[i % DECK_SHADES.length],
    })),
    ...rollup.works
      .filter((w) => w.work.kind === 'manual' && w.work.counts)
      .map((w, i) => ({
        label: w.work.name,
        value: w.work.weight * w.progress,
        color: DECK_SHADES[(modelDecks.length + i) % DECK_SHADES.length],
      })),
  ]
  const totalArea = modelDecks.reduce((sum, d) => sum + d.totalAreaM2, 0)
  const projectName = projects.find((p) => p.id === projectId)?.name ?? ''

  /**
   * Hard delete, behind the typed name (Feedback Rv1, item 1). The row goes
   * with everything under it; the drawing file is cleaned up after, and a
   * file that would not go is reported rather than treated as a failed delete
   * -- see decksApi.deleteDeck for the order and why.
   */
  const removeDeck = async () => {
    if (!removingDeck) return
    setRemoving(true)
    try {
      const { drawingRemoved } = await deleteDeck({
        id: removingDeck.id, imagePath: removingDeck.imagePath,
      })
      setRemovingDeck(null)
      message.success(`Đã xóa sàn ${removingDeck.name}`)
      if (!drawingRemoved) {
        message.warning('Đã xóa, nhưng chưa dọn được file bản vẽ trên kho lưu trữ')
      }
      // Re-read rather than patch: what is shown is what is there. Both
      // lists, because the rollup below the table names the deck too.
      await refreshDecks()
      if (projectId) setModel(await loadProjectModel(projectId))
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setRemoving(false)
    }
  }

  /**
   * The XLSX (spec §9), built from EVERY deck of the project.
   *
   * Zones and pictures are fetched here rather than held all the time: export is
   * a rare action, and a round trip and a canvas decode per deck on a button
   * pressed once a week is cheaper than paying for them on every screen open.
   */
  const exportReport = async () => {
    if (!projectId || !model || modelDecks.length === 0) return
    setConfirmingExport(false)
    setExporting(true)
    try {
      const profiles = await listGsUsers().catch(() => [])
      const userNames = Object.fromEntries(profiles.map((u) => [u.id, u.fullName]))

      // The deck as the first bays work that carries it sees it: the mesh for
      // the plan sheet, and the coats and states the pictures are coloured by.
      // The figures on the sheets come from the whole model, not from this.
      const viewOf = (deckId: string) => {
        for (const m of model.models) {
          if (m.work.kind !== 'bays') continue
          const view = m.decks.find((d) => d.deck.id === deckId)
          if (view) return view
        }
        return null
      }

      const reportDecks = await Promise.all(model.decks.map(async (meta) => {
        const [zones, events] = await Promise.all([
          listDeckZones(meta.id),
          listDeckEvents(meta.id),
        ])
        return {
          deck: {
            id: meta.id, code: meta.code, name: meta.name, totalAreaM2: meta.totalAreaM2,
            cells: viewOf(meta.id)?.deck.cells ?? [],
          },
          areaSource: meta.areaSource,
          userNames,
          zones,
          events,
        }
      }))

      // Sequential: each render decodes a full-size drawing into a canvas, and
      // ten at once on an admin laptop is a spike for no gain.
      const images: Record<string, DeckImages> = {}
      for (const meta of model.decks) {
        const view = viewOf(meta.id)
        const cells = view?.deck.cells ?? []
        const stages = view?.stages ?? []
        const url = meta.imagePath ? await getDrawingUrl(meta.imagePath).catch(() => null) : null
        images[meta.id] = {
          drawingPng: url
            ? await renderDeckDrawing(url, meta.imageW ?? 0, meta.imageH ?? 0, cells, stages)
            : null,
          piePng: renderDeckPie(meta.totalAreaM2, cells, stages),
          // The sheet sizes the picture from this. Excel stretches whatever box
          // it is given, and a fixed one squashed every deck that was not the
          // shape the box assumed.
          drawingAspect:
            meta.imageW && meta.imageH ? meta.imageH / meta.imageW : null,
        }
      }

      const project = projects.find((p) => p.id === projectId)
      const blob = await buildReportWorkbook({
        projectName: project?.name ?? '',
        projectCode: project?.code ?? '',
        works: model.models,
        decks: reportDecks,
        images,
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = reportFileName(project?.code ?? 'export', dayjs().format('YYYY-MM-DD'))
      a.click()
      // Revoked on the next tick: Safari has not started the download when
      // click() returns, and a revoked URL gives a silent zero-byte file.
      setTimeout(() => URL.revokeObjectURL(url), 0)
      message.success('Đã xuất báo cáo')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setExporting(false)
    }
  }

  return (
    <>
      <PageHeader
        title="Sàn"
        subtitle={
          projectName
            ? `${projectName} · rollup và xuất báo cáo ở đây vì cả hai là phạm vi dự án`
            : 'Chọn một dự án để xem các sàn của nó'
        }
        filters={
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            <label
              htmlFor="decks-project"
              style={{ fontSize: 11, fontWeight: 600, color: palette.textTertiary }}
            >
              Dự án
            </label>
            <Select
              id="decks-project"
              style={{ width: 260 }}
              value={projectId ?? undefined}
              placeholder="Chọn dự án"
              options={projects.map((p) => ({ value: p.id, label: `${p.name} (${p.code})` }))}
              onChange={(v) => {
                setProjectId(v)
                // Replace, not push: switching projects is re-aiming the same
                // screen, and Back should leave the decks list rather than walk
                // the admin through every project they looked at.
                setSearchParams({ project: v }, { replace: true })
              }}
            />
          </div>
        }
        extra={
          <Button
            type="primary"
            icon={<PlusOutlined aria-hidden />}
            disabled={!projectId}
            onClick={() => navigate(`${NEW_DECK}?project=${projectId}`)}
          >
            Tạo sàn
          </Button>
        }
      />

      <PageBody>
        {error && <Alert type="error" message={error} closable onClose={() => setError(null)} />}

        <SectionCard bodyPadding={0}>
          <Table<DeckRow>
            className="pp-table"
            rowKey="id"
            loading={loading}
            dataSource={decks}
            pagination={false}
            locale={{
              emptyText: (
                <EmptyState
                  title="Dự án này chưa có sàn nào"
                  description="Xuất báo cáo bị tắt cho tới khi có ít nhất một sàn."
                />
              ),
            }}
            columns={[
              {
                title: 'Tên sàn',
                dataIndex: 'name',
                render: (v: string) => <span style={{ fontWeight: 600 }}>{v}</span>,
              },
              {
                title: 'Mã',
                dataIndex: 'code',
                width: 120,
              },
              { title: 'Số ô', dataIndex: 'cellCount', width: 90, align: 'right' },
              {
                title: 'Diện tích (m²)',
                dataIndex: 'totalAreaM2',
                width: 160,
                align: 'right',
                render: (v: number) => formatAreaM2(v),
              },
              {
                title: 'Bản vẽ',
                key: 'drawing',
                width: 130,
                render: (_v, deck) => (
                  <StatusPill tone={deck.imagePath ? 'ok' : 'warn'}>
                    {deck.imagePath ? 'Đã có' : 'Chưa có'}
                  </StatusPill>
                ),
              },
              {
                title: 'Thao tác',
                key: 'actions',
                width: 140,
                align: 'right',
                render: (_v, deck) => (
                  <Space size={6}>
                    <Tooltip title="Mở sàn">
                      <Button
                        size="small"
                        aria-label="Mở"
                        icon={<ArrowRightOutlined />}
                        onClick={() => navigate(deck.id)}
                      />
                    </Tooltip>
                    <Tooltip title="Xóa sàn">
                      <Button
                        size="small"
                        danger
                        aria-label="Xóa sàn"
                        icon={<DeleteOutlined />}
                        onClick={() => setRemovingDeck(deck)}
                      />
                    </Tooltip>
                  </Space>
                ),
              },
            ]}
          />
        </SectionCard>

        <SectionCard
          title="Tiến độ toàn dự án"
          summary="Tổng theo công việc; mỗi công việc theo các sàn của nó"
          bodyPadding={0}
          footer={<RulesDisclosure rules={RULES} />}
          extra={
            <Tooltip title={modelDecks.length === 0 ? 'Cần ít nhất một sàn' : 'Xuất báo cáo · .xlsx'}>
              <Button
                icon={<DownloadOutlined aria-hidden />}
                onClick={() => setConfirmingExport(true)}
                loading={exporting}
                disabled={modelDecks.length === 0}
              >
                Xuất báo cáo
              </Button>
            </Tooltip>
          }
        >
          {modelDecks.length === 0 ? (
            <EmptyState
              title="Dự án này chưa có sàn nào"
              description="Rollup và báo cáo đều tính từ các sàn, nên cả hai chờ sàn đầu tiên."
            />
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(300px, 340px)' }}>
              {/*
                The table and the ring get separate ids. Every deck name appears
                in both, so one id over the pair makes a scoped query ambiguous
                -- and a test that cannot say which half it is reading is a test
                that passes when one half is empty.
              */}
              <div style={{ borderRight: `1px solid ${palette.borderCard}`, minWidth: 0 }}>
                <div data-testid="project-rollup">
                <Table<RollupRow>
                  className="pp-table"
                  size="small"
                  pagination={false}
                  dataSource={visibleRollup}
                  columns={[
                    { title: 'Sàn', dataIndex: 'name', key: 'name' },
                    {
                      title: 'Mã',
                      dataIndex: 'code',
                      key: 'code',
                      width: 100,
                    },
                    { title: 'Tỉ trọng', dataIndex: 'share', key: 'share', width: 110, align: 'right' },
                    {
                      title: 'Diện tích (m²)',
                      dataIndex: 'totalAreaM2',
                      key: 'totalAreaM2',
                      width: 150,
                      align: 'right',
                    },
                    {
                      title: 'Tiến độ',
                      dataIndex: 'progress',
                      key: 'progress',
                      width: 220,
                      render: (v: number) => <ProgressBar ratio={v} />,
                    },
                  ]}
                  summary={() => (
                    <Table.Summary.Row>
                      <Table.Summary.Cell index={0}>
                        <strong>Tổng dự án</strong>
                      </Table.Summary.Cell>
                      <Table.Summary.Cell index={1} />
                      <Table.Summary.Cell index={2} align="right">
                        <strong>{formatPercent(effectiveTotal)}</strong>
                      </Table.Summary.Cell>
                      <Table.Summary.Cell index={3} align="right">
                        <strong>{formatAreaM2(totalArea)}</strong>
                      </Table.Summary.Cell>
                      <Table.Summary.Cell index={4}>
                        <ProgressBar ratio={rollup.progress} height={8} />
                      </Table.Summary.Cell>
                    </Table.Summary.Row>
                  )}
                />
                {hiddenDecks > 0 && (
                  <Typography.Text
                    type="secondary"
                    style={{ display: 'block', fontSize: 12, padding: '8px 12px 10px' }}
                  >
                    {`Đã ẩn ${hiddenDecks} sàn có tỉ trọng 0,00% (không thuộc công việc nào tính vào tổng)`}
                  </Typography.Text>
                )}
                </div>

                {/*
                  The works, because the deck weights above are a product of
                  theirs and P is a sum over them: a manual work (giấy tờ, xà
                  lan) shows up nowhere else on this screen, yet it is in P.
                */}
                <div
                  data-testid="project-works"
                  style={{ borderTop: `1px solid ${palette.borderCard}` }}
                >
                  <div style={{ padding: '12px 15px 2px', fontSize: 12, fontWeight: 600, color: palette.textTertiary }}>
                    Công việc
                  </div>
                  <Table<WorkRow>
                    className="pp-table"
                    size="small"
                    pagination={false}
                    dataSource={workRows}
                    columns={[
                      { title: 'Công việc', dataIndex: 'name', key: 'name' },
                      {
                        title: 'Loại',
                        dataIndex: 'kind',
                        key: 'kind',
                        width: 100,
                        render: (k: WorkKind) => WORK_KIND_LABEL[k],
                      },
                      { title: 'Trọng số', dataIndex: 'weight', key: 'weight', width: 110, align: 'right' },
                      {
                        title: 'Tính vào tổng',
                        dataIndex: 'counts',
                        key: 'counts',
                        width: 150,
                        render: (c: boolean) => (c ? 'Có' : 'Không'),
                      },
                      {
                        title: 'Tiến độ',
                        dataIndex: 'progress',
                        key: 'progress',
                        width: 220,
                        render: (v: number) => <ProgressBar ratio={v} />,
                      },
                    ]}
                    summary={() => (
                      <Table.Summary.Row>
                        <Table.Summary.Cell index={0}>
                          <strong>Tổng dự án</strong>
                        </Table.Summary.Cell>
                        <Table.Summary.Cell index={1} />
                        <Table.Summary.Cell index={2} align="right">
                          <strong>
                            {formatWeight(rollup.works
                              .filter((w) => w.work.counts)
                              .reduce((sum, w) => sum + w.work.weight, 0))}
                          </strong>
                        </Table.Summary.Cell>
                        <Table.Summary.Cell index={3} />
                        <Table.Summary.Cell index={4}>
                          <ProgressBar ratio={rollup.progress} height={8} />
                        </Table.Summary.Cell>
                      </Table.Summary.Row>
                    )}
                  />
                </div>
              </div>

              <div
                data-testid="rollup-donut"
                style={{ padding: '18px 20px 20px', background: palette.bgSubtle }}
              >
                <div style={{ fontSize: 12, fontWeight: 600, color: palette.textTertiary }}>
                  Tiến độ dự án
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 14 }}>
                  <Donut slices={slices}>
                    <span style={{ fontSize: 21, fontWeight: 700, letterSpacing: '-0.028em' }}>
                      {formatPercent(rollup.progress)}
                    </span>
                    <span style={{ fontSize: 10, color: palette.textTertiary, marginTop: 3 }}>
                      toàn dự án
                    </span>
                  </Donut>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0, flex: 1 }}>
                    {slices.map((sl) => (
                      <div key={sl.label} style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                        <span
                          style={{
                            width: 11, height: 11, borderRadius: 4, flex: 'none', background: sl.color,
                          }}
                        />
                        <span
                          style={{
                            fontSize: 12, fontWeight: 500, minWidth: 0,
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          }}
                        >
                          {sl.label}
                        </span>
                        <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 600, flex: 'none' }}>
                          {formatPercent(sl.value)}
                        </span>
                      </div>
                    ))}
                    <div
                      style={{
                        display: 'flex', alignItems: 'center', gap: 9, paddingTop: 8,
                        borderTop: `1px solid ${palette.borderSplit}`, marginTop: 2,
                      }}
                    >
                      <span
                        style={{
                          width: 11, height: 11, borderRadius: 4, flex: 'none', background: palette.track,
                        }}
                      />
                      <span style={{ fontSize: 12, fontWeight: 500, color: palette.textTertiary }}>
                        Còn lại
                      </span>
                      <span
                        style={{
                          marginLeft: 'auto', fontSize: 12, fontWeight: 600, color: palette.textTertiary,
                        }}
                      >
                        {formatPercent(1 - rollup.progress)}
                      </span>
                    </div>
                  </div>
                </div>
                <div style={{ marginTop: 14, fontSize: 11, lineHeight: 1.5, color: palette.textTertiary }}>
                  Mỗi phần là trọng số × tiến độ: sàn theo trọng số hiệu dụng, công việc nhập
                  tay theo trọng số của nó — cộng lại đúng bằng {formatPercent(rollup.progress)}.
                </div>
              </div>
            </div>
          )}
        </SectionCard>
      </PageBody>

      <ConsequenceModal
        open={confirmingExport}
        tag="Xác nhận"
        title="Xuất báo cáo dự án?"
        description="Bản vẽ được dựng lại lần lượt từng sàn:"
        items={modelDecks.map((d) => ({
          label: d.name,
          meta: `${d.cellCount} ô`,
        }))}
        consequence="Dựng tuần tự, không song song, nên với dự án nhiều sàn việc này mất một lúc. Trong lúc chạy nút không bấm lại được, và nếu hỏng giữa chừng thì không có tệp một phần nào được đưa ra."
        okText="Xuất"
        confirmLoading={exporting}
        onCancel={() => setConfirmingExport(false)}
        onOk={() => void exportReport()}
      />

      <ConsequenceModal
        open={removingDeck !== null}
        tone="danger"
        tag="Thao tác phá huỷ"
        title={`Xóa sàn ${removingDeck?.name ?? ''}?`}
        description="Xóa vĩnh viễn, không khôi phục được. Mất theo sàn:"
        items={[
          { label: 'Toàn bộ ô và lịch sử công đoạn', meta: removingDeck ? `${removingDeck.cellCount} ô` : undefined },
          { label: 'Zone và kế hoạch' },
          { label: 'Ghi chú của GS' },
          { label: 'Bản vẽ đã tải lên', meta: removingDeck?.imagePath ? 'Đã có' : 'Chưa có' },
        ]}
        consequence="Máy tính bảng đang mở sàn này sẽ không ghi được nữa cho tới khi tải lại."
        okText="Xóa sàn"
        confirmText={removingDeck?.name}
        confirmLoading={removing}
        onCancel={() => setRemovingDeck(null)}
        onOk={() => void removeDeck()}
      />
    </>
  )
}
