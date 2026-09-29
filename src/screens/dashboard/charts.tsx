import { useState } from 'react'
import {
  Bar, BarChart, Brush, CartesianGrid, ComposedChart, Legend, Line, LineChart, ResponsiveContainer,
  Tooltip, XAxis, YAxis, type LegendPayload,
} from 'recharts'
import type { KpiDay } from '../../domain/kpi'
import { palette } from '../../theme'
import { DEFAULT_UNIT, perUnit, rateUnit } from '../../domain/unit'
import { formatAreaM2, formatHours, formatMhrPerM2, formatPercent } from '../../lib/format'
import { KPI_COLOR_DEFAULTS } from './kpiColors'

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

/**
 * Recharts paints a legend entry's TEXT in its series colour, so a yellow or
 * a light-grey coat printed a label nobody could read on white (QA F3). The
 * marker beside it already carries the colour; the text reads in the neutral
 * secondary colour on every chart here.
 */
const legendText = (value: unknown) => (
  <span style={{ color: palette.textSecondary }}>{String(value)}</span>
)

/** The series other than the one a hovered legend item names (CHT-03). */
const DIMMED = 0.3
/** A hovered day's dot on a line (CHT-03). */
const ACTIVE_DOT = { r: 5 }
/** A hovered day's bar (CHT-03): outlined in ink, its colour left alone. */
const ACTIVE_BAR = { stroke: palette.ink, strokeWidth: 1 }

/**
 * Hovering a legend item highlights its series (CHT-03): the others dim to
 * 0.3 until the pointer leaves. Keyed by the series' `dataKey`, which Recharts
 * hands the legend handlers. Click-to-hide is deliberately not wired.
 */
function useLegendHighlight() {
  const [active, setActive] = useState<string | null>(null)
  return {
    legend: {
      onMouseEnter: (entry: LegendPayload) =>
        setActive(typeof entry.dataKey === 'string' ? entry.dataKey : null),
      onMouseLeave: () => setActive(null),
    },
    opacity: (dataKey: string) => (active === null || active === dataKey ? 1 : DIMMED),
  }
}

export function EfficiencyLineChart({
  data,
  stages,
  unit = DEFAULT_UNIT,
}: {
  data: Array<Record<string, string | number | null>>
  /** Stage names in seq order with the colour the drawing uses for each. */
  stages: Array<{ name: string; color: string }>
  /** The chosen work's unit (RV6-36); the axis reads `Mhr/<unit>`. */
  unit?: string
}) {
  const { legend, opacity } = useLegendHighlight()
  return (
    <div data-testid="efficiency-chart" style={{ width: '100%', height: 280 }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={palette.borderSplit} vertical={false} />
          <XAxis dataKey="day" tickFormatter={dayLabel} tick={AXIS} />
          <YAxis
            tick={AXIS}
            width={56}
            label={{ value: perUnit(unit), angle: -90, position: 'insideLeft', style: AXIS }}
          />
          <Tooltip
            labelFormatter={(day) => dayLabel(String(day))}
            formatter={(value) => (typeof value === 'number' ? formatMhrPerM2(value) : '')}
          />
          <Legend formatter={legendText} {...legend} />
          {stages.map((s) => (
            <Line
              key={s.name}
              type="monotone"
              dataKey={s.name}
              stroke={s.color}
              strokeOpacity={opacity(s.name)}
              strokeWidth={2}
              dot={{ r: 3, fillOpacity: opacity(s.name), strokeOpacity: opacity(s.name) }}
              activeDot={ACTIVE_DOT}
              // No `connectNulls`: the data is padded to every calendar day
              // (QA F4), and a day nobody worked a coat is a gap, not a slope.
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

export function HoursBarChart({
  data,
}: {
  /** Null on a padded day with no record (QA F4): no bar, not a zero-height one. */
  data: Array<{ day: string; hours: number | null; wasteHours: number | null }>
}) {
  const { legend, opacity } = useLegendHighlight()
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
          <Legend formatter={legendText} {...legend} />
          {/* The palette's first colour is the accent, so Thực hiện reads as on
              the KPI chart; waste takes its red (CHT-01). */}
          <Bar
            dataKey="hours"
            name="Thực hiện"
            stackId="h"
            fill={palette.categorical[0]}
            fillOpacity={opacity('hours')}
            activeBar={ACTIVE_BAR}
            isAnimationActive={false}
          />
          <Bar
            dataKey="wasteHours"
            name="Hao phí"
            stackId="h"
            fill={palette.categorical[3]}
            fillOpacity={opacity('wasteHours')}
            activeBar={ACTIVE_BAR}
            isAnimationActive={false}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

/** The four series' names, so the tooltip can tell a quantity from a share.
 *  The daily pair carry the work's unit (RV6-35): `Kế hoạch (m²/ngày)`. */
const kpiPlanName = (unit: string) => `Kế hoạch (${rateUnit(unit)})`
const kpiActualName = (unit: string) => `Thực hiện (${rateUnit(unit)})`
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
 * `colors` (RV6-29) is the one deck's own pair when the Sàn filter names one
 * deck: the plan bar AND the plan line take `plan`, the actual pair take
 * `actual`, each family falling back to its default when its colour is null or
 * the prop is absent (RV6-30). One colour per family, not per series, so a
 * deck's two plan marks still read as one family; the plan line keeps its dash
 * so bar and line stay told apart inside it.
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
export function KpiComboChart({
  data,
  colors,
  unit = DEFAULT_UNIT,
}: {
  data: KpiDay[]
  /** The selected deck's stored colours; null or absent means the default for that family. */
  colors?: { plan?: string | null; actual?: string | null }
  /** The one unit the plotted coats share (RV6-35); the left axis and the daily series say it. */
  unit?: string
}) {
  const plan = colors?.plan ?? null
  const actual = colors?.actual ?? null
  const { legend, opacity } = useLegendHighlight()
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
            label={{ value: rateUnit(unit), angle: -90, position: 'insideLeft', style: AXIS }}
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
          <Legend formatter={legendText} {...legend} />
          <Bar
            yAxisId="m2"
            dataKey="planM2"
            name={kpiPlanName(unit)}
            fill={plan ?? KPI_COLOR_DEFAULTS.plan}
            fillOpacity={opacity('planM2')}
            activeBar={ACTIVE_BAR}
            isAnimationActive={false}
          />
          <Bar
            yAxisId="m2"
            dataKey="actualM2"
            name={kpiActualName(unit)}
            fill={actual ?? KPI_COLOR_DEFAULTS.actual}
            fillOpacity={opacity('actualM2')}
            activeBar={ACTIVE_BAR}
            isAnimationActive={false}
          />
          <Line
            yAxisId="share"
            type="monotone"
            dataKey="planCumShare"
            name={KPI_PLAN_CUM}
            stroke={plan ?? palette.textTertiary}
            strokeOpacity={opacity('planCumShare')}
            strokeWidth={2}
            strokeDasharray="5 3"
            dot={false}
            activeDot={ACTIVE_DOT}
            isAnimationActive={false}
          />
          <Line
            yAxisId="share"
            type="monotone"
            dataKey="actualCumShare"
            name={KPI_ACTUAL_CUM}
            stroke={actual ?? palette.accentHover}
            strokeOpacity={opacity('actualCumShare')}
            strokeWidth={2}
            dot={{ r: 2, fillOpacity: opacity('actualCumShare'), strokeOpacity: opacity('actualCumShare') }}
            activeDot={ACTIVE_DOT}
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
