import { Grid } from 'antd'
import { useSyncExternalStore } from 'react'
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

/** Below this a bar control takes the whole row; above it the bar wraps by itself (C2). */
const FULL_WIDTH_QUERY = '(max-width: 479.98px)'

/**
 * Subscribes to the full-width query: module scope, so useSyncExternalStore
 * keeps one subscription across renders (RR-M4) rather than re-subscribing on
 * every GsScreen render. `addListener` where a media list has no
 * `addEventListener`, as antd's own media-query helper still allows.
 */
function subscribeFullWidth(onChange: () => void): () => void {
  const mq = window.matchMedia(FULL_WIDTH_QUERY)
  if (typeof mq.addEventListener === 'function') {
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }
  mq.addListener(onChange)
  return () => mq.removeListener(onChange)
}

const fullWidthNow = () => window.matchMedia(FULL_WIDTH_QUERY).matches
const fullWidthOnServer = () => false

/**
 * A screen too narrow for two bar controls side by side (< 480 px), where each
 * takes the full width. Between 480 and 768 the controls keep their widths and
 * the bar wraps them as they fit. antd's breakpoints have no step here, so it
 * asks the browser directly.
 */
export function useFieldFullWidthControls(): boolean {
  return useSyncExternalStore(subscribeFullWidth, fullWidthNow, fullWidthOnServer)
}
