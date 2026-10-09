import { useState } from 'react'
import type { LegendPayload } from 'recharts'
import { formatAxisNumber } from '../../lib/format'
import { palette } from '../../theme'
import { useFieldPhone } from '../gs/fieldSections'

/**
 * What every Recharts chart of the app shares (CHT-03, MOB-03): the axis
 * style, the vi-VN ticks, the tooltip separator, the legend text, the hover
 * marks and the legend highlight. Lifted out of `charts.tsx` unchanged when
 * the Piping charts needed the same, so the dashboard, KPI and Piping charts
 * look and behave as one. Imported only by chart modules, which load lazily.
 */

export const AXIS = { fontSize: 12, fill: palette.textTertiary }
/** Numeric ticks in the app's Vietnamese format (R5-C2): 0,35 and 1.800, not 0.35 and 1800. */
export const axisTick = (v: number) => formatAxisNumber(v)
/** Recharts' default is " : ", a space before the colon (R5-C3). */
export const TOOLTIP_SEPARATOR = ': '

/**
 * Recharts paints a legend entry's TEXT in its series colour, so a yellow or
 * a light-grey coat printed a label nobody could read on white (QA F3). The
 * marker beside it already carries the colour; the text reads in the neutral
 * secondary colour on every chart here.
 */
export const legendText = (value: unknown) => (
  <span style={{ color: palette.textSecondary }}>{String(value)}</span>
)
/**
 * A phone's legend item keeps to one line (M4): a long coat name ellipsises,
 * its title holding all of it, so every item is exactly the LEGEND_LINE the
 * chart grew by and the plot never gives up height to a wrapped name. The
 * wrapper spans the chart, so the item has a width to end at; 24 px is the
 * marker and its gap.
 */
function phoneLegendText(value: unknown) {
  return (
    <span
      title={String(value)}
      style={{
        color: palette.textSecondary,
        display: 'inline-block', maxWidth: 'calc(100% - 24px)', verticalAlign: 'middle',
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}
    >
      {String(value)}
    </span>
  )
}

/** The series other than the one a hovered legend item names (CHT-03). */
const DIMMED = 0.3
/** A hovered day's dot on a line (CHT-03). */
export const ACTIVE_DOT = { r: 5 }
/** A hovered day's bar (CHT-03): outlined in ink, its colour left alone. */
export const ACTIVE_BAR = { stroke: palette.ink, strokeWidth: 1 }

/**
 * A phone's legend (MOB-03): one item per line, under the plot, left at the
 * card's inset -- a row of coat names wrapped into a ragged block there.
 *
 * `align` stays centre: Recharts reserves a vertical legend's WIDTH beside
 * the plot when it is aligned left or right (appendOffsetOfLegend), which
 * squeezed the chart into two thirds of a phone. Centred, it reserves its
 * HEIGHT under the plot, and `left: 0` pins the wrapper to the plot's left
 * edge -- every chart here has no left margin -- instead of centring it.
 */
const PHONE_LEGEND = {
  layout: 'vertical', align: 'center', verticalAlign: 'bottom', wrapperStyle: { left: 0, width: '100%' },
  formatter: phoneLegendText,
} as const
/**
 * One vertical legend line as Chromium draws it (24 px, measured at 390); the
 * chart grows by one per item past the first, so the plot keeps its height.
 */
const LEGEND_LINE = 24

/**
 * Hovering a legend item highlights its series (CHT-03): the others dim to
 * 0.3 until the pointer leaves. Keyed by the series' `dataKey`, which Recharts
 * hands the legend handlers. Click-to-hide is deliberately not wired. On a
 * phone the legend stands one item per line (MOB-03), and `height` adds the
 * lines it takes beyond the one-row legend the chart's height was set for.
 * `desktop` keeps the desktop layout on any screen (a chart drawn for a report).
 */
export function useLegendHighlight({ desktop = false }: { desktop?: boolean } = {}) {
  const [active, setActive] = useState<string | null>(null)
  const phone = useFieldPhone() && !desktop
  return {
    legend: {
      ...(phone ? PHONE_LEGEND : {}),
      onMouseEnter: (entry: LegendPayload) =>
        setActive(typeof entry.dataKey === 'string' ? entry.dataKey : null),
      onMouseLeave: () => setActive(null),
    },
    opacity: (dataKey: string) => (active === null || active === dataKey ? 1 : DIMMED),
    height: (base: number, items: number) => (phone ? base + Math.max(0, items - 1) * LEGEND_LINE : base),
    phone,
  }
}
