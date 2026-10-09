import { SettingOutlined } from '@ant-design/icons'
import { Alert, Button, Layout, Segmented, Spin, Tabs } from 'antd'
import { useEffect, useRef, useState, type ComponentType, type ReactNode } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../auth/AuthProvider'
import { EmptyState } from '../../components/EmptyState'
import { FilterBar } from '../../components/FilterBar'
import { FilterSheet } from '../../components/FilterSheet'
import { PageBody, PageHeader } from '../../components/PageHeader'
import { ProjectSelect } from '../../components/ProjectSelect'
import { SectionCard } from '../../components/SectionCard'
import { APP_BASE_PATH } from '../../config'
import { effortDayKey } from '../../domain/effort'
import type { PipingSettings, ViewMode } from '../../domain/piping/types'
import { listProjectNames } from '../../lib/projectsApi'
import { space } from '../../theme'
import { carryFilters, clearCarried, peekCarried } from '../gs/fieldCarry'
import { FieldLayout } from '../gs/FieldLayout'
import { FieldProjectSelect } from '../gs/FieldProjectSelect'
import { useFieldPhone } from '../gs/fieldSections'
import { useFieldProjectCode } from '../gs/useFieldProjectCode'
import { EnablePipingModal } from './EnablePipingModal'
import { InsulationPanel } from './InsulationPanel'
import { InsulationUnitProvider } from './insulationUnit'
import { ManpowerPanel } from './ManpowerPanel'
import type { PipingPanelProps, PipingRole } from './panelProps'
import { PipingConfigModal } from './PipingConfigModal'
import { knownPipingEnabled, readPipingSettings } from './pipingEnabled'
import { PipingExportAction } from './PipingExportAction'
import { ReinstatementPanel } from './ReinstatementPanel'

/**
 * The Piping page (spec §11), one body under two frames as KpiScreen does:
 * the admin picks a project (`?project=`, the first when absent) under the
 * admin frame and configures the module; a foreman or viewer arrives with the
 * project in the path, under the field shell, and reads it (a foreman enters
 * actuals in the panels).
 *
 * The page owns the project, its settings, the Ngày | Tuần view, the tab and
 * today; each tab panel owns its own data (`PipingPanelProps`).
 */

const TABS: ReadonlyArray<{ key: PipingTab; label: string; Panel: ComponentType<PipingPanelProps> }> = [
  { key: 'reinstatement', label: 'Reinstatement', Panel: ReinstatementPanel },
  { key: 'manpower', label: 'Manpower', Panel: ManpowerPanel },
  { key: 'insulation', label: 'Insulation', Panel: InsulationPanel },
]

type PipingTab = 'reinstatement' | 'manpower' | 'insulation'

const NOT_ENABLED = 'Dự án này chưa bật Piping'

const VIEW_LABEL: Record<ViewMode, string> = { day: 'Ngày', week: 'Tuần' }

type Loaded =
  | { projectId: string; settings: PipingSettings | null }
  | { projectId: string; error: string }

/** The project's settings, re-read on `reload`; the last answer stays on screen while a re-read runs. */
function usePipingSettings(projectId: string | null) {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (projectId === null) return
    let cancelled = false
    readPipingSettings(projectId)
      .then((settings) => {
        if (!cancelled) setLoaded({ projectId, settings })
      })
      .catch((e: Error) => {
        if (!cancelled) setLoaded({ projectId, error: e.message })
      })
    return () => {
      cancelled = true
    }
  }, [projectId, attempt])

  const current = loaded !== null && loaded.projectId === projectId ? loaded : null
  const stored = current !== null && 'settings' in current ? current.settings : null
  return {
    current,
    /**
     * Whether the module's controls belong in the bar: 'on', 'off' (no
     * project, Piping off, or a failed read), or 'pending' while the project's
     * settings are read -- the controls then stay in place, disabled.
     */
    state: (projectId === null ? 'off' : current === null ? 'pending' : stored?.enabled === true ? 'on' : 'off') as BarState,
    /** The stored settings, enabled or not; null when never enabled or not read. */
    stored,
    /** The settings when Piping is on: the page shows its panels only then. */
    enabled: stored?.enabled === true ? stored : null,
    reload: () => setAttempt((n) => n + 1),
  }
}

type BarState = 'on' | 'off' | 'pending'

type SettingsData = ReturnType<typeof usePipingSettings>

/** Today in Vietnam, read once per render of the page so every panel measures against one day. */
const today = () => effortDayKey(new Date().toISOString())

/** Ngày | Tuần: a view toggle, the one place a Segmented is allowed (FLT-07). */
function ViewToggle({ value, onChange, block = false, disabled = false }: {
  value: ViewMode
  onChange: (mode: ViewMode) => void
  block?: boolean
  disabled?: boolean
}) {
  return (
    <Segmented<ViewMode>
      aria-label="Xem theo"
      value={value}
      block={block}
      disabled={disabled}
      onChange={onChange}
      options={[{ value: 'day', label: VIEW_LABEL.day }, { value: 'week', label: VIEW_LABEL.week }]}
    />
  )
}

/** The export action, at the right end of the bar (GS-09). */
function BarEnd({ children }: { children: ReactNode }) {
  return <div style={{ marginLeft: 'auto', display: 'flex', gap: space.sm }}>{children}</div>
}

function PipingBody({ projectId, variant, data, panel, tab, onTab, onEnable }: {
  projectId: string | null
  variant: 'admin' | 'gs'
  data: SettingsData
  panel: PipingPanelProps | null
  tab: PipingTab
  onTab: (tab: PipingTab) => void
  onEnable: () => void
}) {
  const { current, reload } = data
  if (projectId === null) return <Alert type="info" message="Chọn một dự án để xem Piping" />
  if (current === null) return <Spin style={{ display: 'block', margin: '15vh auto' }} />
  if ('error' in current) {
    return (
      <Alert
        type="error"
        showIcon
        message="Không tải được cấu hình Piping"
        description={current.error}
        action={<Button onClick={reload}>Thử lại</Button>}
      />
    )
  }
  if (panel === null) {
    // Enabling is the admin's (spec §1); the field is told, not offered it.
    return variant === 'admin'
      ? (
        <SectionCard>
          <EmptyState
            title={NOT_ENABLED}
            action={<Button type="primary" onClick={onEnable}>Bật Piping</Button>}
          />
        </SectionCard>
      )
      : <SectionCard><EmptyState title={NOT_ENABLED} /></SectionCard>
  }
  return (
    <Tabs
      activeKey={tab}
      onChange={(key) => onTab(key as PipingTab)}
      items={TABS.map(({ key, label, Panel }) => ({ key, label, children: <Panel {...panel} /> }))}
    />
  )
}

function AdminPiping() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [projects, setProjects] = useState<Array<{ id: string; name: string; code: string }>>([])
  const [chosen, setChosen] = useState<string | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [listSettled, setListSettled] = useState(false)
  const [mode, setMode] = useState<ViewMode>('day')
  const [tab, setTab] = useState<PipingTab>('reinstatement')
  const [enabling, setEnabling] = useState(false)
  const [configuring, setConfiguring] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    listProjectNames()
      .then(setProjects)
      .catch((e: Error) => setListError(e.message))
      .finally(() => setListSettled(true))
  }, [])

  // As on KPI: `?project=` when it names a project, else the first one; derived, not copied.
  const requested = searchParams.get('project')
  const projectId = chosen
    ?? (projects.some((p) => p.id === requested) ? requested : null)
    ?? projects[0]?.id
    ?? null
  const data = usePipingSettings(projectId)
  const todayKey = today()
  const panel: PipingPanelProps | null = projectId !== null && data.enabled !== null
    ? { projectId, settings: data.enabled, mode, variant: 'admin', role: 'admin', todayKey, refreshKey }
    : null
  // The module's controls stay in place while a read runs (the project list's included), disabled.
  const showControls = data.state !== 'off' || (projectId === null && !listSettled)

  const chooseProject = (id: string) => {
    setChosen(id)
    setConfiguring(false)
    setSearchParams({ project: id }, { replace: true })
  }

  return (
    <>
      <PageHeader
        title="Piping"
        extra={showControls && (
          <Button icon={<SettingOutlined aria-hidden />} disabled={panel === null} onClick={() => setConfiguring(true)}>
            Cấu hình
          </Button>
        )}
        filters={(
          <FilterBar>
            <ProjectSelect projects={projects} value={projectId} onChange={chooseProject} />
            {showControls && <ViewToggle value={mode} onChange={setMode} disabled={panel === null} />}
            {showControls && <BarEnd><PipingExportAction panel={panel} variant="admin" /></BarEnd>}
          </FilterBar>
        )}
      />
      <PageBody>
        {listError && <Alert type="error" showIcon message="Không tải được danh sách dự án" description={listError} />}
        <PipingBody
          projectId={projectId}
          variant="admin"
          data={data}
          panel={panel}
          tab={tab}
          onTab={setTab}
          onEnable={() => setEnabling(true)}
        />
      </PageBody>
      {enabling && projectId !== null && (
        <EnablePipingModal
          projectId={projectId}
          stored={data.stored}
          onCancel={() => setEnabling(false)}
          onEnabled={() => {
            setEnabling(false)
            data.reload()
          }}
        />
      )}
      {configuring && panel && (
        <PipingConfigModal
          projectId={panel.projectId}
          projectName={projects.find((p) => p.id === panel.projectId)?.name ?? ''}
          settings={panel.settings}
          onClose={() => setConfiguring(false)}
          onChanged={() => {
            setRefreshKey((n) => n + 1)
            data.reload()
          }}
          onDisabled={() => {
            setConfiguring(false)
            data.reload()
          }}
        />
      )}
    </>
  )
}

const CARRY_PAGE = 'piping'

/** What a project switch carries to the next project's Piping page (I-1). */
interface CarriedView {
  mode: ViewMode
  tab: PipingTab
}

function FieldPiping({ projectId }: { projectId: string | null }) {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const [carried] = useState(() => peekCarried<CarriedView>(CARRY_PAGE, projectId))
  useEffect(() => clearCarried(CARRY_PAGE, projectId), [projectId])
  const [mode, setMode] = useState<ViewMode>(carried?.mode ?? 'day')
  const [tab, setTab] = useState<PipingTab>(carried?.tab ?? 'reinstatement')
  const data = usePipingSettings(projectId)
  const phone = useFieldPhone()
  const projectCode = useFieldProjectCode(projectId)
  const role: PipingRole = profile?.role === 'viewer' ? 'viewer' : 'gs'
  const todayKey = today()
  const panel: PipingPanelProps | null = projectId !== null && data.enabled !== null
    ? { projectId, settings: data.enabled, mode, variant: 'gs', role, todayKey, refreshKey: 0 }
    : null

  // The last project picked, and whether this page is still on screen: a read
  // that answers after another pick, or after the user has left, opens nothing.
  const latestPick = useRef<string | null>(null)
  const onScreen = useRef(true)
  useEffect(() => {
    onScreen.current = true
    return () => {
      onScreen.current = false
    }
  }, [])
  const [switching, setSwitching] = useState(false)

  const open = (id: string, on: boolean) => {
    if (on) carryFilters(CARRY_PAGE, id, { mode, tab } satisfies CarriedView)
    navigate(on ? `${APP_BASE_PATH}/gs/${id}/piping` : `${APP_BASE_PATH}/gs/${id}`)
  }

  /**
   * Another project: its Piping page, on what is applied here, when it has
   * Piping on; its Sàn page when it has not, rather than a page with nothing
   * to show. At once when the session knows; otherwise after one read, the
   * select spinning meanwhile. A failed read still opens its Piping page,
   * which says so.
   */
  const chooseProject = (id: string) => {
    if (id === projectId) {
      latestPick.current = null
      setSwitching(false)
      return
    }
    latestPick.current = id
    const known = knownPipingEnabled(id)
    if (known !== undefined) {
      open(id, known)
      return
    }
    setSwitching(true)
    readPipingSettings(id)
      .then((target) => target?.enabled === true)
      .catch(() => true)
      .then((on) => {
        if (!onScreen.current || latestPick.current !== id) return
        setSwitching(false)
        open(id, on)
      })
  }

  const showControls = data.state !== 'off'
  const projectSelect = (block: boolean) => projectId && (
    <FieldProjectSelect
      projectId={projectId}
      width={block ? '100%' : undefined}
      onChange={chooseProject}
      pending={switching}
    />
  )
  const toggle = (block: boolean) => showControls && (
    <ViewToggle value={mode} onChange={setMode} block={block} disabled={panel === null} />
  )
  const exportAction = showControls && <PipingExportAction panel={panel} variant="gs" />
  // FLT-04: what is applied, in one line -- the project's code, then the view once the module is shown;
  // nothing (no empty button) while neither is known.
  const summary = [projectCode, showControls ? VIEW_LABEL[mode] : undefined].filter((p) => p !== undefined).join(' · ')
    || undefined

  return (
    <FieldLayout projectId={projectId}>
      <Layout.Content style={{ padding: space.lg, display: 'flex', flexDirection: 'column', gap: space.lg }}>
        {phone ? (
          // FLT-04: one row -- what is applied and Bộ lọc, the project and the view in its sheet -- then the export.
          <div style={{ display: 'flex', alignItems: 'center', gap: space.md, minWidth: 0 }}>
            <div style={{ flex: '1 1 auto', minWidth: 0 }}>
              <FilterSheet count={mode === 'week' ? 1 : 0} summary={summary}>
                {projectSelect(true)}
                {toggle(true)}
              </FilterSheet>
            </div>
            {exportAction}
          </div>
        ) : (
          <FilterBar>
            {projectSelect(false)}
            {toggle(false)}
            {exportAction && <BarEnd>{exportAction}</BarEnd>}
          </FilterBar>
        )}
        <PipingBody
          projectId={projectId}
          variant="gs"
          data={data}
          panel={panel}
          tab={tab}
          onTab={setTab}
          onEnable={() => {}}
        />
      </Layout.Content>
    </FieldLayout>
  )
}

export function PipingScreen({ variant }: { variant: 'admin' | 'gs' }) {
  // Keyed by the path's project, as KpiScreen is: another project mounts afresh on what the switch carried.
  const { projectId } = useParams()
  // The Insulation unit is the page's, so the export writes the one on screen (spec §10).
  return (
    <InsulationUnitProvider>
      {variant === 'admin'
        ? <AdminPiping />
        : <FieldPiping key={projectId} projectId={projectId ?? null} />}
    </InsulationUnitProvider>
  )
}
