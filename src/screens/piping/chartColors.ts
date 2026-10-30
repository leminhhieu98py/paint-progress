import { HEX_COLOR } from '../../components/ColorField'
import { MILESTONES, milestoneActualLabel, milestonePlanLabel } from '../../domain/piping/cam'
import type { ManpowerGroup, Milestone } from '../../domain/piping/types'
import { palette } from '../../theme'
import { KPI_COLOR_DEFAULTS } from '../dashboard/kpiColors'

/**
 * The Piping charts' colours per project (RV8-2): one series key per colour
 * the admin may pick in Cấu hình, its default, and its name there. A key with
 * no stored colour, or a stored value that is not `#rrggbb`, takes its
 * default -- the colour the chart drew before the admin could pick, so
 * nothing changes until one is picked. The charts on screen and the report's
 * pictures read the same resolved map.
 */

/** Every key resolved to a colour: what a chart reads. */
export type ChartColors = Readonly<Record<string, string>>

/** One Manpower group's colour: its Plan and Actual bars derive from it. */
export const groupColorKey = (groupId: string): string => `mp.group.${groupId}`

/** One Insulation milestone × kind: its bar and its cumulative line share it. */
export const insulationColorKey = (milestone: Milestone, kind: 'plan' | 'actual'): string => `ins.${milestone}.${kind}`

/** The milestone's colour as drawn before RV8-2: Plan and Actual alike. */
const MILESTONE_DEFAULT: Record<Milestone, string> = {
  ph: palette.categorical[0],
  ih: palette.categorical[2],
  iw: palette.categorical[6],
}

/** The keys that do not depend on the project's groups, with their default and their name in Cấu hình. */
const REINSTATEMENT: Array<[string, string, string]> = [
  ['rein.planBar', KPI_COLOR_DEFAULTS.plan, 'Plan theo ngày/tuần'],
  ['rein.actualBar', KPI_COLOR_DEFAULTS.actual, 'Actual theo ngày/tuần'],
  ['rein.planCum', palette.textTertiary, 'Plan lũy kế'],
  ['rein.actualCum', palette.accentHover, 'Actual lũy kế'],
]
const MANPOWER_TOTALS: Array<[string, string, string]> = [
  ['mp.planTotal', palette.textTertiary, 'Plan tổng'],
  ['mp.actualTotal', palette.ink, 'Actual tổng'],
  ['mp.planAvg', palette.warning, 'Avg Plan'],
]
const INSULATION: Array<[string, string, string]> = MILESTONES.flatMap((m): Array<[string, string, string]> => [
  [insulationColorKey(m, 'plan'), MILESTONE_DEFAULT[m], milestonePlanLabel(m)],
  [insulationColorKey(m, 'actual'), MILESTONE_DEFAULT[m], milestoneActualLabel(m)],
])

/**
 * The full map: the stored colour where it is a `#rrggbb`, else the default.
 * A group's default is the palette's hue at its place in `groups` -- the
 * chart's own list (`chartGroups`), whose order picks the hue.
 */
export function resolveChartColors(stored: Readonly<Record<string, string>>, groups: readonly ManpowerGroup[]): ChartColors {
  const pick = (key: string, fallback: string) => {
    const c = stored[key]
    return typeof c === 'string' && HEX_COLOR.test(c) ? c : fallback
  }
  const out: Record<string, string> = {}
  for (const [key, fallback] of [...REINSTATEMENT, ...MANPOWER_TOTALS, ...INSULATION]) out[key] = pick(key, fallback)
  groups.forEach((g, i) => {
    out[groupColorKey(g.id)] = pick(groupColorKey(g.id), palette.categorical[i % palette.categorical.length])
  })
  return out
}

export interface ChartColorSection {
  title: string
  rows: Array<{ key: string; label: string }>
}

/** Cấu hình's "Màu biểu đồ": the keys per chart, each named; one Manpower row per group, a hidden one marked. */
export function chartColorSections(groups: readonly ManpowerGroup[]): ChartColorSection[] {
  const rows = (list: Array<[string, string, string]>) => list.map(([key, , label]) => ({ key, label }))
  return [
    { title: 'Reinstatement', rows: rows(REINSTATEMENT) },
    {
      title: 'Manpower',
      rows: [
        ...groups.map((g) => ({ key: groupColorKey(g.id), label: g.hidden ? `${g.name} (ẩn)` : g.name })),
        ...rows(MANPOWER_TOTALS),
      ],
    },
    { title: 'Insulation', rows: rows(INSULATION) },
  ]
}
