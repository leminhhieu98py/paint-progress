import { Alert, Button, Layout, Spin } from 'antd'
import { useEffect, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { settleFilters, useAppliedFilters } from '../../components/appliedFilters'
import { FilterBar } from '../../components/FilterBar'
import { FilterSheet } from '../../components/FilterSheet'
import { PageBody, PageHeader } from '../../components/PageHeader'
import { ProjectSelect } from '../../components/ProjectSelect'
import type { DeckEvent, WorkModel } from '../../domain/types'
import { listProjectEvents, loadProjectModel } from '../../lib/progressApi'
import { listProjectNames } from '../../lib/projectsApi'
import { FieldLayout } from '../gs/FieldLayout'
import { space } from '../../theme'
import { FieldProjectSelect } from '../gs/FieldProjectSelect'
import { carryFilters, clearCarried, peekCarried } from '../gs/fieldCarry'
import { useFieldPhone } from '../gs/fieldSections'
import { useFieldProjectCode } from '../gs/useFieldProjectCode'
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
 * unknown, so nothing applied is reconciled against it.
 */
function filterOptions(current: Data['current']): FilterOptions | null {
  if (current === null || 'error' in current) return null
  return {
    workNames: dashboardWorkNames(current.models, current.events),
    deckNames: current.decks.map((d) => d.name),
  }
}

/**
 * What is applied as the options have it: a Sàn the project does not have is
 * Tất cả sàn again, and a work it does not have is its first work.
 */
function settle(applied: ProductivityFilters, options: FilterOptions): ProductivityFilters {
  return {
    ...applied,
    work: applied.work !== null && options.workNames.includes(applied.work) ? applied.work : null,
    deck: options.deckNames.includes(applied.deck) ? applied.deck : '',
  }
}

function Body({
  projectId,
  data: { current, retry },
  filters,
  version,
}: {
  projectId: string | null
  data: Data
  filters: ProductivityFilters
  /** Counts the bar's applies, so the tables go back to page 1 on each (RV7-3). */
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
  const scope = useAppliedFilters(DEFAULT_PRODUCTIVITY_FILTERS)

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

  // Every control applies as it changes (RV7-3). Another project reads its
  // data at once; once its options arrive, what it lacks is settled away.
  const options = filterOptions(data.current)
  const filters = settleFilters(scope, options, settle)

  const chooseProject = (id: string) => {
    setChosen(id)
    setSearchParams({ project: id }, { replace: true })
  }

  return (
    <>
      <PageHeader
        title="Năng suất"
        filters={(
          // One bar, the project first (FLT-01); each control applies on change (RV7-3).
          <FilterBar>
            <ProjectSelect projects={projects} value={projectId} onChange={chooseProject} />
            <ProductivityFilterControls {...(options ?? NO_OPTIONS)} value={filters} onChange={scope.apply} />
          </FilterBar>
        )}
      />
      <PageBody>
        {listError && <Alert type="error" showIcon message="Không tải được danh sách dự án" description={listError} />}
        <Body projectId={projectId} data={data} filters={filters} version={scope.version} />
      </PageBody>
    </>
  )
}

const CARRY_PAGE = 'dashboard'

function FieldDashboard({ projectId }: { projectId: string | null }) {
  const navigate = useNavigate()
  // Opened by a project switch on another project's page: start on what it applied (I-1).
  const [carried] = useState(() => peekCarried<ProductivityFilters>(CARRY_PAGE, projectId))
  useEffect(() => clearCarried(CARRY_PAGE, projectId), [projectId])
  const scope = useAppliedFilters(carried ?? DEFAULT_PRODUCTIVITY_FILTERS)
  const data = useProjectData(projectId)

  // As on the admin page: each control applies on change (RV7-3), settled
  // against the route project's options once they arrive.
  const options = filterOptions(data.current)
  const filters = settleFilters(scope, options, settle)
  const phone = useFieldPhone()
  const projectCode = useFieldProjectCode(projectId)
  const works = (options ?? NO_OPTIONS).workNames

  /** Another project: its page, at once, on what is applied here; it settles them against its own options. */
  const chooseProject = (id: string) => {
    carryFilters(CARRY_PAGE, id, filters)
    navigate(`${APP_BASE_PATH}/gs/${id}/dashboard`)
  }

  /** The bar's controls, full width in the phone's sheet (FLT-04). */
  const controls = (block: boolean) => (
    <>
      {projectId && (
        <FieldProjectSelect projectId={projectId} width={block ? '100%' : undefined} onChange={chooseProject} />
      )}
      <ProductivityFilterControls {...(options ?? NO_OPTIONS)} block={block} value={filters} onChange={scope.apply} />
    </>
  )

  return (
    // GS-06: the field header is the way between the pages; no back button (GS-02).
    <FieldLayout projectId={projectId}>
      <Layout.Content style={{ padding: space.lg, display: 'flex', flexDirection: 'column', gap: space.lg }}>
        {/*
          The field's bar, first under the header, the project first (GS-07),
          each control applied as it changes (RV7-3, I-1). On a phone, one row
          -- what is applied, and Bộ lọc -- and the controls in a sheet (FLT-04).
        */}
        {phone ? (
          <FilterSheet summary={productivitySummary(projectCode, filters, works)} count={productivityFilterCount(filters, works)}>
            {controls(true)}
          </FilterSheet>
        ) : (
          <FilterBar>{controls(false)}</FilterBar>
        )}
        <Body projectId={projectId} data={data} filters={filters} version={scope.version} />
      </Layout.Content>
    </FieldLayout>
  )
}

export function DashboardScreen({ variant }: { variant: 'admin' | 'gs' }) {
  // Keyed by the path's project: picking another project changes it on this
  // page, and the fresh mount opens on what that pick carried (I-1), never on
  // the last project's state.
  const { projectId } = useParams()
  return variant === 'admin'
    ? <AdminDashboard />
    : <FieldDashboard key={projectId} projectId={projectId ?? null} />
}
