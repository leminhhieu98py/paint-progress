import { Alert, Button, Spin } from 'antd'
import type { ReactNode } from 'react'
import { NotFound } from '../screens/NotFound'
import { useAuth } from './AuthProvider'
import { LoginScreen } from './LoginScreen'

export function RequireRole({ role, children }: { role: 'admin' | 'gs'; children: ReactNode }) {
  const { session, profile, loading, profileError } = useAuth()

  if (loading) {
    return <Spin style={{ display: 'block', margin: '25vh auto' }} />
  }
  if (!session) {
    return <LoginScreen />
  }
  // A profile read failure is not an authorisation failure — the credentials
  // were fine, the network wasn't. Telling the two apart leaks nothing, since
  // both already require valid credentials to reach this point.
  if (session && profileError) {
    return (
      <div style={{ maxWidth: 360, margin: '25vh auto' }}>
        <Alert
          type="error"
          message="Không tải được thông tin tài khoản"
          description="Kiểm tra kết nối mạng rồi thử lại."
          action={
            <Button size="small" onClick={() => window.location.reload()}>
              Thử lại
            </Button>
          }
        />
      </div>
    )
  }
  // A signed-in account with the wrong role, no profile, or a deactivated
  // profile gets the same bare 404 as a stranger — no information leak about
  // which paths exist.
  if (!profile || !profile.active || profile.role !== role) {
    return <NotFound />
  }
  return <>{children}</>
}
