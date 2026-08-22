import { Spin } from 'antd'
import type { ReactNode } from 'react'
import { NotFound } from '../screens/NotFound'
import { useAuth } from './AuthProvider'
import { LoginScreen } from './LoginScreen'

export function RequireRole({ role, children }: { role: 'admin' | 'gs'; children: ReactNode }) {
  const { session, profile, loading } = useAuth()

  if (loading) {
    return <Spin style={{ display: 'block', margin: '25vh auto' }} />
  }
  if (!session) {
    return <LoginScreen />
  }
  // A signed-in account with the wrong role, no profile, or a deactivated
  // profile gets the same bare 404 as a stranger — no information leak about
  // which paths exist.
  if (!profile || !profile.active || profile.role !== role) {
    return <NotFound />
  }
  return <>{children}</>
}
