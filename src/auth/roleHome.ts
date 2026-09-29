import { APP_BASE_PATH } from '../config'
import type { Role } from './AuthProvider'

/**
 * Where each role's "Về trang chính" goes. A foreman's home is the base path:
 * RoleHome reads their membership there and sends them to their project.
 */
export function roleHome(role: Role): string {
  if (role === 'admin') return `${APP_BASE_PATH}/admin/projects`
  if (role === 'viewer') return `${APP_BASE_PATH}/gs`
  return APP_BASE_PATH || '/'
}
