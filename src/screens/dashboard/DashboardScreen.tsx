import { ArrowLeftOutlined } from '@ant-design/icons'
import { Alert, Button, Layout, Select, Spin } from 'antd'
import { useEffect, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { PageBody, PageHeader } from '../../components/PageHeader'
import { APP_BASE_PATH } from '../../config'
import type { DeckEvent, WorkModel } from '../../domain/types'
import { listProjectEvents, loadProjectModel } from '../../lib/progressApi'
import { listProjectNames } from '../../lib/projectsApi'
import { palette, shadowCard } from '../../theme'
import { ProductivityDashboard } from './ProductivityDashboard'

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

function Body({ projectId }: { projectId: string | null }) {
  const { current, retry } = useProjectData(projectId)
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
  return <ProductivityDashboard events={current.events} models={current.models} decks={current.decks} />
}

function AdminDashboard() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [projects, setProjects] = useState<Array<{ id: string; name: string; code: string }>>([])
  const [chosen, setChosen] = useState<string | null>(null)
  const [listError, setListError] = useState<string | null>(null)

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
  const project = projects.find((p) => p.id === projectId)

  return (
    <>
      <PageHeader
        title="Năng suất"
        subtitle={project ? `${project.name} · Mhr/m² theo công đoạn, theo ngày và theo nhóm trưởng` : 'Chọn một dự án'}
        filters={(
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            <label htmlFor="dashboard-project" style={{ fontSize: 11, fontWeight: 600, color: palette.textTertiary }}>
              Dự án
            </label>
            <Select
              id="dashboard-project"
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
        <Body projectId={projectId} />
      </PageBody>
    </>
  )
}

function FieldDashboard() {
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
        <span style={{ fontWeight: 600, fontSize: 16 }}>Năng suất</span>
      </Layout.Header>
      <Layout.Content style={{ padding: 16 }}>
        <Body projectId={projectId ?? null} />
      </Layout.Content>
    </Layout>
  )
}

export function DashboardScreen({ variant }: { variant: 'admin' | 'gs' }) {
  return variant === 'admin' ? <AdminDashboard /> : <FieldDashboard />
}
