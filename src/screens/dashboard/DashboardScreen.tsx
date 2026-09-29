import { ArrowLeftOutlined } from '@ant-design/icons'
import { Alert, Button, Layout, Spin } from 'antd'
import { useEffect, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { settleDraft, useDraftFilters, useProjectOptions } from '../../components/draftFilters'
import { FilterBar } from '../../components/FilterBar'
import { PageBody, PageHeader } from '../../components/PageHeader'
import { ProjectSelect } from '../../components/ProjectSelect'
import { APP_BASE_PATH } from '../../config'
import type { DeckEvent, WorkModel } from '../../domain/types'
import { listProjectEventWorkNames, listProjectEvents, loadProjectModel } from '../../lib/progressApi'
import { listDecks } from '../../lib/decksApi'
import { listProjectNames } from '../../lib/projectsApi'
import { listWorks } from '../../lib/worksApi'
import { palette, shadowCard } from '../../theme'
import { ProductivityDashboard } from './ProductivityDashboard'
import { ProductivityFilterControls } from './ProductivityFilterControls'
import { DEFAULT_PRODUCTIVITY_FILTERS, dashboardWorkNames, type ProductivityFilters } from './productivityFilters'

/**
 * The route-level half of the productivity dashboard (Feedback Rv2, item 12).
 *
 * Two variants over one body. The admin picks a project the way the decks
 * list does (`?project=`, first project when absent) under the admin frame;
 * a foreman or viewer arrives from their own project's GS screen with the id
 * in the path, under the field theme, and gets a button back to the drawing.
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
 * light reads that give the same works `dashboardWorkNames` will show once it
 * is applied -- the bays works in seq order, then the names only its events
 * remember -- and its decks.
 */
async function loadFilterOptions(projectId: string): Promise<FilterOptions> {
  const [works, eventWorks, decks] = await Promise.all([
    listWorks(projectId), listProjectEventWorkNames(projectId), listDecks(projectId),
  ])
  const workNames = works.filter((w) => w.kind === 'bays').sort((a, b) => a.seq - b.seq).map((w) => w.name)
  for (const name of eventWorks) if (!workNames.includes(name)) workNames.push(name)
  return { workNames, deckNames: decks.map((d) => d.name) }
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
        action={<Button size="small" onClick={retry}>Thử lại</Button>}
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
    : other.options
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
        <Body projectId={projectId} data={data} filters={scope.applied} version={scope.version} />
      </PageBody>
    </>
  )
}

function FieldDashboard() {
  const { projectId } = useParams()
  const navigate = useNavigate()
  const scope = useDraftFilters(DEFAULT_PRODUCTIVITY_FILTERS)
  const data = useProjectData(projectId ?? null)
  const options = filterOptions(data.current)
  const draft = settleDraft(scope, options, settle)
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
        <span style={{ fontWeight: 600, fontSize: 16 }}>Năng suất</span>
      </Layout.Header>
      <Layout.Content style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* The field's bar, first under the title bar (FLT-01 via GS-04). */}
        <FilterBar onApply={() => scope.apply(draft)} onReset={scope.reset} applyLoading={data.current === null}>
          <ProductivityFilterControls {...(options ?? NO_OPTIONS)} value={draft} onChange={scope.setDraft} />
        </FilterBar>
        <Body projectId={projectId ?? null} data={data} filters={scope.applied} version={scope.version} />
      </Layout.Content>
    </Layout>
  )
}

export function DashboardScreen({ variant }: { variant: 'admin' | 'gs' }) {
  return variant === 'admin' ? <AdminDashboard /> : <FieldDashboard />
}
