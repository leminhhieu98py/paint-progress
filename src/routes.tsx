import { Navigate, Route, Routes } from 'react-router-dom'
import { RequireRole } from './auth/RequireRole'
import { APP_BASE_PATH } from './config'
import { NotFound } from './screens/NotFound'
import { AdminLayout } from './screens/admin/AdminLayout'
import { DecksScreen } from './screens/admin/DecksScreen'
import { ProjectsScreen } from './screens/admin/ProjectsScreen'
import { UsersScreen } from './screens/admin/UsersScreen'

const Placeholder = ({ name }: { name: string }) => <div>{name} — chưa làm</div>

export function AppRoutes() {
  return (
    <Routes>
      <Route path={APP_BASE_PATH}>
        <Route index element={<RequireRole role="admin"><Navigate to={`${APP_BASE_PATH}/admin/users`} replace /></RequireRole>} />
        <Route
          path="admin"
          element={
            <RequireRole role="admin">
              <AdminLayout />
            </RequireRole>
          }
        >
          <Route index element={<Navigate to="users" replace />} />
          <Route path="users" element={<UsersScreen />} />
          <Route path="projects" element={<ProjectsScreen />} />
          <Route path="decks" element={<DecksScreen />} />
          <Route path="progress" element={<Placeholder name="Tiến độ" />} />
        </Route>
        <Route
          path="gs/:projectId"
          element={
            <RequireRole role="gs">
              <Placeholder name="GS" />
            </RequireRole>
          }
        />
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}
