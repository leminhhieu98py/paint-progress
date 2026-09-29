import { matchPath } from 'react-router-dom'
import { APP_BASE_PATH } from '../../config'

/**
 * The three field pages of one project, in the order the tabs show them. The
 * suffix is what follows `/gs/:projectId`, so the project switch can open the
 * same page of the project it chooses.
 */
export const FIELD_SECTIONS = [
  { label: 'Sàn', suffix: '' },
  { label: 'Năng suất', suffix: '/dashboard' },
  { label: 'KPI', suffix: '/kpi' },
] as const

export type FieldSection = (typeof FIELD_SECTIONS)[number]

/**
 * The page on screen, read from the route; undefined off the field routes.
 * matchPath, not NavLink's own comparison: NavLink with `end` compares the
 * pathname byte for byte, so a shared `/gs/p1/` or `/gs/p1/kpi/` -- which the
 * routes still match -- lit no tab at all.
 */
export function fieldSectionOf(pathname: string): FieldSection | undefined {
  return FIELD_SECTIONS.find((s) => matchPath(`${APP_BASE_PATH}/gs/:projectId${s.suffix}`, pathname))
}
