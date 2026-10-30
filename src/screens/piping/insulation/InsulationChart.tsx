import { Checkbox } from 'antd'
import { useMemo } from 'react'
import { Bar, Brush, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { EmptyState } from '../../../components/EmptyState'
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
 *
 * On screen the legend picks the series (RV9-4): one checkbox per series the
 * lines select shows, ticked while it is drawn. It sits under the plot, not in
 * Recharts' legend, so a toggle never remounts it and the keyboard keeps its
 * place, even when the last series goes and the plot gives way to "Chọn ít
 * nhất một dữ liệu". The report keeps Recharts' static legend of the series
 * it draws (the export passes only the shown ones).
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

/** A bar's fill: the Plan bar a lighter tint of its colour. */
const barFill = (colors: ChartColors, key: CamSeriesKey) => {
  const color = colorOf(colors, key)
  return SERIES[key].kind === 'Plan' ? tintColor(color, PLAN_BAR_TINT) : color
}

/** The plot's height on screen; the legend sits under it. */
const PLOT_HEIGHT = 330
/** A hidden series' marker, faded beside its muted name. */
const HIDDEN_MARKER_OPACITY = 0.4
/** Recharts' legend marker, 14 px on a 32-unit box: a block for a bar, a line through a ring for a line. */
const MARKER = 14
const RECT_ICON = 'M0,4h32v24h-32z'
const LINE_ICON = 'M0,16h10.67A5.33,5.33,0,1,1,21.33,16H32M21.33,16A5.33,5.33,0,1,1,10.67,16'

/**
 * The on-screen legend (RV9-4): antd checkboxes, so a click, Space or Enter
 * hides or shows a series and a screen reader reads each as ticked or not.
 * Hovering a shown item highlights its series (CHT-03). In the toggle's
 * order, which is the report legend's (`legendOrder`); on a phone one item
 * per line (MOB-03). The names are short ("Paint Plan lũy kế"), so a phone's
 * item fits its line without the other legends' ellipsis.
 */
function SeriesLegend({ keys, hidden, colors, phone, onToggle, onHover }: {
  keys: CamSeriesKey[]
  hidden: ReadonlySet<CamSeriesKey>
  colors: ChartColors
  phone: boolean
  onToggle: (key: CamSeriesKey) => void
  onHover: (key: CamSeriesKey | null) => void
}) {
  return (
    <div
      role="group"
      aria-label="Dữ liệu hiển thị"
      style={{
        display: 'flex', flexDirection: phone ? 'column' : 'row', flexWrap: 'wrap',
        justifyContent: phone ? 'flex-start' : 'center', columnGap: 16, paddingTop: 4,
      }}
    >
      {keys.map((key) => {
        const shown = !hidden.has(key)
        const name = seriesName(key)
        const bar = SERIES[key].bar
        const color = bar ? barFill(colors, key) : colorOf(colors, key)
        const toggle = () => {
          onHover(null)
          onToggle(key)
        }
        return (
          <Checkbox
            key={key}
            checked={shown}
            onChange={toggle}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return
              e.preventDefault()
              toggle()
            }}
            onMouseEnter={() => onHover(shown ? key : null)}
            onMouseLeave={() => onHover(null)}
            style={{ marginInlineStart: 0, alignSelf: phone ? 'flex-start' : undefined }}
          >
            <svg
              aria-hidden
              width={MARKER}
              height={MARKER}
              viewBox="0 0 32 32"
              style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: 4, opacity: shown ? 1 : HIDDEN_MARKER_OPACITY }}
            >
              {bar
                ? <path d={RECT_ICON} fill={color} />
                : <path d={LINE_ICON} fill="none" stroke={color} strokeWidth={4} />}
            </svg>
            <span data-legend-text="" style={{ color: shown ? palette.textSecondary : palette.textTertiary }}>{name}</span>
          </Checkbox>
        )
      })}
    </div>
  )
}

/** No series hidden, for a caller that hides none. */
const NONE_HIDDEN: readonly CamSeriesKey[] = []
const ignoreToggle = () => {}

/**
 * `keys` are the bars and lines the Plan | Actual | Plan & Actual toggle
 * shows (`camSeriesKeys`); `hidden` the ones the legend has turned off
 * (RV9-4), drawn by neither the plot nor the report. The caller keys this on
 * the view so the Brush's zoom does not survive a switch between days and
 * weeks. `report` draws it for the Excel report (spec §10): the whole range
 * with no Brush, on the desktop layout whatever the screen, with Recharts'
 * static legend.
 */
export function InsulationChart({
  data, keys, mode, colors = DEFAULT_COLORS, report = false, decimals = false, hidden = NONE_HIDDEN,
  onToggle = ignoreToggle,
}: {
  data: CamPoint[]
  keys: CamSeriesKey[]
  mode: ViewMode
  /** The series the legend hides (RV9-4); the page holds them per project. */
  hidden?: readonly CamSeriesKey[]
  /** Hides a shown series, shows a hidden one. */
  onToggle?: (key: CamSeriesKey) => void
  /** The project's resolved chart colours (`resolveChartColors`). */
  colors?: ChartColors
  report?: boolean
  /** The unit sums a number column (RV9-1): the axes step by fractions too. */
  decimals?: boolean
}) {
  const { legend, opacity, height, phone } = useLegendHighlight({ desktop: report })
  const tooltips = useMemo(() => new Map(data.map((p) => [p.key, p.tooltip])), [data])
  const dots = data.length <= DOTS_UP_TO
  const hiddenSet = useMemo(() => new Set(hidden), [hidden])
  const shown = keys.filter((key) => !hiddenSet.has(key))
  // The legend in the toggle's order (`camSeriesKeys`): by milestone, the bars, then the lines, Plan before Actual.
  const legendSorter = useMemo(() => legendOrder(keys), [keys])
  // Bars drawn first, so the lines lie over them.
  const bars = shown.filter((key) => SERIES[key].bar)
  const lines = shown.filter((key) => !SERIES[key].bar)
  const hover = (key: CamSeriesKey | null) => {
    if (key === null) legend.onMouseLeave()
    else legend.onMouseEnter({ value: seriesName(key), dataKey: key })
  }
  const plot = shown.length === 0
    ? (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <EmptyState title="Chọn ít nhất một dữ liệu" />
      </div>
    )
    : (
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
          {report && <Legend formatter={legendText} itemSorter={legendSorter} {...legend} />}
          {bars.map((key) => (
            <Bar
              key={key}
              yAxisId="bucket"
              dataKey={key}
              name={seriesName(key)}
              fill={barFill(colors, key)}
              fillOpacity={opacity(key)}
              activeBar={ACTIVE_BAR}
              isAnimationActive={false}
            />
          ))}
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
    )
  if (report) {
    return (
      <div data-testid="insulation-chart" data-mode={mode} style={{ width: '100%', height: height(372, shown.length) }}>
        {plot}
      </div>
    )
  }
  return (
    <div data-testid="insulation-chart" data-mode={mode} style={{ width: '100%' }}>
      <div style={{ height: PLOT_HEIGHT }}>{plot}</div>
      <SeriesLegend keys={keys} hidden={hiddenSet} colors={colors} phone={phone} onToggle={onToggle} onHover={hover} />
    </div>
  )
}
