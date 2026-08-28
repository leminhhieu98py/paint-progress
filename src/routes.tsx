import { Alert, Spin } from 'antd'
import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './auth/AuthProvider'
import { RequireRole } from './auth/RequireRole'
import { APP_BASE_PATH } from './config'
import { myFirstProjectId } from './lib/projectsApi'
import { NotFound } from './screens/NotFound'

// Every screen behind a role gate is React.lazy, and for two different reasons.
// The admin screens pull in pdf.js and Konva (and, from Phase 4, ExcelJS), which
// a foreman must never download. The GS screen pulls in Konva and recharts,
// which nobody should download to look at the LOGIN form -- and login is the
// one screen everybody loads first, on a site tether. Only the login screen
// (reached through RequireRole) and IndexRedirect stay eager: they are the
// latency-critical paths this split exists to protect. The GS pays one chunk
// round trip immediately after signing in, while already committed to opening a
// drawing.
//
// This REVERSES the Phase 2 decision that kept the GS route eager, recorded in
// the comment this replaces. That decision was right while the GS route was a
// one-line placeholder and wrong the moment it became a Konva canvas and a
// chart: eager stopped meaning "the GS pays nothing" and started meaning
// "everyone pays, at the login form". Changed deliberately, not drifted.
const AdminLayout = lazy(() =>
  import('./screens/admin/AdminLayout').then((m) => ({ default: m.AdminLayout })),
)
const ProjectsScreen = lazy(() =>
  import('./screens/admin/ProjectsScreen').then((m) => ({ default: m.ProjectsScreen })),
)
const DecksScreen = lazy(() =>
  import('./screens/admin/DecksScreen').then((m) => ({ default: m.DecksScreen })),
)
const DeckDetailScreen = lazy(() =>
  import('./screens/admin/DeckDetailScreen').then((m) => ({ default: m.DeckDetailScreen })),
)
const UsersScreen = lazy(() =>
  import('./screens/admin/UsersScreen').then((m) => ({ default: m.UsersScreen })),
)
const GsScreen = lazy(() =>
  import('./screens/gs/GsScreen').then((m) => ({ default: m.GsScreen })),
)

function LazySuspense({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<Spin style={{ display: 'block', margin: '25vh auto' }} />}>
      {children}
    </Suspense>
  )
}

/**
 * The base-path index route used to be pinned to `RequireRole role="admin"`,
 * so a GS who signed in successfully at the base path saw the bare 404 --
 * only a deep link to their own /gs/:projectId ever worked. This reads the
 * real role and sends each to their own landing spot instead.
 */
/**
 * Where a signed-in profile belongs.
 *
 * Shared by `/` and `/login` so the two cannot disagree about where an admin or
 * a foreman lands. Renders its own explanation for the two cases a GS can be in
 * that are not a destination -- no membership, or a failed read -- because both
 * follow valid credentials and neither is an authorisation failure.
 */
function RoleHome() {
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
      <Route path={APP_BASE_PATH || '/'}>
        {/*
          The memorable entry point. `RequireRole` with no role renders the login
          form for a stranger and passes an active profile through, so signing in
          here re-renders this same route WITH a session and RoleHome sends them
          on -- which is the whole of "redirect by role after login". The role is
          already on the profile the auth context loads; nothing new is fetched.
        */}
        <Route
          path="login"
          element={
            <RequireRole>
              <RoleHome />
            </RequireRole>
          }
        />
        <Route
          index
          element={
            <RequireRole>
              <RoleHome />
            </RequireRole>
          }
        />
        <Route
          path="admin"
          element={
            <RequireRole role="admin">
              <LazySuspense>
                <AdminLayout />
              </LazySuspense>
            </RequireRole>
          }
        >
          <Route index element={<Navigate to="users" replace />} />
          <Route
            path="users"
            element={
              <LazySuspense>
                <UsersScreen />
              </LazySuspense>
            }
          />
          <Route
            path="projects"
            element={
              <LazySuspense>
                <ProjectsScreen />
              </LazySuspense>
            }
          />
          <Route
            path="decks"
            element={
              <LazySuspense>
                <DecksScreen />
              </LazySuspense>
            }
          />
          {/*
            The deck's own address. `new` is a deck that does not exist yet and
            takes the project it will belong to from the query, so a reload of
            the create form keeps it.
          */}
          <Route
            path="decks/:deckId"
            element={
              <LazySuspense>
                <DeckDetailScreen />
              </LazySuspense>
            }
          />
        </Route>
        <Route
          path="gs/:projectId"
          element={
            <RequireRole role="gs">
              <LazySuspense>
                <GsScreen />
              </LazySuspense>
            </RequireRole>
          }
        />
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}
