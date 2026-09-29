import { Grid } from 'antd'
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

/**
 * A phone, for the field screens: narrower than antd's `md`, 768 px (GS-06,
 * controller ruling). Below it the tabs are a bottom bar and the page's
 * actions fold into menus; a tablet held portrait (768-1023) keeps the top
 * tabs. The one breakpoint every field screen asks, so they cannot disagree.
 */
export function useFieldPhone(): boolean {
  return !Grid.useBreakpoint().md
}

/** The bottom tab bar's own height, above the device's safe area. */
export const FIELD_TAB_BAR_HEIGHT = 56
/** The device's own inset at the bottom (a home indicator), 0 where there is none. */
export const FIELD_SAFE_AREA_BOTTOM = 'env(safe-area-inset-bottom, 0px)'
/** What the bottom tab bar covers of the page: its height and the safe area under it. */
export const FIELD_TAB_BAR_SPACE = `calc(${FIELD_TAB_BAR_HEIGHT}px + ${FIELD_SAFE_AREA_BOTTOM})`
