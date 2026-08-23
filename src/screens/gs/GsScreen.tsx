import { Alert, Button, Col, Layout, Row, Spin, Tabs, Typography } from 'antd'
import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useAuth } from '../../auth/AuthProvider'
import { DrawingCanvas } from '../../canvas/DrawingCanvas'
import { computeDeckProgress } from '../../domain/progress'
import type { Cell, Deck, Stage } from '../../domain/types'
// One signed-URL helper for both roles: the bucket name and the 3600-second
// expiry belong in one place, and decksApi is a lib module rather than an admin
// one. Screens still never touch `supabase` directly.
import { getDrawingUrl } from '../../lib/decksApi'
import { formatAreaM2, formatPercent } from '../../lib/format'
import { listDeckCells, loadGsProject, type GsDeck } from '../../lib/gsApi'

export function GsScreen() {
  const { projectId } = useParams()
  const { profile, signOut } = useAuth()

  const [stages, setStages] = useState<Stage[]>([])
  const [decks, setDecks] = useState<GsDeck[]>([])
  const [activeDeckId, setActiveDeckId] = useState<string | null>(null)
  const [cells, setCells] = useState<Cell[]>([])
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [projectError, setProjectError] = useState(false)
  const [drawingError, setDrawingError] = useState(false)

  useEffect(() => {
    if (!projectId) return
    let cancelled = false
    setLoading(true)
    setProjectError(false)
    loadGsProject(projectId)
      .then((project) => {
        if (cancelled) return
        setStages(project.stages)
        setDecks(project.decks)
        setActiveDeckId(project.decks[0]?.id ?? null)
      })
      .catch(() => {
        if (!cancelled) setProjectError(true)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [projectId])

  const deck = decks.find((d) => d.id === activeDeckId) ?? null

  /**
   * Per-deck cell fetch. Task 9's realtime effect refetches on reconnect using
   * the same `listDeckCells(activeDeckId)` call; it will extract this into a
   * `useCallback` at that point so the reconnect handler and this effect share
   * one function instead of two copies drifting apart. Not extracted now: an
   * unused callback would fail this repo's `noUnusedLocals` build.
   */
  useEffect(() => {
    if (!activeDeckId) return
    let cancelled = false
    void listDeckCells(activeDeckId)
      .then((next) => {
        if (!cancelled) setCells(next)
      })
      .catch(() => {
        if (!cancelled) setCells([])
      })
    return () => {
      cancelled = true
    }
  }, [activeDeckId])

  /**
   * Re-signed on every deck change rather than cached per deck: the URL is good
   * for an hour, and a tablet left open on one deck all shift would otherwise
   * lose its drawing with no way to get it back short of a reload.
   */
  useEffect(() => {
    const path = deck?.imagePath
    if (!path) {
      setImageUrl(null)
      setDrawingError(false)
      return
    }
    let cancelled = false
    setDrawingError(false)
    getDrawingUrl(path)
      .then((url) => {
        if (!cancelled) setImageUrl(url)
      })
      .catch(() => {
        if (cancelled) return
        setImageUrl(null)
        setDrawingError(true)
      })
    return () => {
      cancelled = true
    }
  }, [deck?.imagePath])

  /**
   * computeDeckProgress takes a domain Deck, which carries its cells; GsDeck
   * carries the drawing instead, because the cells are fetched per deck. The
   * denominator is deck.totalAreaM2 and never the cells' own sum (spec §3.2).
   */
  const deckProgress = useMemo(() => {
    if (!deck) return null
    const asDomainDeck: Deck = {
      id: deck.id,
      code: deck.code,
      name: deck.name,
      totalAreaM2: deck.totalAreaM2,
      cells,
    }
    return computeDeckProgress(asDomainDeck, stages)
  }, [deck, cells, stages])

  /** Stage colour per cell CODE, which is what DrawingCanvas keys on. A cell
   *  with no stage is left out of the map and renders unfilled. */
  const cellColors = useMemo(() => {
    const colors: Record<string, string> = {}
    for (const cell of cells) {
      if (!cell.stageId) continue
      const stage = stages.find((s) => s.id === cell.stageId)
      if (stage) colors[cell.code] = stage.color
    }
    return colors
  }, [cells, stages])

  if (loading) {
    return <Spin style={{ display: 'block', margin: '25vh auto' }} />
  }

  if (projectError) {
    return (
      <div style={{ maxWidth: 360, margin: '25vh auto' }}>
        <Alert
          type="error"
          message="Không tải được dữ liệu dự án"
          description="Kiểm tra kết nối mạng rồi thử lại."
          action={
            <Button size="small" onClick={() => window.location.reload()}>
              Thử lại
            </Button>
          }
        />
      </div>
    )
  }

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Layout.Header
        style={{
          background: '#fff', display: 'flex', alignItems: 'center',
          gap: 12, paddingInline: 16,
        }}
      >
        <Typography.Text strong>{profile?.fullName}</Typography.Text>
        <span style={{ flex: 1 }} />
        {/* Spec §8.1: no account UI. Logout only. */}
        <Button size="large" onClick={() => void signOut()}>
          Đăng xuất
        </Button>
      </Layout.Header>

      <Layout.Content style={{ padding: 12 }}>
        <Tabs
          activeKey={activeDeckId ?? undefined}
          onChange={(key) => setActiveDeckId(key)}
          items={decks.map((d) => ({ key: d.id, label: d.name }))}
        />

        {drawingError && (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 12 }}
            message="Không tải được bản vẽ"
            description="Số liệu bên dưới vẫn đúng. Thử lại sau khi có mạng."
          />
        )}

        <Row gutter={12}>
          <Col xs={24} md={14}>
            {deck && deck.imagePath && deck.imageW && deck.imageH && imageUrl ? (
              <DrawingCanvas
                key={deck.id}
                imageUrl={imageUrl}
                imageW={deck.imageW}
                imageH={deck.imageH}
                guides={[]}
                cells={cells}
                selectedCodes={[]}
                cellColors={cellColors}
                panZoom
              />
            ) : (
              !drawingError && (
                <Alert
                  type="info"
                  showIcon
                  message="Sàn này chưa có bản vẽ"
                  description="Quản trị viên cần tải bản vẽ lên trước khi ghi tiến độ."
                />
              )
            )}
          </Col>
          <Col xs={24} md={10}>
            <div data-testid="gs-chart-region">
              <Typography.Title level={2} style={{ margin: 0 }}>
                {formatPercent(deckProgress?.progress ?? 0)}
              </Typography.Title>
              <Typography.Text type="secondary">Tiến độ sàn</Typography.Text>
            </div>
          </Col>
        </Row>
      </Layout.Content>

      <div
        data-testid="gs-spec-region"
        style={{
          position: 'sticky', bottom: 0, background: '#fff',
          borderTop: '1px solid #f0f0f0', padding: 8,
        }}
      >
        <Typography.Text>
          Tổng diện tích sàn: {formatAreaM2(deck?.totalAreaM2 ?? 0)} m²
        </Typography.Text>
      </div>
    </Layout>
  )
}
