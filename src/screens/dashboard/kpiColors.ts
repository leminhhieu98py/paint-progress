import { palette } from '../../theme'

/**
 * The KPI chart's default colour per family (RV6-30): the PLAN bar is the grey
 * family's, the ACTUAL bar the accent family's. Its own module rather than an
 * export of `charts.tsx`, which is components only (fast refresh); shared so
 * the admin's per-deck colour table (RV6-28) shows a deck with no stored
 * colour the colour the chart really paints it, rather than a guess of its own.
 */
export const KPI_COLOR_DEFAULTS = { plan: palette.textQuaternary, actual: palette.accent } as const
