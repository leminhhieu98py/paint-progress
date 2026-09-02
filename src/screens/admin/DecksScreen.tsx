import { ArrowRightOutlined, DownloadOutlined, PlusOutlined } from '@ant-design/icons'
import { Alert, App, Button, Select, Table, Tooltip } from 'antd'
import dayjs from 'dayjs'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { renderDeckDrawing, renderDeckPie } from '../../canvas/deckSnapshot'
import { computeProjectProgress } from '../../domain/progress'
import { listGsUsers } from '../../lib/adminApi'
import { getDrawingUrl, listDecks, type DeckRow } from '../../lib/decksApi'
import { formatAreaM2, formatPercent } from '../../lib/format'
import { listDeckEvents, loadProjectProgress } from '../../lib/progressApi'
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
    text: 'Tỉ trọng là phần diện tích của sàn trong dự án — tính ra từ diện tích, không nhập tay.',
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
   * Every deck of the project with its stages and cells.
   *
   * This is the project-wide half of what used to be `/admin/progress`. The
   * per-deck half moved into the deck's own screen; the rollup and the export
   * are about the PROJECT, and this list is the only screen that has one
   * selected.
   */
  const [entries, setEntries] = useState<Awaited<ReturnType<typeof loadProjectProgress>>>([])
  const [exporting, setExporting] = useState(false)
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
      setEntries([])
      return
    }
    let cancelled = false
    // Not cleared first, deliberately: a failed reload leaves the last good
    // rollup on screen rather than blanking a number the admin was reading.
    loadProjectProgress(projectId)
      .then((rows) => { if (!cancelled) setEntries(rows) })
      .catch((e) => { if (!cancelled) setError((e as Error).message) })
    return () => { cancelled = true }
  }, [projectId])

  const rollup = useMemo(() => computeProjectProgress(entries), [entries])

  const rollupRows: RollupRow[] = entries.map((entry) => {
    const d = rollup.decks.find((x) => x.deckId === entry.deck.id)
    return {
      key: entry.deck.id,
      name: entry.deck.name,
      code: entry.deck.code,
      share: formatPercent(d?.weight ?? 0),
      totalAreaM2: formatAreaM2(entry.deck.totalAreaM2),
      progress: d?.progress ?? 0,
    }
  })

  /*
    Each deck's slice is its area share TIMES its own progress -- what it
    actually contributes to the project number -- not its progress alone. The
    slices therefore sum to exactly the project percentage, and the ring's
    empty part is the work left. A ring of raw per-deck percentages would sum
    to something meaningless and read as though the project were further along.
  */
  const slices: DonutSlice[] = entries.map((entry, i) => {
    const d = rollup.decks.find((x) => x.deckId === entry.deck.id)
    return {
      label: entry.deck.name,
      value: (d?.weight ?? 0) * (d?.progress ?? 0),
      color: DECK_SHADES[i % DECK_SHADES.length],
    }
  })
  const totalArea = entries.reduce((sum, e) => sum + e.deck.totalAreaM2, 0)
  const projectName = projects.find((p) => p.id === projectId)?.name ?? ''

  /**
   * The XLSX (spec §9), built from EVERY deck of the project.
   *
   * Zones and pictures are fetched here rather than held all the time: export is
   * a rare action, and a round trip and a canvas decode per deck on a button
   * pressed once a week is cheaper than paying for them on every screen open.
   */
  const exportReport = async () => {
    if (entries.length === 0) return
    setConfirmingExport(false)
    setExporting(true)
    try {
      const profiles = await listGsUsers().catch(() => [])
      const userNames = Object.fromEntries(profiles.map((u) => [u.id, u.fullName]))

      const reportDecks = await Promise.all(entries.map(async (entry) => {
        const [zones, events] = await Promise.all([
          listDeckZones(entry.deck.id),
          listDeckEvents(entry.deck.id),
        ])
        return {
          deck: entry.deck,
          stages: entry.stages,
          areaSource: entry.areaSource,
          userNames,
          zones,
          events,
        }
      }))

      // Sequential: each render decodes a full-size drawing into a canvas, and
      // ten at once on an admin laptop is a spike for no gain.
      const images: Record<string, DeckImages> = {}
      for (const entry of entries) {
        const url = entry.imagePath ? await getDrawingUrl(entry.imagePath).catch(() => null) : null
        images[entry.deck.id] = {
          drawingPng: url
            ? await renderDeckDrawing(
              url, entry.imageW ?? 0, entry.imageH ?? 0, entry.deck.cells, entry.stages,
            )
            : null,
          piePng: renderDeckPie(entry.deck.totalAreaM2, entry.deck.cells, entry.stages),
          // The sheet sizes the picture from this. Excel stretches whatever box
          // it is given, and a fixed one squashed every deck that was not the
          // shape the box assumed.
          drawingAspect:
            entry.imageW && entry.imageH ? entry.imageH / entry.imageW : null,
        }
      }

      const project = projects.find((p) => p.id === projectId)
      const blob = await buildReportWorkbook({
        projectName: project?.name ?? '',
        projectCode: project?.code ?? '',
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
                width: 100,
                align: 'right',
                render: (_v, deck) => (
                  <Tooltip title="Mở sàn">
                    <Button
                      size="small"
                      aria-label="Mở"
                      icon={<ArrowRightOutlined />}
                      onClick={() => navigate(deck.id)}
                    />
                  </Tooltip>
                ),
              },
            ]}
          />
        </SectionCard>

        <SectionCard
          title="Tiến độ toàn dự án"
          summary="Trung bình có trọng số của phần trăm từng sàn"
          bodyPadding={0}
          footer={<RulesDisclosure rules={RULES} />}
          extra={
            <Tooltip title={entries.length === 0 ? 'Cần ít nhất một sàn' : 'Xuất báo cáo · .xlsx'}>
              <Button
                icon={<DownloadOutlined aria-hidden />}
                onClick={() => setConfirmingExport(true)}
                loading={exporting}
                disabled={entries.length === 0}
              >
                Xuất báo cáo
              </Button>
            </Tooltip>
          }
        >
          {entries.length === 0 ? (
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
              <div
                data-testid="project-rollup"
                style={{ borderRight: `1px solid ${palette.borderCard}`, minWidth: 0 }}
              >
                <Table<RollupRow>
                  className="pp-table"
                  size="small"
                  pagination={false}
                  dataSource={rollupRows}
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
                        <strong>100,00%</strong>
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
                  Mỗi phần là tỉ trọng diện tích × tiến độ sàn — cộng lại đúng bằng{' '}
                  {formatPercent(rollup.progress)}.
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
        items={entries.map((e) => ({
          label: e.deck.name,
          meta: `${e.deck.cells.length} ô`,
        }))}
        consequence="Dựng tuần tự, không song song, nên với dự án nhiều sàn việc này mất một lúc. Trong lúc chạy nút không bấm lại được, và nếu hỏng giữa chừng thì không có tệp một phần nào được đưa ra."
        okText="Xuất"
        confirmLoading={exporting}
        onCancel={() => setConfirmingExport(false)}
        onOk={() => void exportReport()}
      />
    </>
  )
}
