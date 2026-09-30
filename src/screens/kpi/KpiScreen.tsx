import { Alert, App, Button, Layout, Spin } from 'antd'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { settleDraft, useDraftFilters, useProjectOptions } from '../../components/draftFilters'
import { FilterBar } from '../../components/FilterBar'
import { FilterSheet } from '../../components/FilterSheet'
import { PageBody, PageHeader } from '../../components/PageHeader'
import { ProjectSelect } from '../../components/ProjectSelect'
import { effortDayKey } from '../../domain/effort'
import {
  actualByDay, remainingAreaOn, type ActualStageDay, type DeckPlanScope,
} from '../../domain/kpi'
import type { DeckEvent, WorkModel } from '../../domain/types'
import {
  clearStagePlanArea, listStagePlans, saveStagePlan, type StoredStagePlan,
} from '../../lib/kpiApi'
import { listDecks, setDeckKpiColors } from '../../lib/decksApi'
import { listProjectEvents, loadProjectModel } from '../../lib/progressApi'
import { listProjectNames } from '../../lib/projectsApi'
import { FieldLayout } from '../gs/FieldLayout'
import { useFieldPhone } from '../gs/fieldSections'
import { useFieldProjectCode } from '../gs/useFieldProjectCode'
import { space } from '../../theme'
import { FieldProjectSelect } from '../gs/FieldProjectSelect'
import { carryFilters, clearCarried, peekCarried } from '../gs/fieldCarry'
import { APP_BASE_PATH } from '../../config'
import { DeckKpiColorTable, type DeckKpiColorRow, type DeckKpiColors } from './DeckKpiColorTable'
import { KpiDashboard, type KpiEntry } from './KpiDashboard'
import { KpiFilterControls } from './KpiFilterControls'
import {
  ALL, DEFAULT_KPI_FILTERS, kpiCoatOptions, kpiFilterCount, kpiSummary, resolveCoat, type KpiFilters, type PlannedCoat,
} from './kpiFilters'
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

/**
 * What the loaded project assembles into: the coats, their plans, and the
 * planned coats the chart and the filter bar's Công đoạn options read. Held by
 * the page rather than the body, because the bar lives in the page header
 * (FLT-01).
 */
function useKpiEntries(current: Loaded | null) {
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

  return { todayKey, coats, planByStage, coatByStage, entries }
}

type KpiData = ReturnType<typeof useKpiData>
type KpiModel = ReturnType<typeof useKpiEntries>

/** What the bar's Sàn and Công đoạn options are built from. */
interface FilterOptions {
  decks: { id: string; name: string }[]
  coats: PlannedCoat[]
}

const NO_OPTIONS: FilterOptions = { decks: [], coats: [] }

/** The bar's options for the loaded project: its decks, and the coats the chart can show. */
/**
 * The bar's options for the loaded project. Null while it loads, or after a
 * failed read: unknown, so no draft is reconciled against it.
 */
function filterOptions(current: Loaded | null, entries: KpiEntry[]): FilterOptions | null {
  if (current === null || 'error' in current) return null
  return {
    decks: current.decks,
    coats: entries.map((e) => ({ deckId: e.deckId, workName: e.plan.workName, stageName: e.plan.stageName })),
  }
}

/** The bar's options for a DRAFT project the screen has not loaded (FLT-02): two light reads. */
async function loadFilterOptions(projectId: string): Promise<FilterOptions> {
  const [decks, plans] = await Promise.all([listDecks(projectId), listStagePlans(projectId)])
  return {
    decks: decks.map((d) => ({ id: d.id, name: d.name })),
    coats: plans.map((p) => ({ deckId: p.deckId, workName: p.workName, stageName: p.stageName })),
  }
}

/**
 * The draft as the options have it (FLT-02): a Sàn the draft project does not
 * have is Tất cả sàn again, and a Công đoạn the draft Sàn does not have is
 * Tất cả công đoạn.
 */
function settle<T extends KpiFilters>(draft: T, options: FilterOptions): T {
  const deckId = options.decks.some((d) => d.id === draft.deckId) ? draft.deckId : ALL
  return { ...draft, deckId, coat: resolveCoat(draft.coat, kpiCoatOptions(options.coats, deckId)) }
}

/** The admin bar's draft: the project (null is the one in the address) and the chart's scope. */
type AdminScope = KpiFilters & { project: string | null }
const DEFAULT_ADMIN_SCOPE: AdminScope = { project: null, ...DEFAULT_KPI_FILTERS }

function Body({
  projectId,
  variant,
  data: { current, reload },
  model: { todayKey, coats, planByStage, coatByStage, entries },
  filters,
  version = 0,
}: {
  projectId: string | null
  variant: 'admin' | 'gs'
  data: KpiData
  model: KpiModel
  filters: KpiFilters
  /** Counts the bar's applies: the plan table's page and drafts start over on each (M10). */
  version?: number
}) {
  const { message } = App.useApp()
  const [saving, setSaving] = useState(false)

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
        action={<Button onClick={reload}>Thử lại</Button>}
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
      <KpiDashboard
        entries={entries}
        decks={current.decks}
        todayKey={todayKey}
        filters={filters}
        emptyDescription={variant === 'admin' ? 'Admin nhập kế hoạch ở bảng Kế hoạch KPI theo công đoạn.' : undefined}
      />
      {/* The write is the admin's alone (RV5-28): the field gets the chart. */}
      {variant === 'admin' && (
        <StagePlanTable
          rows={tableRows}
          computedAreaFor={computedAreaFor}
          onSave={onSave}
          onClearArea={onClearArea}
          saving={saving}
          scopeKey={`${projectId}|${version}`}
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
  const scope = useDraftFilters(DEFAULT_ADMIN_SCOPE)

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
  const data = useKpiData(projectId)
  const model = useKpiEntries(data.current)

  // The options follow the DRAFT (FLT-02): the loaded project's own, or a
  // light read of the project picked but not yet applied.
  // Between Tìm and the full data arriving, the light read made while the
  // project was a draft still answers for it. Tìm waits while the options it
  // would reconcile against are still loading.
  const draftProject = scope.draft.project ?? projectId
  const other = useProjectOptions(draftProject === projectId ? null : draftProject, loadFilterOptions)
  const options = draftProject === projectId
    ? filterOptions(data.current, model.entries) ?? other.cached(projectId)
    // A failed read settles against "nothing": Tìm then applies Tất cả for
    // the new project instead of carrying the old project's choice across.
    : other.error !== null ? NO_OPTIONS : other.options
  const loading = draftProject === projectId ? projectId !== null && data.current === null : other.loading
  const draft = settleDraft(scope, options, settle)
  const shown = options ?? NO_OPTIONS

  const apply = () => {
    if (draftProject !== null && draftProject !== projectId) {
      setChosen(draftProject)
      setSearchParams({ project: draftProject }, { replace: true })
    }
    scope.apply({ ...draft, project: null })
  }

  return (
    <>
      <PageHeader
        title="KPI"
        filters={(
          // One bar, the project first (FLT-01); a draft until Tìm (FLT-02).
          <FilterBar onApply={apply} onReset={scope.reset} applyLoading={loading}>
            <ProjectSelect
              projects={projects}
              value={draftProject}
              onChange={(v) => scope.setDraft({ project: v })}
            />
            <KpiFilterControls
              decks={shown.decks}
              coats={kpiCoatOptions(shown.coats, draft.deckId)}
              value={draft}
              onChange={(next) => scope.setDraft({ ...next, project: scope.draft.project })}
            />
          </FilterBar>
        )}
      />
      <PageBody>
        {listError && <Alert type="error" showIcon message="Không tải được danh sách dự án" description={listError} />}
        {draftProject !== projectId && other.error !== null && (
          <Alert type="error" showIcon message="Không tải được bộ lọc của dự án" description={other.error} />
        )}
        <Body projectId={projectId} variant="admin" data={data} model={model} filters={scope.applied} version={scope.version} />
      </PageBody>
    </>
  )
}

/** The field bar's draft: the project (null is the route's) and the chart's scope (I-1). */
const DEFAULT_FIELD_SCOPE: AdminScope = DEFAULT_ADMIN_SCOPE
const CARRY_PAGE = 'kpi'

function FieldKpi({ projectId }: { projectId: string | null }) {
  const navigate = useNavigate()
  // Opened by a Tìm on another project's page: start on what it applied (I-1).
  const [carried] = useState(() => peekCarried<KpiFilters>(CARRY_PAGE, projectId))
  useEffect(() => clearCarried(CARRY_PAGE, projectId), [projectId])
  const scope = useDraftFilters(DEFAULT_FIELD_SCOPE, carried ? { ...carried, project: null } : DEFAULT_FIELD_SCOPE)
  const data = useKpiData(projectId)
  const model = useKpiEntries(data.current)

  // The options follow the DRAFT project, as on the admin page (FLT-02).
  const draftProject = scope.draft.project ?? projectId
  const other = useProjectOptions(draftProject === projectId ? null : draftProject, loadFilterOptions)
  const options = draftProject === projectId
    ? filterOptions(data.current, model.entries)
    : other.error !== null ? NO_OPTIONS : other.options
  const loading = draftProject === projectId ? data.current === null : other.loading
  const draft = settleDraft(scope, options, settle)
  const shown = options ?? NO_OPTIONS
  const phone = useFieldPhone()
  const projectCode = useFieldProjectCode(projectId)
  // What is applied is the route project's: its decks and coats name the summary.
  const applied = filterOptions(data.current, model.entries) ?? NO_OPTIONS
  const appliedCoats = kpiCoatOptions(applied.coats, scope.applied.deckId)

  const apply = () => {
    if (draftProject !== null && draftProject !== projectId) {
      // Another project: its page, on the draft as settled against its options.
      const { project: _project, ...filters } = draft
      carryFilters(CARRY_PAGE, draftProject, filters)
      navigate(`${APP_BASE_PATH}/gs/${draftProject}/kpi`)
      return
    }
    scope.apply({ ...draft, project: null })
  }

  /** The bar's controls, full width in the phone's sheet (FLT-04). */
  const controls = (block: boolean) => (
    <>
      {projectId && (
        <FieldProjectSelect
          projectId={projectId}
          width={block ? '100%' : undefined}
          value={draftProject ?? undefined}
          onChange={(v) => scope.setDraft({ project: v })}
        />
      )}
      <KpiFilterControls
        decks={shown.decks}
        coats={kpiCoatOptions(shown.coats, draft.deckId)}
        block={block}
        value={draft}
        onChange={(next) => scope.setDraft({ ...next, project: scope.draft.project })}
      />
    </>
  )

  return (
    // GS-06: the field header is the way between the pages; no back button (GS-02).
    <FieldLayout projectId={projectId}>
      <Layout.Content style={{ padding: space.lg, display: 'flex', flexDirection: 'column', gap: space.lg }}>
        {/*
          The field's bar, first under the header, the project first (GS-07),
          all of it a draft until Tìm (FLT-02, I-1). On a phone, one row --
          what is applied, and Bộ lọc -- and the controls in a sheet (FLT-04).
        */}
        {phone ? (
          <FilterSheet
            summary={kpiSummary(projectCode, scope.applied, applied.decks, appliedCoats)}
            count={kpiFilterCount(scope.applied, appliedCoats)}
            onApply={apply}
            onReset={scope.reset}
            // Closed without Tìm: the draft goes back to what is applied (FLT-09).
            onDiscard={() => scope.setDraft(scope.applied)}
            applyLoading={loading}
          >
            {controls(true)}
          </FilterSheet>
        ) : (
          <FilterBar onApply={apply} onReset={scope.reset} applyLoading={loading}>
            {controls(false)}
          </FilterBar>
        )}
        {draftProject !== projectId && other.error !== null && (
          <Alert type="error" showIcon message="Không tải được bộ lọc của dự án" description={other.error} />
        )}
        <Body projectId={projectId} variant="gs" data={data} model={model} filters={scope.applied} />
      </Layout.Content>
    </FieldLayout>
  )
}

export function KpiScreen({ variant }: { variant: 'admin' | 'gs' }) {
  // Keyed by the path's project, as DashboardScreen is: Tìm on another project
  // changes it on this page, and the fresh mount opens on what that Tìm
  // carried (I-1), never on the last project's state.
  const { projectId } = useParams()
  return variant === 'admin'
    ? <AdminKpi />
    : <FieldKpi key={projectId} projectId={projectId ?? null} />
}
