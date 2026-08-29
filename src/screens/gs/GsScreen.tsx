import {
  Alert, App, Button, Col, Layout, Row, Space, Spin, Switch, Tabs, Typography,
} from 'antd'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../../auth/AuthProvider'

import { DrawingCanvas } from '../../canvas/DrawingCanvas'
import { buildPlanLabels } from '../../domain/plan'
import { buildStageSlices } from '../../domain/pieSlices'
import { paintLensColors } from '../../domain/lens'
import { computeDeckProgress } from '../../domain/progress'
import type { Cell, Deck, Stage, Zone } from '../../domain/types'
// One signed-URL helper for both roles: the bucket name and the 3600-second
// expiry belong in one place, and decksApi is a lib module rather than an admin
// one. Screens still never touch `supabase` directly.
import { LOGIN_PATH } from '../../config'
import { getDrawingUrl, listStages } from '../../lib/decksApi'
import { formatAreaM2 } from '../../lib/format'
import {
  listDeckCells, loadGsProject, setCellStage, subscribeDeckCells,
  type GsDeck, type GsRealtimeStatus,
} from '../../lib/gsApi'
import { listDeckZones } from '../../lib/zonesApi'
import { CellStageModal } from './CellStageModal'
import { StagePie } from './StagePie'
import { StageSpecTable } from '../../components/StageSpecTable'

/**
 * How long to wait for the realtime channel to reach SUBSCRIBED before telling
 * the foreman the screen may be stale. Ten seconds: long enough that a slow
 * site tether does not flash a warning on every deck change, short enough that
 * nobody works a whole bay off numbers that stopped moving.
 */
const REALTIME_CONNECT_TIMEOUT_MS = 10_000

/**
 * How long after SUBSCRIBED to re-read the deck.
 *
 * SUBSCRIBED does not mean the server has registered the subscription. Probed
 * against the live project: two clients signed in as the same GS, the watcher
 * subscribed, and a write issued immediately after SUBSCRIBED was NOT
 * delivered -- the same write four seconds later was. So there is a window
 * between the load effect's fetch and the subscription actually being live in
 * which another foreman's tap is lost entirely, and nothing on screen would
 * ever say so: the next refetch only happens on a reconnect.
 *
 * One re-read shortly after SUBSCRIBED closes it. Six seconds, not two: the
 * probe saw a write at four seconds delivered and one issued immediately not,
 * so a two-second grace could still fire inside the window it exists to close.
 * Cheap either way -- one small query per deck open.
 */
const REALTIME_REGISTRATION_GRACE_MS = 6_000

/**
 * How far Σ cell.area_m2 must exceed the deck's declared area before the pie's
 * renormalisation is worth telling the foreman about.
 *
 * Sized by the DATABASE, like geometry.ts's EPSILON: `cells.area_m2` is
 * `numeric(12,3)`, so 0,001 m² is the smallest over-coverage the column can even
 * express -- anything under that is float residue from summing a few thousand
 * three-decimal values, and on a 6139 m² deck it renormalises the wedges by
 * 1,6e-7, which is invisible. Warning on that would put a "0,00 m² over" banner
 * on decks whose pro-rated cell areas are meant to sum to the total exactly.
 */
const OVER_COVERAGE_EPSILON_M2 = 1e-3

/** One in-flight `setCellStage` for one cell. See `pendingWrites`. */
interface PendingWrite {
  /**
   * Bumped by every later tap on the same cell. A rollback whose generation is
   * no longer the current one has been superseded and is dropped. Server truth
   * arriving for the cell over realtime removes the entry outright, which has
   * the same effect.
   */
  generation: number
  /**
   * The stage this cell is believed to hold on the SERVER -- deliberately NOT
   * the value on screen. A second tap while the first write is in flight
   * inherits the first tap's baseline, so if both writes fail the cell lands back
   * on the last confirmed value instead of on the first tap's optimistic one,
   * which was never persisted anywhere.
   */
  baselineStageId: string | null
}

export function GsScreen() {
  const { projectId } = useParams()
  const navigate = useNavigate()
  const { profile, signOut } = useAuth()

  const [stages, setStages] = useState<Stage[]>([])
  const [decks, setDecks] = useState<GsDeck[]>([])
  const [activeDeckId, setActiveDeckId] = useState<string | null>(null)
  const [cells, setCells] = useState<Cell[]>([])
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [projectError, setProjectError] = useState(false)
  const [drawingError, setDrawingError] = useState(false)
  /**
   * A failed stage read, kept apart from a deck that genuinely has none.
   *
   * Both leave `stages` empty, and an empty stage list makes every percentage
   * read 0% without raising anything -- the same "a refusal must never render as
   * missing data" rule `notMember` exists for.
   */
  const [stagesError, setStagesError] = useState(false)
  /**
   * The route gates on role, not on membership, so a GS can reach
   * `/gs/:projectId` for a project they are not in. RLS then answers every query
   * with zero rows and no error, which is byte-for-byte what a project whose
   * drawings nobody has uploaded yet looks like. Tracked separately so the
   * refusal can say so, rather than rendering as missing data (see GsProject).
   */
  const [notMember, setNotMember] = useState(false)

  useEffect(() => {
    if (!projectId) return
    let cancelled = false
    setLoading(true)
    setProjectError(false)
    setNotMember(false)
    loadGsProject(projectId)
      .then((project) => {
        if (cancelled) return
        setNotMember(!project.isMember)
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

  /**
   * The open deck's own paint stages.
   *
   * Loaded per deck, not once per project: a main deck, a cellar deck and a
   * helideck carry different coat systems, so the legend, the pie and the
   * percentage all belong to the deck on screen. Cleared while the next deck's
   * load is in flight, so the legend can never show one deck's colours over
   * another's bays.
   */
  useEffect(() => {
    if (!activeDeckId) {
      setStages([])
      return
    }
    let cancelled = false
    setStages([])
    setStagesError(false)
    listStages(activeDeckId)
      .then((rows: Stage[]) => { if (!cancelled) setStages(rows) })
      .catch(() => { if (!cancelled) setStagesError(true) })
    return () => { cancelled = true }
  }, [activeDeckId])

  const deck = decks.find((d) => d.id === activeDeckId) ?? null

  /** The deck whose answer is still wanted. See refetchCells. */
  const wantedDeckId = useRef<string | null>(null)

  /**
   * The one per-deck cell fetch, shared by the load effect below and by the
   * realtime reconnect handler (spec §11 row 2), so the two cannot drift into
   * disagreeing about what "the deck's cells" means.
   *
   * Both callers can have a read in flight while the foreman changes tab, so the
   * answer is dropped unless its deck is still the one on screen -- the guard
   * the load effect used to carry as a per-effect `cancelled` flag. Without it a
   * slow reply for the previous deck lands on the new deck's drawing, colouring
   * bays that are not there and dividing by the wrong deck's area.
   */
  /**
   * A cell's write in flight, and what to put back on screen if it fails.
   *
   * Two jobs, in one map because both are keyed on the same thing -- one cell
   * and one write attempt.
   *
   * 1. A re-read must not overwrite a cell with a write in flight with the
   *    server's pre-write value: the PATCH and the GET race, and the GET can
   *    answer first. Without this, a tap made shortly before a re-read is undone
   *    on screen with no error -- the write did not fail, so nothing reports it.
   *
   * 2. The rollback must not restore a value that has since been superseded.
   *    `commitStage` used to close over the stage read from render-scope `cells`
   *    at tap time, which goes stale in two reproduced ways. Two foremen, one
   *    bay: A taps Tháo giáo, B commits Coat 3 and it arrives over realtime, A's
   *    write then fails and the rollback puts A's remembered "not started" back
   *    over B's Coat 3 -- the screen now contradicts the database with no further
   *    event coming to correct it. One foreman, double tap: Coat 2 then Coat 3 on
   *    the same bay, the first write fails and its rollback wipes the second
   *    write's optimistic value. `generation` is what discards a stale rollback.
   */
  const pendingWrites = useRef<Map<string, PendingWrite>>(new Map())

  const refetchCells = useCallback(async (deckId: string) => {
    try {
      const next = await listDeckCells(deckId)
      if (wantedDeckId.current !== deckId) return
      setCells((prev) => {
        if (pendingWrites.current.size === 0) return next
        // Keep the optimistic stage for any cell still being written. Geometry
        // and everything else comes from the server as normal.
        const local = new Map(prev.map((c) => [c.id, c]))
        return next.map((c) =>
          pendingWrites.current.has(c.id) && local.has(c.id)
            ? { ...c, stageId: local.get(c.id)!.stageId }
            : c,
        )
      })
    } catch {
      // Deliberately does NOT clear the cells. A re-read failing on a site
      // tether is the common case, and blanking the deck would take the drawing
      // and every number away from a foreman whose data is still valid. The
      // load effect owns the empty state; this only ever refreshes.
    }
  }, [])

  useEffect(() => {
    wantedDeckId.current = activeDeckId
    if (!activeDeckId) return
    void refetchCells(activeDeckId)
    return () => {
      wantedDeckId.current = null
    }
  }, [activeDeckId, refetchCells])

  const [realtimeStatus, setRealtimeStatus] = useState<GsRealtimeStatus>('subscribed')
  /**
   * Whether this subscription has been down since it was opened. A ref, not
   * state: it is read inside the status callback and must not re-run the effect
   * (which would tear the channel down and rebuild it on every disconnect).
   */
  const wasDisconnected = useRef(false)
  /**
   * Watchdog for a channel that never connects at all.
   *
   * realtimeStatus starts optimistically at 'subscribed', so if the socket
   * never reaches SUBSCRIBED and never errors -- a captive portal on the site
   * wifi answers every request, a proxy that holds the websocket open -- no
   * status callback ever fires and the foreman sees no banner. They would go on
   * reading numbers that stopped updating, while deciding what to paint next.
   * Nothing else on this screen would say so, because their own writes still
   * succeed over plain HTTP.
   */
  const connectWatchdog = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** Pending post-SUBSCRIBED re-read; see REALTIME_REGISTRATION_GRACE_MS. */
  const registrationRefetch = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!activeDeckId) return
    /**
     * Whether this effect's channel has already been torn down.
     *
     * `RealtimeChannel.unsubscribe` does not remove the `_onClose` hook that
     * `subscribe` registered (RealtimeChannel.js:159), so leaving a channel calls
     * this effect's own status callback with CLOSED -- AFTER the cleanup below has
     * run. Measured at the tip before this flag: one deck tab change produced
     * `listDeckCells` calls ['d1','d2','d2','d2'], three full-deck reads for one
     * deck on the exact tether the design worries about, plus a "Mất kết nối"
     * banner when nothing was wrong. A banner that appears routinely is one a
     * foreman learns to ignore, which is how a real outage gets missed.
     *
     * It gates onCellChange and onCellDelete too: a payload for the deck the
     * foreman has just left must not be folded into the deck they are now
     * looking at, which is the same defect wantedDeckId guards on the read path.
     */
    let disposed = false
    connectWatchdog.current = setTimeout(() => {
      setRealtimeStatus('disconnected')
      // Treated as a real disconnect so that if it does connect later, the
      // reconnect branch below re-reads the deck rather than trusting a socket
      // that has already missed an unknown number of writes.
      wasDisconnected.current = true
    }, REALTIME_CONNECT_TIMEOUT_MS)
    const unsubscribe = subscribeDeckCells(activeDeckId, {
      onCellChange: (next) => {
        if (disposed) return
        // Last write wins on stage_id (spec §11 row 3): whatever arrives is the
        // newer truth. Merged by id, and appended when the id is unknown -- the
        // admin can add a cell to a deck a foreman is already looking at.
        //
        // Server truth for this cell also retires any pending rollback for it:
        // what arrived is newer than the value this tablet remembered before its
        // own write went out, so restoring that value would contradict the
        // database with no further event coming to correct it.
        pendingWrites.current.delete(next.id)
        setCells((prev) =>
          prev.some((c) => c.id === next.id)
            ? prev.map((c) => (c.id === next.id ? next : c))
            : [...prev, next],
        )
      },
      onCellDelete: (cellId) => {
        if (disposed) return
        // A merge in the admin's deck editor is one UPDATE of the survivor to the
        // union area plus a DELETE of each absorbed cell (mergeCells keeps
        // topLeft.code). Without this branch the survivor grows here while the
        // absorbed cells stay, so their area is counted twice in every A_i and
        // in the percentage the customer makes schedule decisions from -- and it
        // can push Σ cell area past total_area_m2, which is the over-coverage
        // the pie has to disclose. Unknown ids fall out as a no-op: filter finds
        // nothing, which is what a delete on another client's stale row means.
        pendingWrites.current.delete(cellId)
        setCells((prev) => prev.filter((c) => c.id !== cellId))
      },
      onStatus: (status) => {
        if (disposed) return
        if (status === 'subscribed' && connectWatchdog.current) {
          clearTimeout(connectWatchdog.current)
          connectWatchdog.current = null
        }
        setRealtimeStatus(status)
        if (status === 'disconnected') {
          wasDisconnected.current = true
          return
        }
        // Reconnected: the socket may have missed any number of writes while it
        // was down, so nothing short of a full re-read of the deck's cells is
        // safe (spec §11 row 2). Immediate, because the foreman is looking at a
        // screen we have already told them is stale.
        if (wasDisconnected.current) {
          wasDisconnected.current = false
          void refetchCells(activeDeckId)
        }
        // And once more shortly after every SUBSCRIBED, reconnect or not: the
        // server registers the subscription some time AFTER reporting
        // SUBSCRIBED, so a write in that window reaches nobody.
        if (registrationRefetch.current) clearTimeout(registrationRefetch.current)
        registrationRefetch.current = setTimeout(() => {
          registrationRefetch.current = null
          void refetchCells(activeDeckId)
        }, REALTIME_REGISTRATION_GRACE_MS)
      },
    })
    return () => {
      // Set BEFORE unsubscribe(), which is what fires the CLOSED this guards.
      disposed = true
      if (connectWatchdog.current) {
        clearTimeout(connectWatchdog.current)
        connectWatchdog.current = null
      }
      if (registrationRefetch.current) {
        clearTimeout(registrationRefetch.current)
        registrationRefetch.current = null
      }
      // The latch resets because the NEXT channel opens alongside a fresh
      // listDeckCells from the deck effect, so it has nothing to catch up on.
      wasDisconnected.current = false
      // realtimeStatus deliberately does NOT reset. It used to be set back to
      // 'subscribed' here, which meant that during a genuine outage a deck tab
      // change cleared the staleness banner and nothing restored it for ten
      // seconds -- the connect watchdog's whole timeout. Reproduced: banner
      // shown, tab changed, absent at +9 s, back at +10,5 s. For those ten
      // seconds the screen looked healthy while showing whatever the last
      // successful read had left. The socket is shared across decks and its
      // health does not change because the foreman looked at another drawing, so
      // the last known state is carried across instead.
      unsubscribe()
    }
  }, [activeDeckId, refetchCells])

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

  const slices = useMemo(
    () => buildStageSlices(deck?.totalAreaM2 ?? 0, cells, stages),
    [deck?.totalAreaM2, cells, stages],
  )

  /**
   * Whether the cells cover more than the deck declares -- the one state in which
   * the pie's picture contradicts its own legend.
   *
   * recharts derives each wedge's angle from the sum of the array it is handed,
   * and buildStageSlices omits the unmapped slice when it would be negative
   * (there is no negative wedge to draw). So on a deck declaring 500 m² whose
   * cells cover 700, a stage holding 300 m² occupies 300/700 = 42,86% of the ring
   * while its own legend row an inch away reads 300/500 = 60,00%. The printed
   * numbers are the right ones and are tested; the picture is the thing lying.
   *
   * Disclosed, NOT renormalised. Dividing the legend by Σ cell area instead would
   * make it agree with a wedge whose denominator is not the deck -- and spec §3.2
   * makes total_area_m2 the denominator of every percentage in this product,
   * including the one the customer is billed against. Non-blocking, matching how
   * spec §11 treats divergence in the admin's deck editor.
   */
  const mappedAreaM2 = useMemo(
    () => cells.reduce((sum, c) => sum + c.areaM2, 0),
    [cells],
  )
  const overCovered = deck !== null
    && mappedAreaM2 - deck.totalAreaM2 > OVER_COVERAGE_EPSILON_M2

  /** Stage colour per cell CODE, which is what DrawingCanvas keys on. Shared
   *  with the admin's progress screen so the two cannot drift into colouring
   *  one deck two different ways. */
  const cellColors = useMemo(() => paintLensColors(cells, stages), [cells, stages])

  const [showPlan, setShowPlan] = useState(false)
  const [zones, setZones] = useState<Zone[]>([])

  /**
   * Fetched only while the toggle is on. Zones are empty for every deck until
   * Phase 4 ships the zone editor, so fetching them on every deck open would be
   * a round trip per tab, on a site tether, for nothing.
   */
  useEffect(() => {
    if (!showPlan || !activeDeckId) {
      setZones([])
      return
    }
    let cancelled = false
    void listDeckZones(activeDeckId)
      .then((next) => {
        if (!cancelled) setZones(next)
      })
      .catch(() => {
        if (!cancelled) setZones([])
      })
    return () => {
      cancelled = true
    }
  }, [showPlan, activeDeckId])

  const planLabels = useMemo(
    () => (showPlan ? buildPlanLabels(zones, cells) : undefined),
    [showPlan, zones, cells],
  )

  const [selectedCell, setSelectedCell] = useState<Cell | null>(null)
  const { message } = App.useApp()

  /**
   * Spec §11 row 1: optimistic local update so the chart moves with no
   * perceptible delay; on failure roll back and raise message.error.
   *
   * The rollback restores ONE cell, found by id, rather than a snapshot of the
   * whole array. A snapshot would also discard anything that arrived for another
   * cell while this write was in flight -- another foreman's tick, delivered over
   * realtime -- and it would look correct in any test that only touches one cell.
   *
   * And it is gated on this cell's write generation, so a rollback that has been
   * overtaken is dropped rather than applied over the newer truth. See
   * PendingWrite for the two reproduced scenarios that needs.
   */
  const commitStage = (cellId: string, stageId: string | null, note = '') => {
    const superseded = pendingWrites.current.get(cellId)
    const generation = (superseded?.generation ?? 0) + 1
    const baselineStageId = superseded
      ? superseded.baselineStageId
      : cells.find((c) => c.id === cellId)?.stageId ?? null
    pendingWrites.current.set(cellId, { generation, baselineStageId })
    // The optimistic update carries the note as well as the stage, so
    // reopening the bay before the write settles shows what was just typed
    // rather than the note it is replacing.
    setCells((prev) => prev.map((c) => (c.id === cellId ? { ...c, stageId, note } : c)))
    void setCellStage(cellId, stageId, note)
      .catch(() => {
        // Only the newest attempt for this cell may roll it back. An older one
        // finishing late would otherwise undo a later tap, or overwrite a value
        // another foreman's write has since delivered over realtime.
        if (pendingWrites.current.get(cellId)?.generation === generation) {
          setCells((prev) =>
            prev.map((c) => (c.id === cellId ? { ...c, stageId: baselineStageId } : c)),
          )
        }
        // Raised either way. This tablet's write did not land, and that is true
        // whether or not the cell on screen still shows what was tapped.
        message.error('Không lưu được tiến độ. Kiểm tra kết nối rồi thử lại.')
      })
      .finally(() => {
        // Guarded, so an earlier attempt settling late does not strip the
        // re-read protection from a write that is still in flight.
        if (pendingWrites.current.get(cellId)?.generation === generation) {
          pendingWrites.current.delete(cellId)
        }
      })
  }

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

  // A refusal, rendered as a refusal. Before this the screen showed the same
  // "Sàn này chưa có bản vẽ" over "Tổng diện tích sàn: 0,00 m²" that a project
  // awaiting its drawings shows, so a GS who mistyped a project id -- or followed
  // a link to a platform they are not assigned to -- had no way to tell "not
  // yours" from "not uploaded yet", and would wait for an upload that was never
  // coming. Same wording as the index route's, in the singular: whatever the
  // cause, the action is to talk to the administrator.
  if (notMember) {
    return (
      <div style={{ maxWidth: 360, margin: '25vh auto' }}>
        <Alert
          type="info"
          message="Không xem được dự án này"
          description="Tài khoản hợp lệ, nhưng chưa được gán vào dự án này. Liên hệ quản trị viên để được thêm vào dự án."
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
        <Button
          size="large"
          onClick={() => void signOut().then(() => navigate(LOGIN_PATH, { replace: true }))}
        >
          Đăng xuất
        </Button>
      </Layout.Header>

      <Layout.Content style={{ padding: 12 }}>
        <Tabs
          activeKey={activeDeckId ?? undefined}
          onChange={(key) => setActiveDeckId(key)}
          items={decks.map((d) => ({ key: d.id, label: d.name }))}
        />

        {realtimeStatus === 'disconnected' && (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 12 }}
            message="Mất kết nối, đang kết nối lại..."
            description="Số liệu trên màn hình có thể chưa cập nhật. Ghi tiến độ vẫn được lưu khi có mạng trở lại."
          />
        )}

        {stagesError && (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 12 }}
            message="Không tải được lớp sơn của sàn"
            description="Phần trăm bên dưới đang tính thiếu. Thử lại sau khi có mạng."
          />
        )}

        {drawingError && (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 12 }}
            message="Không tải được bản vẽ"
            description="Số liệu bên dưới vẫn đúng. Thử lại sau khi có mạng."
          />
        )}

        {/* aria-label on the Switch rather than a <label htmlFor>: antd renders
            a <button>, which is not a labelable element, so a label would
            associate with nothing and leave the control with no accessible name. */}
        <Space style={{ marginBottom: 8 }}>
          <Switch checked={showPlan} onChange={setShowPlan} aria-label="Hiện kế hoạch" />
          <Typography.Text>Hiện kế hoạch</Typography.Text>
        </Space>

        <Row gutter={12}>
          <Col xs={24} md={14}>
            {deck && deck.imagePath && deck.imageW && deck.imageH && imageUrl ? (
              <DrawingCanvas
                key={deck.id}
                imageUrl={imageUrl}
                imageW={deck.imageW}
                imageH={deck.imageH}

                cells={cells}
                selectedCodes={[]}
                cellColors={cellColors}
                planLabels={planLabels}
                panZoom
                onCellClick={(code) => {
                  setSelectedCell(cells.find((c) => c.code === code) ?? null)
                }}
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
              {overCovered && deck && (
                <Alert
                  type="warning"
                  showIcon
                  style={{ marginBottom: 8 }}
                  message="Diện tích các ô vượt diện tích sàn khai báo"
                  description={`Các ô cộng lại ${formatAreaM2(mappedAreaM2)} m², sàn khai báo ${formatAreaM2(deck.totalAreaM2)} m². Hình vẽ chia theo tổng diện tích các ô nên không khớp với tỷ lệ ghi bên cạnh, và các tỷ lệ cộng lại vượt 100%. Các con số vẫn tính theo diện tích sàn khai báo. Nhờ quản trị viên kiểm tra lại diện tích sàn hoặc lưới ô.`}
                />
              )}
              <StagePie
                slices={slices}
                totalAreaM2={deck?.totalAreaM2 ?? 0}
                progress={deckProgress?.progress ?? 0}
              />
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
        <StageSpecTable stages={deckProgress?.stages ?? []} />
      </div>

      <CellStageModal
        cell={selectedCell}
        stages={stages}
        open={selectedCell !== null}
        onClose={() => setSelectedCell(null)}
        onCommit={commitStage}
      />
    </Layout>
  )
}
