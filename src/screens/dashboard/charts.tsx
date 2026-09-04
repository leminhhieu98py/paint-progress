import {
  Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { fieldError, palette } from '../../theme'
import { formatHours, formatMhrPerM2 } from '../../lib/format'

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
