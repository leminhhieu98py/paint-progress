import { ArrowLeftOutlined } from '@ant-design/icons'
import { Alert, App, Button, Layout, Select, Spin } from 'antd'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { PageBody, PageHeader } from '../../components/PageHeader'
import { APP_BASE_PATH } from '../../config'
import { effortDayKey } from '../../domain/effort'
import {
  actualByDay, remainingAreaOn, type ActualStageDay, type DeckPlanScope,
} from '../../domain/kpi'
import type { DeckEvent, WorkModel } from '../../domain/types'
import {
  clearStagePlanArea, listStagePlans, saveStagePlan, type StoredStagePlan,
} from '../../lib/kpiApi'
import { setDeckKpiColors } from '../../lib/decksApi'
import { listProjectEvents, loadProjectModel } from '../../lib/progressApi'
import { listProjectNames } from '../../lib/projectsApi'
import { palette, shadowCard } from '../../theme'
import { DeckKpiColorTable, type DeckKpiColorRow, type DeckKpiColors } from './DeckKpiColorTable'
import { KpiDashboard, type KpiEntry } from './KpiDashboard'
import { StagePlanTable, type StagePlanRow, type StagePlanWindow } from './StagePlanTable'

/**
 * The route-level half of KPI Plan vs Actual (Feedback Rv5, item 9, rules
 * RV5-27, RV5-28 and RV5-29).
 *
 * Two variants over one body, exactly as `DashboardScreen` does it: the admin
 * picks a project the way the decks list does (`?project=`, first project when
 * absent) under the admin frame and gets the entry table under the chart; a
 * foreman or viewer arrives from their own project's GS screen with the id in
 * the path, under the field theme, and gets the chart alone. RV5-28 puts the
 * write with the admin; RV5-29 puts the read with all three.
 *
 * The assembly lives here rather than in `KpiDashboard`, which stays
 * presentational: one place turns the work model, the event log and the stored
 * windows into the two shapes its children take.
 */

/** One coat of the project, with the (work, deck) scope its figures come from. */
interface Coat {
  stageId: string
  workId: string
  deckId: string
  workName: string
  deckName: string
  stageName: string
  /** The work's quantity and unit (RV6-35), carried to the table and the chart. */
  quantityLabel: string
  unit: string
  /** The coat's seq, which is what `remainingAreaOn` measures against. */
  seq: number
  scope: DeckPlanScope
  /** This coat's rows out of its scope's `actualByDay`. */
  actual: ActualStageDay[]
}

/**
 * Every coat of every bays work, each with the scope and the actual series it
 * needs. A manual work has no bays and no coats, so it has nothing to plan.
 *
 * `actualByDay` is called ONCE per (work, deck) and its rows handed out to that
 * deck's coats, rather than once per coat: it computes every coat of the scope
 * on each call, and calling it per coat would be quadratic in the coats of a
 * deck for no extra information.
 *
 * Events are matched to a deck by NAME. `DeckEvent` carries `deckName` and not
 * a deck id -- `cell_events` denormalises the name so a deleted deck's history
 * survives -- so a project-wide event list can only be grouped that way. It is
 * the same compromise `ProductivityDashboard` makes with its Sàn filter; deck
 * names are unique within a project in practice, and a renamed deck's older
 * events fall out of its own scope rather than into another's.
 */
function coatsOf(models: WorkModel[], events: DeckEvent[]): Coat[] {
  const coats: Coat[] = []
  for (const model of [...models].sort((a, b) => a.work.seq - b.work.seq)) {
    if (model.work.kind !== 'bays') continue
    for (const entry of model.decks) {
      const scope: DeckPlanScope = {
        workName: model.work.name,
        deck: entry.deck,
        stages: entry.stages,
        events: events.filter((ev) => ev.deckName === entry.deck.name),
      }
      const actual = actualByDay(scope)
      for (const stage of [...entry.stages].sort((a, b) => a.seq - b.seq)) {
        coats.push({
          stageId: stage.id,
          workId: model.work.id,
          deckId: entry.deck.id,
          workName: model.work.name,
          deckName: entry.deck.name,
          stageName: stage.name,
          quantityLabel: model.work.quantityLabel,
          unit: model.work.unit,
          seq: stage.seq,
          scope,
          actual: actual.filter((r) => r.stageId === stage.id),
        })
      }
    }
  }
  return coats
}

type Loaded =
  | {
      projectId: string
      models: WorkModel[]
      /** Every deck with its KPI colours (RV6-29): the chart's filter and the admin's colour table read the same list. */
      decks: DeckKpiColorRow[]
      events: DeckEvent[]
      plans: StoredStagePlan[]
    }
  | { projectId: string; error: string }

function useKpiData(projectId: string | null) {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (projectId === null) return
    let cancelled = false
    Promise.all([loadProjectModel(projectId), listProjectEvents(projectId), listStagePlans(projectId)])
      .then(([model, events, plans]) => {
        if (cancelled) return
        setLoaded({
          projectId,
          models: model.models,
          decks: model.decks.map((d) => ({
            id: d.id, name: d.name, kpiPlanColor: d.kpiPlanColor, kpiActualColor: d.kpiActualColor,
          })),
          events,
          plans,
        })
      })
      .catch((e: Error) => {
        if (!cancelled) setLoaded({ projectId, error: e.message })
      })
    return () => {
      cancelled = true
    }
  }, [projectId, attempt])

  const current = loaded !== null && loaded.projectId === projectId ? loaded : null
  return { current, reload: () => setAttempt((n) => n + 1) }
}

function Body({ projectId, variant }: { projectId: string | null; variant: 'admin' | 'gs' }) {
  const { current, reload } = useKpiData(projectId)
  const { message } = App.useApp()
  const [saving, setSaving] = useState(false)

  /**
   * Today, in Vietnam, as the one day key the whole app agrees on (RV5-20). It
   * decides which of `remainingAreaOn`'s two sources answers, so it is read
   * once per render of this body rather than per coat: a render that straddled
   * midnight would otherwise measure two coats against two different days.
   */
  const todayKey = effortDayKey(new Date().toISOString())

  const loadedData = current !== null && !('error' in current) ? current : null
  const coats = useMemo(
    () => (loadedData === null ? [] : coatsOf(loadedData.models, loadedData.events)),
    [loadedData],
  )
  const planByStage = useMemo(
    () => new Map((loadedData?.plans ?? []).map((p) => [p.stageId, p])),
    [loadedData],
  )
  const coatByStage = useMemo(() => new Map(coats.map((c) => [c.stageId, c])), [coats])

  /**
   * The chart's scope is the coats that HAVE a window. A coat the admin has not
   * planned has no planned area, so it would add nothing to the denominator
   * RV5-26 divides by while its actual m² inflated the numerator -- the actual
   * curve would then read above a plan that never included it. The entry table
   * is where an unplanned coat is visible.
   */
  const entries: KpiEntry[] = useMemo(
    () =>
      coats.flatMap((c) => {
        const plan = planByStage.get(c.stageId)
        if (plan === undefined) return []
        return [{
          deckId: c.deckId,
          deckName: c.deckName,
          unit: c.unit,
          plan,
          computedAreaM2: remainingAreaOn(c.scope, c.seq, plan.startDate, todayKey),
          actual: c.actual,
        }]
      }),
    [coats, planByStage, todayKey],
  )

  const tableRows: StagePlanRow[] = useMemo(
    () =>
      coats.map((c) => ({
        stageId: c.stageId,
        workId: c.workId,
        deckId: c.deckId,
        workName: c.workName,
        deckName: c.deckName,
        stageName: c.stageName,
        quantityLabel: c.quantityLabel,
        unit: c.unit,
        plan: planByStage.get(c.stageId) ?? null,
      })),
    [coats, planByStage],
  )

  /**
   * RV5-23's default, recomputed for whichever start date the admin currently
   * has in the picker -- the figure is the deck's state AS OF that day, so it
   * moves with the date rather than being fixed when the row was drawn.
   */
  const computedAreaFor = useCallback(
    (row: StagePlanRow, startDate: string | null) => {
      const coat = coatByStage.get(row.stageId)
      if (coat === undefined || startDate === null) return 0
      return remainingAreaOn(coat.scope, coat.seq, startDate, todayKey)
    },
    [coatByStage, todayKey],
  )

  const onSave = useCallback(
    async (row: StagePlanRow, window: StagePlanWindow) => {
      setSaving(true)
      try {
        await saveStagePlan({
          stageId: row.stageId,
          workId: row.workId,
          deckId: row.deckId,
          startDate: window.startDate,
          endDate: window.endDate,
          plannedAreaM2: window.plannedAreaM2,
        })
        message.success(`Đã lưu kế hoạch ${row.stageName} · ${row.deckName}`)
        reload()
      } catch (e) {
        message.error((e as Error).message)
      } finally {
        setSaving(false)
      }
    },
    [message, reload],
  )

  const onClearArea = useCallback(
    async (stageId: string) => {
      setSaving(true)
      try {
        await clearStagePlanArea(stageId)
        message.success('Đã trả diện tích kế hoạch về số hệ thống tự tính')
        reload()
      } catch (e) {
        message.error((e as Error).message)
      } finally {
        setSaving(false)
      }
    },
    [message, reload],
  )

  /**
   * RV6-28: written on change, no save step, then reloaded so the chart below
   * paints the colour the admin just chose from the row that was actually
   * stored -- the same read-back the plan writes above do.
   */
  const onColors = useCallback(
    async (deckId: string, colors: DeckKpiColors) => {
      setSaving(true)
      try {
        await setDeckKpiColors(deckId, colors)
        reload()
      } catch (e) {
        message.error((e as Error).message)
      } finally {
        setSaving(false)
      }
    },
    [message, reload],
  )

  if (projectId === null) {
    return <Alert type="info" message="Chọn một dự án để xem KPI" />
  }
  if (current === null) {
    return <Spin style={{ display: 'block', margin: '15vh auto' }} />
  }
  if ('error' in current) {
    return (
      <Alert
        type="error"
        showIcon
        message="Không tải được số liệu KPI"
        description={current.error}
        action={<Button size="small" onClick={reload}>Thử lại</Button>}
      />
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/*
        The chart first (UX-01): it is the reason for the screen, and the plan
        table under it runs to 20+ rows -- above the chart it pushed the answer
        below the fold on every visit.
      */}
      <KpiDashboard entries={entries} decks={current.decks} todayKey={todayKey} />
      {/* The write is the admin's alone (RV5-28): the field gets the chart. */}
      {variant === 'admin' && (
        <StagePlanTable
          rows={tableRows}
          computedAreaFor={computedAreaFor}
          onSave={onSave}
          onClearArea={onClearArea}
          saving={saving}
        />
      )}
      {/* RV6-28: the chart's colours per deck, admin-only like the plan table. */}
      {variant === 'admin' && (
        <DeckKpiColorTable decks={current.decks} onChange={onColors} saving={saving} />
      )}
    </div>
  )
}

function AdminKpi() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [projects, setProjects] = useState<Array<{ id: string; name: string; code: string }>>([])
  const [chosen, setChosen] = useState<string | null>(null)
  const [listError, setListError] = useState<string | null>(null)

  useEffect(() => {
    listProjectNames()
      .then(setProjects)
      .catch((e: Error) => setListError(e.message))
  }, [])

  // `?project=` wins when it names a project that exists, as on the decks list
  // and on the Năng suất screen; otherwise the first project. Derived, not
  // copied into state, so a refreshed list cannot clobber a choice.
  const requested = searchParams.get('project')
  const projectId = chosen
    ?? (projects.some((p) => p.id === requested) ? requested : null)
    ?? projects[0]?.id
    ?? null
  const project = projects.find((p) => p.id === projectId)

  return (
    <>
      <PageHeader
        title="KPI"
        subtitle={
          project
            ? `${project.name} · kế hoạch so với thực hiện theo ngày`
            : 'Chọn một dự án'
        }
        filters={(
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            <label htmlFor="kpi-project" style={{ fontSize: 11, fontWeight: 600, color: palette.textTertiary }}>
              Dự án
            </label>
            <Select
              id="kpi-project"
              style={{ width: 260 }}
              value={projectId ?? undefined}
              placeholder="Chọn dự án"
              options={projects.map((p) => ({ value: p.id, label: `${p.name} (${p.code})` }))}
              onChange={(v) => {
                setChosen(v)
                setSearchParams({ project: v }, { replace: true })
              }}
            />
          </div>
        )}
      />
      <PageBody>
        {listError && <Alert type="error" showIcon message="Không tải được danh sách dự án" description={listError} />}
        <Body projectId={projectId} variant="admin" />
      </PageBody>
    </>
  )
}

function FieldKpi() {
  const { projectId } = useParams()
  const navigate = useNavigate()
  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Layout.Header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          paddingInline: 16,
          background: palette.bgContainer,
          borderBottom: `1px solid ${palette.borderCard}`,
          boxShadow: shadowCard,
          height: 'auto',
          lineHeight: 'normal',
          paddingBlock: 10,
        }}
      >
        <Button
          icon={<ArrowLeftOutlined aria-hidden />}
          onClick={() => navigate(`${APP_BASE_PATH}/gs/${projectId}`)}
        >
          Về bản vẽ
        </Button>
        <span style={{ fontWeight: 600, fontSize: 16 }}>KPI</span>
      </Layout.Header>
      <Layout.Content style={{ padding: 16 }}>
        <Body projectId={projectId ?? null} variant="gs" />
      </Layout.Content>
    </Layout>
  )
}

export function KpiScreen({ variant }: { variant: 'admin' | 'gs' }) {
  return variant === 'admin' ? <AdminKpi /> : <FieldKpi />
}
