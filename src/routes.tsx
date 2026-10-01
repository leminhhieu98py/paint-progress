import { Alert, ConfigProvider, Spin } from 'antd'
import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './auth/AuthProvider'
import { RequireRole } from './auth/RequireRole'
import { roleHome } from './auth/roleHome'
import { APP_BASE_PATH } from './config'
import { myFirstProjectId } from './lib/projectsApi'
import { NotFound } from './screens/NotFound'
import { NotFoundPage } from './screens/NotFoundPage'
import { fieldTheme } from './theme'

// Every screen behind a role gate is React.lazy, and for two different reasons.
// The admin screens pull in pdf.js and Konva (and, from Phase 4, ExcelJS), which
// a foreman must never download. The GS screen pulls in Konva,
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
const WorksScreen = lazy(() =>
  import('./screens/admin/WorksScreen').then((m) => ({ default: m.WorksScreen })),
)
const DecksScreen = lazy(() =>
  import('./screens/admin/DecksScreen').then((m) => ({ default: m.DecksScreen })),
)
const DeckDetailScreen = lazy(() =>
  import('./screens/admin/DeckDetailScreen').then((m) => ({ default: m.DeckDetailScreen })),
)
// Nhân lực (NL-01): accounts and employees, at the address the users screen had.
const NhanLucScreen = lazy(() =>
  import('./screens/admin/NhanLucScreen').then((m) => ({ default: m.NhanLucScreen })),
)
const GsScreen = lazy(() =>
  import('./screens/gs/GsScreen').then((m) => ({ default: m.GsScreen })),
)
// The viewer's landing page (RV6-23): one card per project. Its own chunk so
// the foreman, who never sees it, never downloads it.
const ProjectPickerScreen = lazy(() =>
  import('./screens/gs/ProjectPickerScreen').then((m) => ({ default: m.ProjectPickerScreen })),
)
// Recharts rides in this chunk and nowhere else: the login form and the
// drawing never download it.
const DashboardScreen = lazy(() =>
  import('./screens/dashboard/DashboardScreen').then((m) => ({ default: m.DashboardScreen })),
)
// KPI (Feedback Rv5, item 9) rides its own chunk rather than the dashboard's.
// It shares `screens/dashboard/charts` with the dashboard, so Recharts is in
// whichever of the two is opened first and in neither until then -- the login
// form and the drawing still never download it.
const KpiScreen = lazy(() =>
  import('./screens/kpi/KpiScreen').then((m) => ({ default: m.KpiScreen })),
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

  // Only a foreman lands on a membership. A viewer reads every project since
  // 0034 and holds no project_members row, so it is sent to the picker below
  // and never asks for a first project it does not have.
  const fieldRole = profile?.role === 'gs'
  useEffect(() => {
    if (!fieldRole) return
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
  }, [profile, fieldRole])

  if (profile?.role === 'admin') {
    return <Navigate to={`${APP_BASE_PATH}/admin/projects`} replace />
  }

  // RV6-23: the viewer chooses a project; the picker redirects on its own when
  // there is only one to choose from.
  if (profile?.role === 'viewer') {
    return <Navigate to={`${APP_BASE_PATH}/gs`} replace />
  }

  if (fieldRole) {
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

/**
 * The top-level catch-all (QA F2). A stranger and a deactivated profile keep
 * the bare 404 of spec §7.3; an active account gets told and
 * offered its role's own home, the same page the role gate gives it. Nothing while
 * the session is still being read, so the bare page never flashes before
 * the signed-in one.
 */
function StrayPath() {
  const { session, profile, loading } = useAuth()
  if (loading) return null
  if (!session || !profile?.active) return <NotFound />
  // The role's own home, exactly as the role gate's page links it: the two
  // pages must be identical, or a signed-in account could tell a route that
  // exists behind another role's gate from one that does not exist (N-1).
  return <NotFoundPage home={roleHome(profile.role)} />
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
          <Route index element={<Navigate to="projects" replace />} />
          <Route
            path="users"
            element={
              <LazySuspense>
                <NhanLucScreen />
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
            path="works"
            element={
              <LazySuspense>
                <WorksScreen />
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
          <Route
            path="dashboard"
            element={
              <LazySuspense>
                <DashboardScreen variant="admin" />
              </LazySuspense>
            }
          />
          {/* Its own item in the sidebar, after Năng suất (RV5-28). */}
          <Route
            path="kpi"
            element={
              <LazySuspense>
                <KpiScreen variant="admin" />
              </LazySuspense>
            }
          />
          {/* The staff roster moved into Nhân lực; an old bookmark still lands (NL-01). */}
          <Route path="employees" element={<Navigate to={`${APP_BASE_PATH}/admin/users`} replace />} />
          {/*
            Only an admin reaches this: the gate above gives every other role
            the same not-found page for any /admin path, known or not (QA F2).
          */}
          <Route path="*" element={<NotFoundPage home={`${APP_BASE_PATH}/admin/projects`} inShell />} />
        </Route>
        {/*
          The viewer's project picker (RV6-23). The viewer's alone: a foreman
          lands on their own project from RoleHome and has no list to choose
          from, so the gate gives them the not-found page any wrong role gets.
          The field theme, because it is the same tablet at the same arm's
          length as the screen it leads to.
        */}
        <Route
          path="gs"
          element={
            <RequireRole roles={['viewer']}>
              <ConfigProvider theme={fieldTheme}>
                <LazySuspense>
                  <ProjectPickerScreen />
                </LazySuspense>
              </ConfigProvider>
            </RequireRole>
          }
        />
        <Route
          path="gs/:projectId"
          element={
            <RequireRole roles={['gs', 'viewer']}>
              {/*
                Nested over the app-wide admin theme, and only here: 48px
                controls and a larger base font are right on a tablet held at
                arm's length and wrong on the admin's dense tables. Wrapping
                the route rather than the screen means the GS's modals and
                message popups -- which render through portals -- inherit it
                too.
              */}
              <ConfigProvider theme={fieldTheme}>
                <LazySuspense>
                  <GsScreen />
                </LazySuspense>
              </ConfigProvider>
            </RequireRole>
          }
        />
        {/*
          The field dashboard (Feedback Rv2, item 12): the same roles, the same
          field theme, its own chunk. A sibling rather than a child route so the
          GS screen keeps owning its whole viewport.
        */}
        <Route
          path="gs/:projectId/dashboard"
          element={
            <RequireRole roles={['gs', 'viewer']}>
              <ConfigProvider theme={fieldTheme}>
                <LazySuspense>
                  <DashboardScreen variant="gs" />
                </LazySuspense>
              </ConfigProvider>
            </RequireRole>
          }
        />
        {/*
          The field KPI chart (Feedback Rv5, item 9): a sibling of the field
          dashboard, the same two roles, the same field theme, its own chunk.
          The viewer is in the gate deliberately -- RV5-29: admin writes the
          plan dates, and admin, gs and viewer all read the charts.
        */}
        <Route
          path="gs/:projectId/kpi"
          element={
            <RequireRole roles={['gs', 'viewer']}>
              <ConfigProvider theme={fieldTheme}>
                <LazySuspense>
                  <KpiScreen variant="gs" />
                </LazySuspense>
              </ConfigProvider>
            </RequireRole>
          }
        />
      </Route>
      <Route path="*" element={<StrayPath />} />
    </Routes>
  )
}
