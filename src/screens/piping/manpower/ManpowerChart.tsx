import { useMemo } from 'react'
import { Bar, Brush, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { ManpowerPoint } from '../../../domain/piping/manpower'
import type { ManpowerGroup, ViewMode } from '../../../domain/piping/types'
import { formatDayMonth } from '../../../domain/piping/week'
import { MISSING } from '../../../lib/format'
import { categoricalColor, palette, tintColor } from '../../../theme'
import {
  ACTIVE_BAR, ACTIVE_DOT, AXIS, axisTick, legendText, TOOLTIP_SEPARATOR, useLegendHighlight,
} from '../../dashboard/chartKit'
import { formatQty } from '../pipingFormat'

/**
 * Manpower (spec §5): per day or week, the groups stacked once for Plan and
 * once for Actual, the two stacks side by side, with a Plan total and an
 * Actual total line on the same axis. The lines are drawn at the middle of
 * the day or week, between the two stacks; the tooltip reads each total.
 * Week view is an average (R-2): the total lines and the tooltip's week say
 * "trung bình" (spec §3); day view's lines say "theo ngày", as Reinstatement's
 * bars do. Data is `manpowerSeries`' output, flattened for Recharts; nothing
 * here computes a figure. Actual stops at today and the plan runs to its end
 * because the series does.
 *
 * Colours (CHT-01): a group keeps one hue of the categorical palette in both
 * stacks. Actual fills with `categoricalColor` (the hue itself for the first
 * eight groups); Plan fills with a light tint of the hue and carries a 1.5 px
 * outline in the hue, which holds 3:1 on white, so every plan mark has a
 * visible boundary and the plan reads as the outlined stack. The palette has
 * eight hues: past eight groups they repeat, Actual in `categoricalColor`'s
 * lighter lap tints and Plan with a dashed outline, so a plan bar never looks
 * like an actual bar nor like the plan of the group whose hue it shares.
 *
 * The panel's tests replace this module (jsdom gives ResponsiveContainer no
 * size); only the lazily loaded Piping page imports it.
 */

/** How much white the Plan fill mixes into its group's hue. */
const PLAN_TINT = 0.55
/** The Plan outline (CHT-01: the mark's ≥ 3:1 boundary). */
const PLAN_OUTLINE = 1.5
/** Day view opens on the last this many days; the Brush reaches the rest. */
const DAY_WINDOW = 90

const hueOf = (i: number) => palette.categorical[i % palette.categorical.length]
const lapOf = (i: number) => Math.floor(i / palette.categorical.length)

const planKey = (groupId: string) => `plan:${groupId}`
const actualKey = (groupId: string) => `actual:${groupId}`

export function ManpowerChart({ data, groups, mode, report = false }: {
  data: ManpowerPoint[]
  /** The groups to draw, in order (`chartGroups`): their colours follow this order. */
  groups: ManpowerGroup[]
  mode: ViewMode
  /** For the Excel report (spec §10): every bucket with no Brush, on the desktop layout whatever the screen. */
  report?: boolean
}) {
  const { legend, opacity, height, phone } = useLegendHighlight({ desktop: report })
  const tooltips = useMemo(() => new Map(data.map((p) => [p.key, p.tooltip])), [data])
  const rows = useMemo(
    () => data.map((p) => {
      const row: Record<string, string | number | null> = {
        key: p.key, planTotal: p.planTotal, actualTotal: p.actualTotal,
      }
      for (const g of groups) {
        row[planKey(g.id)] = p.plan[g.id] ?? null
        row[actualKey(g.id)] = p.actual[g.id] ?? null
      }
      return row
    }),
    [data, groups],
  )
  const week = mode === 'week'
  const lineSuffix = week ? ' (trung bình)' : ' theo ngày'
  // A long day range opens on its last days: two years of days at once is bars a pixel wide.
  const startIndex = !week && rows.length > DAY_WINDOW ? rows.length - DAY_WINDOW : undefined
  return (
    <div data-testid="manpower-chart" style={{ width: '100%', height: height(372, groups.length * 2 + 2) }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={palette.borderSplit} vertical={false} />
          <XAxis dataKey="key" tickFormatter={(key: string) => formatDayMonth(String(key))} tick={AXIS} />
          <YAxis tick={AXIS} width={phone ? 40 : 56} tickFormatter={axisTick} />
          <Tooltip
            separator={TOOLTIP_SEPARATOR}
            labelFormatter={(key) => {
              const label = tooltips.get(String(key)) ?? String(key)
              return week ? `${label} · trung bình` : label
            }}
            formatter={(value) => (typeof value === 'number' ? formatQty(value) : MISSING)}
          />
          <Legend formatter={legendText} {...legend} />
          {groups.map((g, i) => (
            <Bar
              key={planKey(g.id)}
              dataKey={planKey(g.id)}
              name={`Plan · ${g.name}`}
              stackId="plan"
              fill={tintColor(hueOf(i), PLAN_TINT)}
              fillOpacity={opacity(planKey(g.id))}
              stroke={hueOf(i)}
              strokeWidth={PLAN_OUTLINE}
              strokeOpacity={opacity(planKey(g.id))}
              strokeDasharray={lapOf(i) > 0 ? '3 2' : undefined}
              activeBar={ACTIVE_BAR}
              isAnimationActive={false}
            />
          ))}
          {groups.map((g, i) => (
            <Bar
              key={actualKey(g.id)}
              dataKey={actualKey(g.id)}
              name={`Actual · ${g.name}`}
              stackId="actual"
              fill={categoricalColor(i)}
              fillOpacity={opacity(actualKey(g.id))}
              activeBar={ACTIVE_BAR}
              isAnimationActive={false}
            />
          ))}
          <Line
            type="monotone"
            dataKey="planTotal"
            name={`Plan tổng${lineSuffix}`}
            stroke={palette.textTertiary}
            strokeOpacity={opacity('planTotal')}
            strokeWidth={2}
            strokeDasharray="5 3"
            // A plan imported one row per week has a value once a week: joined, not dots alone.
            connectNulls
            dot={{ r: 2, fillOpacity: opacity('planTotal'), strokeOpacity: opacity('planTotal') }}
            activeDot={ACTIVE_DOT}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="actualTotal"
            name={`Actual tổng${lineSuffix}`}
            stroke={palette.ink}
            strokeOpacity={opacity('actualTotal')}
            strokeWidth={2}
            connectNulls
            dot={{ r: 2, fillOpacity: opacity('actualTotal'), strokeOpacity: opacity('actualTotal') }}
            activeDot={ACTIVE_DOT}
            isAnimationActive={false}
          />
          {!report && (
            <Brush
              dataKey="key"
              height={22}
              travellerWidth={8}
              startIndex={startIndex}
              tickFormatter={(key: string) => formatDayMonth(String(key))}
              stroke={palette.border}
              fill={palette.bgSubtle}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
