import { Cell as RechartsCell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import type { PieSlice } from '../../domain/pieSlices'
import { formatAreaM2, formatPercent } from '../../lib/format'

/**
 * Area by current stage, with prog(D) in the middle.
 *
 * `totalAreaM2` is passed in rather than derived from `slices`, and that is the
 * point: every share below divides by the deck's own declared area, the same
 * denominator computeDeckProgress uses (spec §3.2). Summing the slices instead
 * would renormalise silently in the one case that matters -- a deck whose cells
 * do not cover it -- and put two different numbers for the same quantity on one
 * screen.
 *
 * `slices` is handed to <Pie> and to the legend as the SAME array, in the same
 * order, because recharts pairs <Cell> children with data positionally.
 */
export function StagePie({
  slices,
  totalAreaM2,
  progress,
}: {
  slices: PieSlice[]
  totalAreaM2: number
  progress: number
}) {
  const shareOf = (areaM2: number) => (totalAreaM2 > 0 ? areaM2 / totalAreaM2 : 0)

  return (
    <div>
      <div style={{ position: 'relative', width: '100%', height: 260 }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={slices}
              dataKey="areaM2"
              nameKey="label"
              innerRadius="62%"
              outerRadius="88%"
              isAnimationActive={false}
            >
              {slices.map((slice) => (
                <RechartsCell key={slice.key} fill={slice.color} />
              ))}
            </Pie>
            <Tooltip />
          </PieChart>
        </ResponsiveContainer>
        <div
          style={{
            position: 'absolute', inset: 0, display: 'flex',
            flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            pointerEvents: 'none',
          }}
        >
          {/* Plain DOM, not an SVG label: it is the one number on this screen
              that has to be readable and assertable whatever recharts does. */}
          <div data-testid="gs-deck-progress" style={{ fontSize: 28, fontWeight: 600 }}>
            {formatPercent(progress)}
          </div>
          <div style={{ opacity: 0.65 }}>Tiến độ sàn</div>
        </div>
      </div>

      <ul style={{ listStyle: 'none', margin: '8px 0 0', padding: 0 }}>
        {slices.map((slice) => (
          <li
            key={slice.key}
            data-testid={`legend-${slice.key}`}
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 0' }}
          >
            <span
              aria-hidden
              style={{
                width: 12, height: 12, borderRadius: 2,
                background: slice.color, flex: '0 0 auto',
              }}
            />
            <span style={{ flex: 1 }}>{slice.label}</span>
            <span>{formatAreaM2(slice.areaM2)} m²</span>
            <span style={{ width: 72, textAlign: 'right' }}>
              {formatPercent(shareOf(slice.areaM2))}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
