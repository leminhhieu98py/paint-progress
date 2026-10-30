import { useMemo } from 'react'
import { Bar, Brush, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { milestoneActualLabel, milestonePlanLabel, type CamPoint, type CamSeriesKey } from '../../../domain/piping/cam'
import type { Milestone, ViewMode } from '../../../domain/piping/types'
import { formatDayMonth } from '../../../domain/piping/week'
import { MISSING } from '../../../lib/format'
import { palette, tintColor } from '../../../theme'
import {
  ACTIVE_BAR, ACTIVE_DOT, AXIS, axisTick, legendText, TOOLTIP_SEPARATOR, useLegendHighlight,
} from '../../dashboard/chartKit'
import { insulationColorKey, resolveChartColors, type ChartColors } from '../chartColors'
import { legendOrder } from '../legendOrder'
import { formatQty } from '../pipingFormat'

/**
 * The Insulation chart (spec §6.4, Q20A, RV8-11): per milestone, Plan and
 * Actual, how many items of the chosen unit reach it inside each day or week
 * (bars, left axis) and by then (cumulative lines, right axis), as the
 * Reinstatement chart draws its bars and lines. Its own module, as the other
 * Piping charts are in theirs: the panel's tests replace it (jsdom gives
 * ResponsiveContainer no size), and only the lazily loaded Piping page
 * imports it, so Recharts stays out of the first load. Data arrives as
 * `camSeries` gives it; nothing here computes a figure.
 *
 * One colour per milestone from the app's palette (CHT-01), so a milestone's
 * bars and lines read as a set: the Plan bar a lighter tint, the Plan line
 * dashed, the Actual line solid with dots, as on the KPI and Reinstatement
 * charts. The project's colours (RV8-2) may set Plan and Actual of each
 * milestone apart (`ins.<milestone>.<kind>`); a bar and its line share one.
 * The names are the milestones' (RV8-4); the lines say "lũy kế"
 * (spec §3), as Reinstatement's "Plan lũy kế" does. Dots only
 * while the points can be told apart (DOTS_UP_TO): a long day axis drew
 * thousands of circles that read as a thick line and re-rendered on hover.
 */

/** How much white the Plan bar mixes into its milestone's colour: the same hue, lighter. */
const PLAN_BAR_TINT = 0.5

const SERIES: Record<CamSeriesKey, { milestone: Milestone; kind: 'Plan' | 'Actual'; bar: boolean }> = {
  phPlanBar: { milestone: 'ph', kind: 'Plan', bar: true },
  phActualBar: { milestone: 'ph', kind: 'Actual', bar: true },
  phPlan: { milestone: 'ph', kind: 'Plan', bar: false },
  phActual: { milestone: 'ph', kind: 'Actual', bar: false },
  ihPlanBar: { milestone: 'ih', kind: 'Plan', bar: true },
  ihActualBar: { milestone: 'ih', kind: 'Actual', bar: true },
  ihPlan: { milestone: 'ih', kind: 'Plan', bar: false },
  ihActual: { milestone: 'ih', kind: 'Actual', bar: false },
  iwPlanBar: { milestone: 'iw', kind: 'Plan', bar: true },
  iwActualBar: { milestone: 'iw', kind: 'Actual', bar: true },
  iwPlan: { milestone: 'iw', kind: 'Plan', bar: false },
  iwActual: { milestone: 'iw', kind: 'Actual', bar: false },
}

/** `Pip Plan` for a bar, `Pip Plan lũy kế` for its line: the milestone's Plan or Act (RV8-4), cumulative (spec §3). */
const seriesName = (key: CamSeriesKey) => {
  const { milestone, kind, bar } = SERIES[key]
  const name = kind === 'Plan' ? milestonePlanLabel(milestone) : milestoneActualLabel(milestone)
  return bar ? name : `${name} lũy kế`
}

/** The most points an Actual line still dots. */
const DOTS_UP_TO = 60

/** Today's colours, for a caller that passes none. */
const DEFAULT_COLORS = resolveChartColors({}, [])

/** The series' colour: its milestone × kind's. */
const colorOf = (colors: ChartColors, key: CamSeriesKey) =>
  colors[insulationColorKey(SERIES[key].milestone, SERIES[key].kind === 'Plan' ? 'plan' : 'actual')]

/**
 * `keys` are the bars and lines the Plan | Actual | Plan & Actual toggle
 * shows (`camSeriesKeys`). The caller keys this on the view so the Brush's zoom
 * does not survive a switch between days and weeks. `report` draws it for the
 * Excel report (spec §10): the whole range with no Brush, on the desktop
 * layout whatever the screen.
 */
export function InsulationChart({ data, keys, mode, colors = DEFAULT_COLORS, report = false, decimals = false }: {
  data: CamPoint[]
  keys: CamSeriesKey[]
  mode: ViewMode
  /** The project's resolved chart colours (`resolveChartColors`). */
  colors?: ChartColors
  report?: boolean
  /** The unit sums a number column (RV9-1): the axes step by fractions too. */
  decimals?: boolean
}) {
  const { legend, opacity, height, phone } = useLegendHighlight({ desktop: report })
  const tooltips = useMemo(() => new Map(data.map((p) => [p.key, p.tooltip])), [data])
  const dots = data.length <= DOTS_UP_TO
  // The legend in the toggle's order (`camSeriesKeys`): by milestone, the bars, then the lines, Plan before Actual.
  const legendSorter = useMemo(() => legendOrder(keys), [keys])
  // Bars drawn first, so the lines lie over them.
  const bars = keys.filter((key) => SERIES[key].bar)
  const lines = keys.filter((key) => !SERIES[key].bar)
  return (
    <div data-testid="insulation-chart" data-mode={mode} style={{ width: '100%', height: height(372, keys.length) }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={palette.borderSplit} vertical={false} />
          <XAxis dataKey="key" tickFormatter={(key: string) => formatDayMonth(String(key))} tick={AXIS} />
          <YAxis yAxisId="bucket" tick={AXIS} width={56} tickFormatter={axisTick} allowDecimals={decimals} />
          <YAxis
            yAxisId="cum"
            orientation="right"
            // On a phone the plot takes this axis's width, as on Reinstatement; the tooltip still reads each total.
            hide={phone}
            tick={AXIS}
            width={64}
            tickFormatter={axisTick}
            allowDecimals={decimals}
          />
          <Tooltip
            separator={TOOLTIP_SEPARATOR}
            labelFormatter={(key) => tooltips.get(String(key)) ?? String(key)}
            formatter={(value) => (typeof value === 'number' ? formatQty(value) : MISSING)}
          />
          <Legend formatter={legendText} itemSorter={legendSorter} {...legend} />
          {bars.map((key) => {
            const color = colorOf(colors, key)
            return (
              <Bar
                key={key}
                yAxisId="bucket"
                dataKey={key}
                name={seriesName(key)}
                fill={SERIES[key].kind === 'Plan' ? tintColor(color, PLAN_BAR_TINT) : color}
                fillOpacity={opacity(key)}
                activeBar={ACTIVE_BAR}
                isAnimationActive={false}
              />
            )
          })}
          {lines.map((key) => {
            const color = colorOf(colors, key)
            const plan = SERIES[key].kind === 'Plan'
            return (
              <Line
                key={key}
                yAxisId="cum"
                type="monotone"
                dataKey={key}
                name={seriesName(key)}
                stroke={color}
                strokeOpacity={opacity(key)}
                strokeWidth={2}
                strokeDasharray={plan ? '5 3' : undefined}
                dot={plan || !dots ? false : { r: 2, fillOpacity: opacity(key), strokeOpacity: opacity(key) }}
                activeDot={ACTIVE_DOT}
                isAnimationActive={false}
              />
            )
          })}
          {!report && (
            <Brush
              dataKey="key"
              height={22}
              travellerWidth={8}
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
