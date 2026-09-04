import { Alert, Button, Spin } from 'antd'
import type { ReactNode } from 'react'
import { NotFound } from '../screens/NotFound'
import { useAuth, type Role } from './AuthProvider'
import { LoginScreen } from './LoginScreen'

export function RequireRole({
  role,
  roles,
  children,
}: {
  /**
   * Omit both to require only an active, signed-in profile of any role -- used
   * by the base-path index route, which reads the role itself to decide where
   * to send each account rather than gating on one fixed role.
   */
  role?: Role
  /** Several roles share a screen: the GS route admits gs and viewer (0028). */
  roles?: Role[]
  children: ReactNode
}) {
  const allowed = roles ?? (role ? [role] : null)
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
  if (profileError) {
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
  // which paths exist. When `role` is omitted, any active profile passes:
  // the caller (the base-path index route) reads profile.role itself.
  if (!profile || !profile.active || (allowed && !allowed.includes(profile.role))) {
    return <NotFound />
  }
  return <>{children}</>
}
