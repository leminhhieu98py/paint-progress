import { useMemo } from 'react'
import { Bar, Brush, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { ReinstatementPoint } from '../../domain/piping/reinstatement'
import type { ViewMode } from '../../domain/piping/types'
import { formatDayMonth } from '../../domain/piping/week'
import { MISSING } from '../../lib/format'
import { palette } from '../../theme'
import {
  ACTIVE_BAR, ACTIVE_DOT, AXIS, axisTick, legendText, TOOLTIP_SEPARATOR, useLegendHighlight,
} from '../dashboard/chartKit'
import { KPI_COLOR_DEFAULTS } from '../dashboard/kpiColors'
import { formatQty } from './pipingFormat'

/**
 * The Piping charts (spec §3, §4), on Recharts as the KPI chart is and kept in
 * their own module for the same reason: the panels' tests replace them, since
 * jsdom gives ResponsiveContainer no size. Data arrives as the domain's
 * series; nothing here computes a figure. Only the lazily loaded Piping page
 * imports this module, so Recharts stays out of the first load.
 */

const BUCKET_WORD: Record<ViewMode, string> = { day: 'theo ngày', week: 'theo tuần' }

/**
 * Reinstatement (spec §4, R-5): Plan and Actual bars per day or week on the
 * left axis, the Plan cumulative line (to the end of the plan) and the Actual
 * cumulative line (to today) on the right. The names say "theo ngày/tuần" and
 * "lũy kế" so a bar is never read as a running total (spec §3). Colours as on
 * the KPI chart: the plan in the grey family, the actual in the accent family,
 * the plan line dashed.
 *
 * The axis keys on each bucket's first day, unique across years; its tick is
 * that day's `DD/MM` and the tooltip names the bucket in full (`DD/MM/YYYY`,
 * or `DD/MM – DD/MM` for a week, Q6A). The caller keys this on the view so the
 * Brush's zoom does not survive a switch between days and weeks.
 */
export function ReinstatementChart({ data, mode }: { data: ReinstatementPoint[]; mode: ViewMode }) {
  const { legend, opacity, height, phone } = useLegendHighlight()
  const tooltips = useMemo(() => new Map(data.map((p) => [p.key, p.tooltip])), [data])
  const word = BUCKET_WORD[mode]
  return (
    <div data-testid="reinstatement-chart" style={{ width: '100%', height: height(372, 4) }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={palette.borderSplit} vertical={false} />
          <XAxis dataKey="key" tickFormatter={(key: string) => formatDayMonth(String(key))} tick={AXIS} />
          <YAxis yAxisId="bucket" tick={AXIS} width={56} tickFormatter={axisTick} allowDecimals={false} />
          <YAxis
            yAxisId="cum"
            orientation="right"
            // On a phone the plot takes this axis's width, as on KPI; the tooltip still reads each total.
            hide={phone}
            tick={AXIS}
            width={64}
            tickFormatter={axisTick}
            allowDecimals={false}
          />
          <Tooltip
            separator={TOOLTIP_SEPARATOR}
            labelFormatter={(key) => tooltips.get(String(key)) ?? String(key)}
            formatter={(value) => (typeof value === 'number' ? formatQty(value) : MISSING)}
          />
          <Legend formatter={legendText} {...legend} />
          <Bar
            yAxisId="bucket"
            dataKey="plan"
            name={`Plan ${word}`}
            fill={KPI_COLOR_DEFAULTS.plan}
            fillOpacity={opacity('plan')}
            activeBar={ACTIVE_BAR}
            isAnimationActive={false}
          />
          <Bar
            yAxisId="bucket"
            dataKey="actual"
            name={`Actual ${word}`}
            fill={KPI_COLOR_DEFAULTS.actual}
            fillOpacity={opacity('actual')}
            activeBar={ACTIVE_BAR}
            isAnimationActive={false}
          />
          <Line
            yAxisId="cum"
            type="monotone"
            dataKey="planCum"
            name="Plan lũy kế"
            stroke={palette.textTertiary}
            strokeOpacity={opacity('planCum')}
            strokeWidth={2}
            strokeDasharray="5 3"
            dot={false}
            activeDot={ACTIVE_DOT}
            isAnimationActive={false}
          />
          <Line
            yAxisId="cum"
            type="monotone"
            dataKey="actualCum"
            name="Actual lũy kế"
            stroke={palette.accentHover}
            strokeOpacity={opacity('actualCum')}
            strokeWidth={2}
            dot={{ r: 2, fillOpacity: opacity('actualCum'), strokeOpacity: opacity('actualCum') }}
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
