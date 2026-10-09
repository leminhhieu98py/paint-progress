import { Grid } from 'antd'
import { useSyncExternalStore } from 'react'
import { matchPath } from 'react-router-dom'
import { APP_BASE_PATH } from '../../config'

/**
 * The field pages of one project, in the order the tabs show them. The
 * suffix is what follows `/gs/:projectId`, so the project switch can open the
 * same page of the project it chooses. Piping is a per-project module: the
 * header shows its tab only where it is enabled (piping spec §2, R-1).
 */
export const FIELD_SECTIONS = [
  { label: 'Sàn', suffix: '' },
  { label: 'Năng suất', suffix: '/dashboard' },
  { label: 'KPI', suffix: '/kpi' },
  { label: 'Piping', suffix: '/piping' },
] as const

/** The section of the Piping module, shown only for a project with Piping on. */
export const PIPING_SECTION = FIELD_SECTIONS[3]

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

/** Below this a phone is too narrow for two stat cards side by side (MOB-02). */
const NARROW_PHONE_QUERY = '(max-width: 359.98px)'

/**
 * Subscribes to the narrow-phone query: module scope, so useSyncExternalStore
 * keeps one subscription across renders (RR-M4) rather than re-subscribing on
 * every render. `addListener` where a media list has no `addEventListener`,
 * as antd's own media-query helper still allows.
 */
function subscribeNarrowPhone(onChange: () => void): () => void {
  const mq = window.matchMedia(NARROW_PHONE_QUERY)
  if (typeof mq.addEventListener === 'function') {
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }
  mq.addListener(onChange)
  return () => mq.removeListener(onChange)
}

const narrowPhoneNow = () => window.matchMedia(NARROW_PHONE_QUERY).matches
const narrowPhoneOnServer = () => false

/**
 * A phone under 360 px, where the stat cards go one to a row instead of two
 * (MOB-02). antd's breakpoints have no step here, so it asks the browser
 * directly.
 */
export function useFieldNarrowPhone(): boolean {
  return useSyncExternalStore(subscribeNarrowPhone, narrowPhoneNow, narrowPhoneOnServer)
}
