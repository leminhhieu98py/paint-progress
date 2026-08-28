import { Alert, Button, Card, Select, Space, Table, Typography } from 'antd'
import dayjs from 'dayjs'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { renderDeckDrawing, renderDeckPie } from '../../canvas/deckSnapshot'
import { computeProjectProgress } from '../../domain/progress'
import { listGsUsers } from '../../lib/adminApi'
import { getDrawingUrl, listDecks, type DeckRow } from '../../lib/decksApi'
import { formatAreaM2, formatPercent } from '../../lib/format'
import { loadProjectProgress } from '../../lib/progressApi'
import { listDeckZones } from '../../lib/zonesApi'
import { listProjectNames } from '../../lib/projectsApi'
import { buildReportWorkbook, reportFileName, type DeckImages } from '../../lib/reportXlsx'
import { NEW_DECK } from '../../config'

interface RollupRow {
  key: string
  name: string
  code: string
  share: string
  totalAreaM2: string
  progress: string
}

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

  useEffect(() => {
    void (async () => {
      try {
        const rows = await listProjectNames()
        setProjects(rows)
        // Only seed the default once: an explicit later choice must not be
        // clobbered if the project list happens to refresh.
        setProjectId((prev) => prev ?? rows[0]?.id ?? null)
        setError(null)
      } catch (e) {
        setError((e as Error).message)
      }
    })()
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
      progress: formatPercent(d?.progress ?? 0),
    }
  })

  /**
   * The XLSX (spec §9), built from EVERY deck of the project.
   *
   * Zones and pictures are fetched here rather than held all the time: export is
   * a rare action, and a round trip and a canvas decode per deck on a button
   * pressed once a week is cheaper than paying for them on every screen open.
   */
  const exportReport = async () => {
    if (entries.length === 0) return
    setExporting(true)
    try {
      const profiles = await listGsUsers().catch(() => [])
      const userNames = Object.fromEntries(profiles.map((u) => [u.id, u.fullName]))

      const reportDecks = await Promise.all(entries.map(async (entry) => ({
        deck: entry.deck,
        stages: entry.stages,
        audit: entry.audit,
        areaSource: entry.areaSource,
        userNames,
        zones: await listDeckZones(entry.deck.id),
      })))

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
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setExporting(false)
    }
  }

  return (
    <Space direction="vertical" style={{ width: '100%' }} size="middle">
      {error && <Alert type="error" message={error} closable onClose={() => setError(null)} />}

      <Space>
        <Typography.Title level={4} style={{ margin: 0 }}>
          Sàn
        </Typography.Title>
        <Select
          style={{ width: 240 }}
          value={projectId ?? undefined}
          placeholder="Chọn dự án"
          options={projects.map((p) => ({ value: p.id, label: `${p.name} (${p.code})` }))}
          onChange={(v) => setProjectId(v)}
        />
        <Button
          type="primary"
          disabled={!projectId}
          onClick={() => navigate(`${NEW_DECK}?project=${projectId}`)}
        >
          Tạo sàn
        </Button>
      </Space>

      <Table<DeckRow>
        rowKey="id"
        loading={loading}
        dataSource={decks}
        pagination={false}
        columns={[
          { title: 'Tên sàn', dataIndex: 'name' },
          { title: 'Mã', dataIndex: 'code', width: 100 },
          { title: 'Số ô', dataIndex: 'cellCount', width: 90 },
          {
            title: 'Diện tích (m²)',
            dataIndex: 'totalAreaM2',
            width: 160,
            render: (v: number) => formatAreaM2(v),
          },
          {
            title: 'Bản vẽ',
            key: 'drawing',
            width: 110,
            render: (_v, deck) => (deck.imagePath ? 'Đã có' : 'Chưa có'),
          },
          {
            title: '',
            key: 'actions',
            width: 90,
            render: (_v, deck) => (
              <Button size="small" onClick={() => navigate(deck.id)}>
                Mở
              </Button>
            ),
          },
        ]}
      />

      <Card
        size="small"
        title="Tiến độ toàn dự án"
        extra={
          <Button
            onClick={() => void exportReport()}
            loading={exporting}
            disabled={entries.length === 0}
          >
            Xuất báo cáo
          </Button>
        }
      >
        {entries.length === 0 && (
          <Typography.Text type="secondary">Dự án này chưa có sàn nào</Typography.Text>
        )}
        {entries.length > 0 && (
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
        )}
      </Card>
    </Space>
  )
}
