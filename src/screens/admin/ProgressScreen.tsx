import { Alert, Card, Col, Row, Select, Space, Spin, Table, Tabs, Typography } from 'antd'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { DrawingCanvas } from '../../canvas/DrawingCanvas'
import { paintLensColors, scaffoldLensColors } from '../../domain/lens'
import { computeDeckProgress, computeProjectProgress } from '../../domain/progress'
import { getDrawingUrl } from '../../lib/decksApi'
import { formatAreaM2, formatPercent } from '../../lib/format'
import { loadProjectProgress, type DeckProgressEntry } from '../../lib/progressApi'
import { listProjectNames } from '../../lib/projectsApi'
import { StageSpecTable } from '../gs/StageSpecTable'

type ProjectOption = Awaited<ReturnType<typeof listProjectNames>>[number]

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
                      selectedCodes={[]}
                      cellColors={paintColors}
                      panZoom
                    />
                  </div>
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
