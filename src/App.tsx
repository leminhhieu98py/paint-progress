import { App as AntApp, ConfigProvider } from 'antd'
import viVN from 'antd/locale/vi_VN'
import { BrowserRouter } from 'react-router-dom'
import { AuthProvider } from './auth/AuthProvider'
import { ErrorBoundary } from './ErrorBoundary'
import { AppRoutes } from './routes'
import { adminTheme } from './theme'

/**
 * The admin theme is the base for the whole app -- the login form and the error
 * boundary belong to neither surface, and the admin one is the denser of the
 * two, so anything unstyled inherits the tighter default. The GS route nests
 * its own ConfigProvider over this one.
 */
export default function App() {
  return (
    <ConfigProvider locale={viVN} theme={adminTheme}>
      <AntApp>
        <BrowserRouter>
          <AuthProvider>
            <ErrorBoundary>
              <AppRoutes />
            </ErrorBoundary>
          </AuthProvider>
        </BrowserRouter>
      </AntApp>
    </ConfigProvider>
  )
}
