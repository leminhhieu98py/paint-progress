import { Alert, Spin } from 'antd'
import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react'
import { Navigate, Route, Routes, useParams } from 'react-router-dom'
import { useAuth } from './auth/AuthProvider'
import { RequireRole } from './auth/RequireRole'
import { APP_BASE_PATH } from './config'
import { myFirstProjectId } from './lib/projectsApi'
import { NotFound } from './screens/NotFound'

// Every admin screen pulls in pdf.js and/or Konva (and, from Phase 4,
// ExcelJS). The GS user is a foreman on a tablet on a site tether: they must
// never pay for that download to look at one drawing and one pie chart. Each
// admin screen is therefore React.lazy, loaded only once its route actually
// matches. The GS route below (Placeholder for now) and the login screen
// (reached through RequireRole) stay eager -- they are the latency-critical
// paths this split exists to protect, and must not gain a chunk round-trip.
const AdminLayout = lazy(() =>
  import('./screens/admin/AdminLayout').then((m) => ({ default: m.AdminLayout })),
)
const ProjectsScreen = lazy(() =>
  import('./screens/admin/ProjectsScreen').then((m) => ({ default: m.ProjectsScreen })),
)
const DecksScreen = lazy(() =>
  import('./screens/admin/DecksScreen').then((m) => ({ default: m.DecksScreen })),
)
const UsersScreen = lazy(() =>
  import('./screens/admin/UsersScreen').then((m) => ({ default: m.UsersScreen })),
)

function AdminSuspense({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<Spin style={{ display: 'block', margin: '25vh auto' }} />}>
      {children}
    </Suspense>
  )
}

const Placeholder = ({ name }: { name: string }) => <div>{name} — chưa làm</div>

/**
 * Phase 3 replaces this with the real GS screen. Rendering the :projectId
 * param (rather than a fixed string) matters now, not just later: it is what
 * lets a test prove the index redirect landed on THIS project's GS route,
 * not merely "some" GS route.
 */
function GsPlaceholder() {
  const { projectId } = useParams()
  return <div>GS — chưa làm (dự án {projectId})</div>
}

/**
 * The base-path index route used to be pinned to `RequireRole role="admin"`,
 * so a GS who signed in successfully at the base path saw the bare 404 --
 * only a deep link to their own /gs/:projectId ever worked. This reads the
 * real role and sends each to their own landing spot instead.
 */
function IndexRedirect() {
  const { profile } = useAuth()
  const [membership, setMembership] = useState<'loading' | 'error' | string | null>('loading')

  useEffect(() => {
    if (profile?.role !== 'gs') return
    let cancelled = false
    myFirstProjectId()
      .then((id) => {
        if (!cancelled) setMembership(id)
      })
      .catch(() => {
        if (!cancelled) setMembership('error')
      })
    return () => {
      cancelled = true
    }
  }, [profile])

  if (profile?.role === 'admin') {
    return <Navigate to={`${APP_BASE_PATH}/admin/projects`} replace />
  }

  if (profile?.role === 'gs') {
    if (membership === 'loading') {
      return <Spin style={{ display: 'block', margin: '25vh auto' }} />
    }
    if (membership === 'error') {
      return (
        <div style={{ maxWidth: 360, margin: '25vh auto' }}>
          <Alert
            type="error"
            message="Không tải được thông tin dự án"
            description="Kiểm tra kết nối mạng rồi thử lại."
          />
        </div>
      )
    }
    if (membership === null) {
      // Credentials are valid -- this is not an authorisation failure, so it
      // gets an explanation instead of the bare 404 a stranger would see.
      return (
        <div style={{ maxWidth: 360, margin: '25vh auto' }}>
          <Alert
            type="info"
            message="Chưa được thêm vào dự án nào"
            description="Tài khoản hợp lệ, nhưng chưa được gán vào dự án nào. Liên hệ quản trị viên để được thêm vào dự án."
          />
        </div>
      )
    }
    return <Navigate to={`${APP_BASE_PATH}/gs/${membership}`} replace />
  }

  return <NotFound />
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path={APP_BASE_PATH}>
        <Route
          index
          element={
            <RequireRole>
              <IndexRedirect />
            </RequireRole>
          }
        />
        <Route
          path="admin"
          element={
            <RequireRole role="admin">
              <AdminSuspense>
                <AdminLayout />
              </AdminSuspense>
            </RequireRole>
          }
        >
          <Route index element={<Navigate to="users" replace />} />
          <Route
            path="users"
            element={
              <AdminSuspense>
                <UsersScreen />
              </AdminSuspense>
            }
          />
          <Route
            path="projects"
            element={
              <AdminSuspense>
                <ProjectsScreen />
              </AdminSuspense>
            }
          />
          <Route
            path="decks"
            element={
              <AdminSuspense>
                <DecksScreen />
              </AdminSuspense>
            }
          />
          <Route path="progress" element={<Placeholder name="Tiến độ" />} />
        </Route>
        <Route
          path="gs/:projectId"
          element={
            <RequireRole role="gs">
              <GsPlaceholder />
            </RequireRole>
          }
        />
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}
