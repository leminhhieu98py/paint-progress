import { useMemo } from 'react'
import { Bar, Brush, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { ManpowerPoint } from '../../../domain/piping/manpower'
import type { ManpowerGroup, ViewMode } from '../../../domain/piping/types'
import { formatDayMonth } from '../../../domain/piping/week'
import { MISSING } from '../../../lib/format'
import { categoricalColor, palette } from '../../../theme'
import {
  ACTIVE_BAR, ACTIVE_DOT, AXIS, axisTick, legendText, TOOLTIP_SEPARATOR, useLegendHighlight,
} from '../../dashboard/chartKit'
import { formatQty } from '../pipingFormat'

/**
 * Manpower (spec §5): per day or week, the groups stacked once for Plan and
 * once for Actual, the two stacks side by side, with a Plan total and an
 * Actual total line on the same axis (a total sits on top of its stack). Week
 * view is an average (R-2), so every series says "(trung bình)" there (spec
 * §3). Data is `manpowerSeries`' output, flattened for Recharts; nothing here
 * computes a figure. Actual stops at today and the plan runs to its end
 * because the series does.
 *
 * Each group keeps one hue of the categorical palette (CHT-01) in both
 * stacks: Actual in the hue itself, Plan in a tint of it, so a group reads as
 * one family and the plan as the lighter stack. The panel's tests replace
 * this module (jsdom gives ResponsiveContainer no size); only the lazily
 * loaded Piping page imports it.
 */

/** How much white the Plan stack mixes into its group's hue. */
const PLAN_TINT = 0.55

function tint(hex: string, white: number): string {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16)
    return Math.round(c + (255 - c) * white).toString(16).padStart(2, '0')
  }
  return `#${channel(1)}${channel(3)}${channel(5)}`.toUpperCase()
}

const planKey = (groupId: string) => `plan:${groupId}`
const actualKey = (groupId: string) => `actual:${groupId}`

export function ManpowerChart({ data, groups, mode }: {
  data: ManpowerPoint[]
  /** The groups to draw, in order (`chartGroups`): their colours follow this order. */
  groups: ManpowerGroup[]
  mode: ViewMode
}) {
  const { legend, opacity, height, phone } = useLegendHighlight()
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
  const suffix = mode === 'week' ? ' (trung bình)' : ''
  const stacks = [
    { stackId: 'plan', label: 'Plan', key: planKey, color: (i: number) => tint(categoricalColor(i), PLAN_TINT) },
    { stackId: 'actual', label: 'Actual', key: actualKey, color: (i: number) => categoricalColor(i) },
  ]
  return (
    <div data-testid="manpower-chart" style={{ width: '100%', height: height(372, groups.length * 2 + 2) }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={palette.borderSplit} vertical={false} />
          <XAxis dataKey="key" tickFormatter={(key: string) => formatDayMonth(String(key))} tick={AXIS} />
          <YAxis tick={AXIS} width={phone ? 40 : 56} tickFormatter={axisTick} />
          <Tooltip
            separator={TOOLTIP_SEPARATOR}
            labelFormatter={(key) => tooltips.get(String(key)) ?? String(key)}
            formatter={(value) => (typeof value === 'number' ? formatQty(value) : MISSING)}
          />
          <Legend formatter={legendText} {...legend} />
          {stacks.flatMap((stack) => groups.map((g, i) => (
            <Bar
              key={stack.key(g.id)}
              dataKey={stack.key(g.id)}
              name={`${stack.label} · ${g.name}${suffix}`}
              stackId={stack.stackId}
              fill={stack.color(i)}
              fillOpacity={opacity(stack.key(g.id))}
              activeBar={ACTIVE_BAR}
              isAnimationActive={false}
            />
          )))}
          <Line
            type="monotone"
            dataKey="planTotal"
            name={`Plan tổng${suffix}`}
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
            name={`Actual tổng${suffix}`}
            stroke={palette.ink}
            strokeOpacity={opacity('actualTotal')}
            strokeWidth={2}
            connectNulls
            dot={{ r: 2, fillOpacity: opacity('actualTotal'), strokeOpacity: opacity('actualTotal') }}
            activeDot={ACTIVE_DOT}
            isAnimationActive={false}
          />
          <Brush
            dataKey="key"
            height={22}
            travellerWidth={8}
            tickFormatter={(key: string) => formatDayMonth(String(key))}
            stroke={palette.border}
            fill={palette.bgSubtle}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
