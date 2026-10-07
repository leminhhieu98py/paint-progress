import { useMemo } from 'react'
import { Brush, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { MILESTONE_LABEL, type CamPoint, type CamSeriesKey } from '../../../domain/piping/cam'
import type { Milestone, ViewMode } from '../../../domain/piping/types'
import { formatDayMonth } from '../../../domain/piping/week'
import { MISSING } from '../../../lib/format'
import { palette } from '../../../theme'
import { ACTIVE_DOT, AXIS, axisTick, legendText, TOOLTIP_SEPARATOR, useLegendHighlight } from '../../dashboard/chartKit'
import { formatQty } from '../pipingFormat'

/**
 * The Insulation chart (spec §6.4, Q20A): per milestone, how many items of the
 * chosen unit reached it by each day or week, Plan and Actual, as cumulative
 * lines on one axis. Its own module, as the other Piping charts are in
 * theirs: the panel's tests replace it (jsdom gives ResponsiveContainer no
 * size), and only the lazily loaded Piping page imports it, so Recharts stays
 * out of the first load. Data arrives as `camSeries` gives it; nothing here
 * computes a figure.
 *
 * One colour per milestone from the app's palette (CHT-01), so a milestone's
 * Plan and Actual read as a pair: Plan dashed, Actual solid with dots, as on
 * the KPI and Reinstatement charts. The names are the file's (spec §0) and
 * say "lũy kế" (spec §3), as Reinstatement's "Plan lũy kế" does. Dots only
 * while the points can be told apart (DOTS_UP_TO): a long day axis drew
 * thousands of circles that read as a thick line and re-rendered on hover.
 */

const MILESTONE_COLOR: Record<Milestone, string> = {
  ph: palette.categorical[0],
  ih: palette.categorical[2],
  iw: palette.categorical[6],
}

const SERIES: Record<CamSeriesKey, { milestone: Milestone; kind: 'Plan' | 'Actual' }> = {
  phPlan: { milestone: 'ph', kind: 'Plan' },
  phActual: { milestone: 'ph', kind: 'Actual' },
  ihPlan: { milestone: 'ih', kind: 'Plan' },
  ihActual: { milestone: 'ih', kind: 'Actual' },
  iwPlan: { milestone: 'iw', kind: 'Plan' },
  iwActual: { milestone: 'iw', kind: 'Actual' },
}

/** `Painting Handover – Plan lũy kế`: the file's column (spec §0), cumulative (spec §3). */
const seriesName = (key: CamSeriesKey) => `${MILESTONE_LABEL[SERIES[key].milestone]} – ${SERIES[key].kind} lũy kế`

/** The most points an Actual line still dots. */
const DOTS_UP_TO = 60

/**
 * `keys` are the lines the Plan | Actual | Plan & Actual toggle shows
 * (`camSeriesKeys`). The caller keys this on the view so the Brush's zoom
 * does not survive a switch between days and weeks.
 */
export function InsulationChart({ data, keys, mode }: { data: CamPoint[]; keys: CamSeriesKey[]; mode: ViewMode }) {
  const { legend, opacity, height } = useLegendHighlight()
  const tooltips = useMemo(() => new Map(data.map((p) => [p.key, p.tooltip])), [data])
  const dots = data.length <= DOTS_UP_TO
  return (
    <div data-testid="insulation-chart" data-mode={mode} style={{ width: '100%', height: height(372, keys.length) }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={palette.borderSplit} vertical={false} />
          <XAxis dataKey="key" tickFormatter={(key: string) => formatDayMonth(String(key))} tick={AXIS} />
          <YAxis tick={AXIS} width={56} tickFormatter={axisTick} allowDecimals={false} />
          <Tooltip
            separator={TOOLTIP_SEPARATOR}
            labelFormatter={(key) => tooltips.get(String(key)) ?? String(key)}
            formatter={(value) => (typeof value === 'number' ? formatQty(value) : MISSING)}
          />
          <Legend formatter={legendText} {...legend} />
          {keys.map((key) => {
            const color = MILESTONE_COLOR[SERIES[key].milestone]
            const plan = SERIES[key].kind === 'Plan'
            return (
              <Line
                key={key}
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
          <Brush
            dataKey="key"
            height={22}
            travellerWidth={8}
            tickFormatter={(key: string) => formatDayMonth(String(key))}
            stroke={palette.border}
            fill={palette.bgSubtle}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
