import { Alert, Button, Layout, Spin } from 'antd'
import { useEffect, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { settleDraft, useDraftFilters, useProjectOptions } from '../../components/draftFilters'
import { FilterBar } from '../../components/FilterBar'
import { FilterSheet } from '../../components/FilterSheet'
import { PageBody, PageHeader } from '../../components/PageHeader'
import { ProjectSelect } from '../../components/ProjectSelect'
import type { DeckEvent, WorkModel } from '../../domain/types'
import { listProjectEvents, loadProjectModel } from '../../lib/progressApi'
import { listDecks } from '../../lib/decksApi'
import { listProjectNames } from '../../lib/projectsApi'
import { listWorks } from '../../lib/worksApi'
import { FieldLayout } from '../gs/FieldLayout'
import { space } from '../../theme'
import { FieldProjectSelect } from '../gs/FieldProjectSelect'
import { carryFilters, clearCarried, peekCarried } from '../gs/fieldCarry'
import { useFieldPhone } from '../gs/fieldSections'
import { useFieldProjectName } from '../gs/useFieldProjectName'
import { APP_BASE_PATH } from '../../config'
import { ProductivityDashboard } from './ProductivityDashboard'
import { ProductivityFilterControls } from './ProductivityFilterControls'
import {
  DEFAULT_PRODUCTIVITY_FILTERS, dashboardWorkNames, productivityFilterCount, productivitySummary, type ProductivityFilters,
} from './productivityFilters'

/**
 * The route-level half of the productivity dashboard (Feedback Rv2, item 12).
 *
 * Two variants over one body. The admin picks a project the way the decks
 * list does (`?project=`, first project when absent) under the admin frame;
 * a foreman or viewer arrives from their own project's GS screen with the id
 * in the path, under the field theme and the field header (GS-01).
 * The data is the same two reads either way, and RLS decides what each role
 * sees of it.
 */

type Loaded =
  | { projectId: string; models: WorkModel[]; decks: { id: string; name: string }[]; events: DeckEvent[] }
  | { projectId: string; error: string }

function useProjectData(projectId: string | null) {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (projectId === null) return
    let cancelled = false
    Promise.all([loadProjectModel(projectId), listProjectEvents(projectId)])
      .then(([model, events]) => {
        if (cancelled) return
        setLoaded({
          projectId,
          models: model.models,
          decks: model.decks.map((d) => ({ id: d.id, name: d.name })),
          events,
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
  return { current, retry: () => setAttempt((n) => n + 1) }
}

type Data = ReturnType<typeof useProjectData>

interface FilterOptions {
  workNames: string[]
  deckNames: string[]
}

const NO_OPTIONS: FilterOptions = { workNames: [], deckNames: [] }

/**
 * The bar's options for the loaded project: its works (with the ones only its
 * events remember) and decks. Null while it loads, or after a failed read:
 * unknown, so no draft is reconciled against it.
 */
function filterOptions(current: Data['current']): FilterOptions | null {
  if (current === null || 'error' in current) return null
  return {
    workNames: dashboardWorkNames(current.models, current.events),
    deckNames: current.decks.map((d) => d.name),
  }
}

/**
 * The bar's options for a DRAFT project the screen has not loaded (FLT-02):
 * two light reads, its bays works in seq order and its decks. A renamed or
 * deleted work that only the project's events remember joins the Công việc
 * switch once Tìm has loaded that history (accepted: Tìm must not wait on a
 * scan of the history).
 */
async function loadFilterOptions(projectId: string): Promise<FilterOptions> {
  const [works, decks] = await Promise.all([listWorks(projectId), listDecks(projectId)])
  return {
    workNames: works.filter((w) => w.kind === 'bays').sort((a, b) => a.seq - b.seq).map((w) => w.name),
    deckNames: decks.map((d) => d.name),
  }
}

/**
 * The draft as the options have it: a Sàn the draft project does not have is
 * Tất cả sàn again, and a work it does not have is its first work (FLT-02).
 */
function settle<T extends ProductivityFilters>(draft: T, options: FilterOptions): T {
  return {
    ...draft,
    work: draft.work !== null && options.workNames.includes(draft.work) ? draft.work : null,
    deck: options.deckNames.includes(draft.deck) ? draft.deck : '',
  }
}

/** The admin bar's draft: the project (null is the one in the address) and the dashboard's filters. */
type AdminScope = ProductivityFilters & { project: string | null }
const DEFAULT_ADMIN_SCOPE: AdminScope = { project: null, ...DEFAULT_PRODUCTIVITY_FILTERS }

function Body({
  projectId,
  data: { current, retry },
  filters,
  version,
}: {
  projectId: string | null
  data: Data
  filters: ProductivityFilters
  /** Counts the bar's applies, so the tables go back to page 1 on each (FLT-02). */
  version: number
}) {
  if (projectId === null) {
    return <Alert type="info" message="Chọn một dự án để xem năng suất" />
  }
  if (current === null) {
    return <Spin style={{ display: 'block', margin: '15vh auto' }} />
  }
  if ('error' in current) {
    return (
      <Alert
        type="error"
        showIcon
        message="Không tải được số liệu năng suất"
        description={current.error}
        action={<Button onClick={retry}>Thử lại</Button>}
      />
    )
  }
  return <ProductivityDashboard events={current.events} models={current.models} filters={filters} version={version} />
}

function AdminDashboard() {
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

  // `?project=` wins when it names a project that exists, as on the decks
  // list; otherwise the first project. Derived, not copied into state, so a
  // refreshed list cannot clobber a choice.
  const requested = searchParams.get('project')
  const projectId = chosen
    ?? (projects.some((p) => p.id === requested) ? requested : null)
    ?? projects[0]?.id
    ?? null
  const data = useProjectData(projectId)

  // The options follow the DRAFT (FLT-02): the loaded project's own, or a
  // light read of the project picked but not yet applied.
  // Between Tìm and the full data arriving, the light read made while the
  // project was a draft still answers for it. Tìm waits while the options it
  // would reconcile against are still loading.
  const draftProject = scope.draft.project ?? projectId
  const other = useProjectOptions(draftProject === projectId ? null : draftProject, loadFilterOptions)
  const options = draftProject === projectId
    ? filterOptions(data.current) ?? other.cached(projectId)
    // A failed read settles against "nothing": Tìm then applies Tất cả for
    // the new project instead of carrying the old project's choice across.
    : other.error !== null ? NO_OPTIONS : other.options
  const loading = draftProject === projectId ? projectId !== null && data.current === null : other.loading
  const draft = settleDraft(scope, options, settle)

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
        title="Năng suất"
        filters={(
          // One bar, the project first (FLT-01); a draft until Tìm (FLT-02).
          <FilterBar onApply={apply} onReset={scope.reset} applyLoading={loading}>
            <ProjectSelect
              projects={projects}
              value={draftProject}
              onChange={(v) => scope.setDraft({ project: v })}
            />
            <ProductivityFilterControls
              {...(options ?? NO_OPTIONS)}
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
        <Body projectId={projectId} data={data} filters={scope.applied} version={scope.version} />
      </PageBody>
    </>
  )
}

/** The field bar's draft: the project (null is the route's) and the dashboard's filters (I-1). */
type FieldScope = ProductivityFilters & { project: string | null }
const DEFAULT_FIELD_SCOPE: FieldScope = { project: null, ...DEFAULT_PRODUCTIVITY_FILTERS }
const CARRY_PAGE = 'dashboard'

function FieldDashboard({ projectId }: { projectId: string | null }) {
  const navigate = useNavigate()
  // Opened by a Tìm on another project's page: start on what it applied (I-1).
  const [carried] = useState(() => peekCarried<ProductivityFilters>(CARRY_PAGE, projectId))
  useEffect(() => clearCarried(CARRY_PAGE, projectId), [projectId])
  const scope = useDraftFilters(DEFAULT_FIELD_SCOPE, carried ? { ...carried, project: null } : DEFAULT_FIELD_SCOPE)
  const data = useProjectData(projectId)

  // The options follow the DRAFT project, as on the admin page (FLT-02): the
  // route project's own, or a light read of the one picked but not applied.
  const draftProject = scope.draft.project ?? projectId
  const other = useProjectOptions(draftProject === projectId ? null : draftProject, loadFilterOptions)
  const options = draftProject === projectId
    ? filterOptions(data.current)
    : other.error !== null ? NO_OPTIONS : other.options
  const loading = draftProject === projectId ? data.current === null : other.loading
  const draft = settleDraft(scope, options, settle)
  const phone = useFieldPhone()
  const projectName = useFieldProjectName(projectId)
  // What is applied is the route project's: its works name the summary's work.
  const appliedWorks = (filterOptions(data.current) ?? NO_OPTIONS).workNames

  const apply = () => {
    if (draftProject !== null && draftProject !== projectId) {
      // Another project: its page, on the draft as settled against its options.
      const { project: _project, ...filters } = draft
      carryFilters(CARRY_PAGE, draftProject, filters)
      navigate(`${APP_BASE_PATH}/gs/${draftProject}/dashboard`)
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
      <ProductivityFilterControls
        {...(options ?? NO_OPTIONS)}
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
            summary={productivitySummary(projectName, scope.applied, appliedWorks)}
            count={productivityFilterCount(scope.applied, appliedWorks)}
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
        <Body projectId={projectId} data={data} filters={scope.applied} version={scope.version} />
      </Layout.Content>
    </FieldLayout>
  )
}

export function DashboardScreen({ variant }: { variant: 'admin' | 'gs' }) {
  // Keyed by the path's project: Tìm on another project changes it on this
  // page, and the fresh mount opens on what that Tìm carried (I-1), never on
  // the last project's state.
  const { projectId } = useParams()
  return variant === 'admin'
    ? <AdminDashboard />
    : <FieldDashboard key={projectId} projectId={projectId ?? null} />
}
