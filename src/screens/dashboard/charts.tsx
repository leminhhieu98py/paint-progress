import {
  Bar, BarChart, Brush, CartesianGrid, ComposedChart, Legend, Line, LineChart, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from 'recharts'
import type { KpiDay } from '../../domain/kpi'
import { fieldError, palette } from '../../theme'
import { formatAreaM2, formatHours, formatMhrPerM2, formatPercent } from '../../lib/format'

/**
 * The two charts of the productivity dashboard (Feedback Rv2, item 12), on
 * Recharts (owner's choice, 2026-09-05). Kept in their own module so the
 * dashboard's tests can replace them: jsdom gives ResponsiveContainer no size,
 * and what the tests assert is the numbers, which live in domain/effort.ts.
 *
 * Data comes in the shapes `efficiencySeries` and `hoursSeries` produce, so
 * nothing here computes anything.
 */

/** '2026-09-04' -> '04/09' for an axis that already knows the year. */
const dayLabel = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}`

const AXIS = { fontSize: 12, fill: palette.textTertiary }

export function EfficiencyLineChart({
  data,
  stages,
}: {
  data: Array<Record<string, string | number | null>>
  /** Stage names in seq order with the colour the drawing uses for each. */
  stages: Array<{ name: string; color: string }>
}) {
  return (
    <div data-testid="efficiency-chart" style={{ width: '100%', height: 280 }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={palette.borderSplit} vertical={false} />
          <XAxis dataKey="day" tickFormatter={dayLabel} tick={AXIS} />
          <YAxis
            tick={AXIS}
            width={56}
            label={{ value: 'Mhr/m²', angle: -90, position: 'insideLeft', style: AXIS }}
          />
          <Tooltip
            labelFormatter={(day) => dayLabel(String(day))}
            formatter={(value) => (typeof value === 'number' ? formatMhrPerM2(value) : '')}
          />
          <Legend />
          {stages.map((s) => (
            <Line
              key={s.name}
              type="monotone"
              dataKey={s.name}
              stroke={s.color}
              strokeWidth={2}
              dot={{ r: 3 }}
              connectNulls
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

export function HoursBarChart({ data }: { data: Array<{ day: string; hours: number; wasteHours: number }> }) {
  return (
    <div data-testid="hours-chart" style={{ width: '100%', height: 260 }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={palette.borderSplit} vertical={false} />
          <XAxis dataKey="day" tickFormatter={dayLabel} tick={AXIS} />
          <YAxis tick={AXIS} width={56} label={{ value: 'Mhr', angle: -90, position: 'insideLeft', style: AXIS }} />
          <Tooltip
            labelFormatter={(day) => dayLabel(String(day))}
            formatter={(value) => (typeof value === 'number' ? formatHours(value) : '')}
          />
          <Legend />
          <Bar dataKey="hours" name="Thực hiện" stackId="h" fill={palette.accent} isAnimationActive={false} />
          <Bar dataKey="wasteHours" name="Hao phí" stackId="h" fill={fieldError} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

/** The four series' names, so the tooltip can tell an m² from a share. */
const KPI_PLAN_M2 = 'Kế hoạch (m²/ngày)'
const KPI_ACTUAL_M2 = 'Thực hiện (m²/ngày)'
const KPI_PLAN_CUM = 'Luỹ kế kế hoạch'
const KPI_ACTUAL_CUM = 'Luỹ kế thực hiện'

/**
 * KPI Plan vs Actual (Feedback Rv5, item 9, RV5-27): the combo chart of
 * `KPI.xlsx`. Clustered bars for the plan and the actual m²/day against the
 * left axis, and the two cumulative-share S-curves against the right.
 *
 * Colours come in two families rather than four separate hues, and no new
 * token is introduced: the PLAN is the grey family and the ACTUAL is the
 * accent family, which is the comparison the chart is about. Bar against line
 * separates the daily figure from the cumulative one inside each family, and
 * `HoursBarChart` above already paints "Thực hiện" in `palette.accent`, so the
 * accent means the same thing on both screens.
 *
 * Data is `kpiSeries`' output untouched -- nothing here computes anything.
 *
 * The `Brush` below is RV6-10's zoom/pan ("phóng to/thu nhỏ"): it starts
 * covering the whole range, dragging its handles zooms and dragging its body
 * pans. The container grows from 340 to 372px so the 22px the brush needs
 * comes out of new space rather than the plot area's. `KpiDashboard` keys
 * this component on the filter scope, so a deck or coat change remounts it
 * and the brush resets to the whole range rather than keeping an old zoom
 * that may no longer make sense for the new data.
 */
export function KpiComboChart({ data }: { data: KpiDay[] }) {
  return (
    <div data-testid="kpi-chart" style={{ width: '100%', height: 372 }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={palette.borderSplit} vertical={false} />
          <XAxis dataKey="day" tickFormatter={dayLabel} tick={AXIS} />
          <YAxis
            yAxisId="m2"
            tick={AXIS}
            width={72}
            label={{ value: 'm²/ngày', angle: -90, position: 'insideLeft', style: AXIS }}
          />
          <YAxis
            yAxisId="share"
            orientation="right"
            tick={AXIS}
            width={64}
            // Not capped at 1: actual above plan is real and the workbook does
            // not clamp it either, so the axis has to be able to show it.
            tickFormatter={(v: number) => formatPercent(v)}
          />
          <Tooltip
            labelFormatter={(day) => dayLabel(String(day))}
            formatter={(value, name) => {
              if (typeof value !== 'number') return ''
              return name === KPI_PLAN_CUM || name === KPI_ACTUAL_CUM
                ? formatPercent(value)
                : formatAreaM2(value)
            }}
          />
          <Legend />
          <Bar
            yAxisId="m2"
            dataKey="planM2"
            name={KPI_PLAN_M2}
            fill={palette.textQuaternary}
            isAnimationActive={false}
          />
          <Bar
            yAxisId="m2"
            dataKey="actualM2"
            name={KPI_ACTUAL_M2}
            fill={palette.accent}
            isAnimationActive={false}
          />
          <Line
            yAxisId="share"
            type="monotone"
            dataKey="planCumShare"
            name={KPI_PLAN_CUM}
            stroke={palette.textTertiary}
            strokeWidth={2}
            strokeDasharray="5 3"
            dot={false}
            isAnimationActive={false}
          />
          <Line
            yAxisId="share"
            type="monotone"
            dataKey="actualCumShare"
            name={KPI_ACTUAL_CUM}
            stroke={palette.accentHover}
            strokeWidth={2}
            dot={{ r: 2 }}
            isAnimationActive={false}
          />
          <Brush
            dataKey="day"
            height={22}
            travellerWidth={8}
            tickFormatter={dayLabel}
            stroke={palette.border}
            fill={palette.bgSubtle}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
