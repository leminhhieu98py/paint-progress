import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CamPoint } from '../../../domain/piping/cam'
import { palette, tintColor } from '../../../theme'
import { legendNames } from '../../../test/legend'
import { setViewport } from '../../../test/viewport'
import { InsulationChart } from './InsulationChart'

/**
 * jsdom gives ResponsiveContainer no size, so the chart parts are stood in for
 * and print the props that carry the spec: which bars and lines, named by the
 * milestone (RV8-4), on which axis, coloured per milestone, Plan dashed. The
 * numbers themselves are domain/piping/cam's.
 */
const captured = vi.hoisted(() => ({
  tooltip: null as null | Record<string, unknown>,
  xAxis: null as null | Record<string, unknown>,
  yAxes: {} as Record<string, Record<string, unknown>>,
  legend: null as null | Record<string, unknown>,
}))

vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('recharts')>()
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    ComposedChart: ({ children, data }: { children: React.ReactNode; data: unknown[] }) => (
      <div data-testid="composed-chart" data-points={data.length}>{children}</div>
    ),
    Brush: () => <div data-testid="brush" />,
    CartesianGrid: () => null,
    XAxis: (props: Record<string, unknown>) => {
      captured.xAxis = props
      return null
    },
    YAxis: (props: Record<string, unknown>) => {
      captured.yAxes[String(props.yAxisId ?? 0)] = props
      return null
    },
    Tooltip: (props: Record<string, unknown>) => {
      captured.tooltip = props
      return null
    },
    Legend: (props: Record<string, unknown>) => {
      captured.legend = props
      return <div data-testid="legend" data-layout={String(props.layout ?? '')} />
    },
    Bar: (props: Record<string, unknown>) => (
      <div
        data-testid={`bar-${String(props.dataKey)}`}
        data-series=""
        data-name={String(props.name)}
        data-axis={String(props.yAxisId)}
        data-fill={String(props.fill)}
      />
    ),
    Line: (props: Record<string, unknown>) => (
      <div
        data-testid={`line-${String(props.dataKey)}`}
        data-series=""
        data-name={String(props.name)}
        data-axis={String(props.yAxisId)}
        data-stroke={String(props.stroke)}
        data-dash={String(props.strokeDasharray ?? '')}
        data-dot={String(props.dot !== false)}
      />
    ),
  }
})

const point = (over: Partial<CamPoint>): CamPoint => ({
  key: '2026-09-07', start: '2026-09-07', end: '2026-09-07', label: '07/09', tooltip: '07/09/2026',
  phPlanBar: 1, phActualBar: 1, ihPlanBar: 0, ihActualBar: 0, iwPlanBar: 0, iwActualBar: 0,
  phPlan: 1, phActual: 1, ihPlan: 0, ihActual: 0, iwPlan: 0, iwActual: 0, ...over,
})

const WEEKS: CamPoint[] = [
  point({ end: '2026-09-13', tooltip: '07/09 – 13/09' }),
  point({ key: '2026-09-14', start: '2026-09-14', end: '2026-09-20', label: '14/09', tooltip: '14/09 – 20/09', phActual: null }),
]

const LINES = ['phPlan', 'phActual', 'ihPlan', 'ihActual', 'iwPlan', 'iwActual'] as const
const BARS = ['phPlanBar', 'phActualBar', 'ihPlanBar', 'ihActualBar', 'iwPlanBar', 'iwActualBar'] as const
/** Every series, as `camSeriesKeys('both')` lists them. */
const ALL = [
  'phPlanBar', 'phActualBar', 'phPlan', 'phActual',
  'ihPlanBar', 'ihActualBar', 'ihPlan', 'ihActual',
  'iwPlanBar', 'iwActualBar', 'iwPlan', 'iwActual',
] as const
const line = (key: string) => screen.queryByTestId(`line-${key}`)
const bar = (key: string) => screen.queryByTestId(`bar-${key}`)

beforeEach(() => {
  captured.tooltip = null
  captured.xAxis = null
  captured.yAxes = {}
  captured.legend = null
})

/** The legend's names, in the order Recharts lists the drawn series. */
const legend = () => legendNames(
  [...document.querySelectorAll('[data-series]')].map((el) => ({
    dataKey: String(el.getAttribute('data-testid')).replace(/^(line|bar)-/, ''),
    value: String(el.getAttribute('data-name')),
  })),
  captured.legend?.itemSorter,
)

describe('InsulationChart (spec §6.4, Q20A)', () => {
  it('draws the six cumulative lines on the right axis, saying lũy kế (RV8-11)', () => {
    render(<InsulationChart data={WEEKS} keys={[...ALL]} mode="week" />)
    expect(screen.getByTestId('composed-chart')).toHaveAttribute('data-points', '2')
    expect(LINES.map((k) => line(k)?.getAttribute('data-name'))).toEqual([
      'Pip Plan lũy kế', 'Pip Act lũy kế',
      'Paint Plan lũy kế', 'Paint Act lũy kế',
      'Insu Plan lũy kế', 'Insu Act lũy kế',
    ])
    for (const k of LINES) expect(line(k)).toHaveAttribute('data-axis', 'cum')
    expect(captured.yAxes.cum.orientation).toBe('right')
  })

  it('draws the Plan and Act bars per bucket on the left axis (RV8-11)', () => {
    render(<InsulationChart data={WEEKS} keys={[...ALL]} mode="week" />)
    expect(BARS.map((k) => bar(k)?.getAttribute('data-name'))).toEqual([
      'Pip Plan', 'Pip Act', 'Paint Plan', 'Paint Act', 'Insu Plan', 'Insu Act',
    ])
    for (const k of BARS) expect(bar(k)).toHaveAttribute('data-axis', 'bucket')
    expect(captured.yAxes.bucket.orientation).toBeUndefined()
  })

  it('lists the legend by discipline: Plan and Act bars, then their lũy kế lines', () => {
    render(<InsulationChart data={WEEKS} keys={[...ALL]} mode="day" />)
    expect(legend()).toEqual([
      'Pip Plan', 'Pip Act', 'Pip Plan lũy kế', 'Pip Act lũy kế',
      'Paint Plan', 'Paint Act', 'Paint Plan lũy kế', 'Paint Act lũy kế',
      'Insu Plan', 'Insu Act', 'Insu Plan lũy kế', 'Insu Act lũy kế',
    ])
  })

  it('keeps one colour per milestone, Plan dashed and Actual solid, three distinct palette hues', () => {
    render(<InsulationChart data={WEEKS} keys={[...ALL]} mode="day" />)
    const stroke = (k: string) => line(k)?.getAttribute('data-stroke')
    expect(stroke('phPlan')).toBe(stroke('phActual'))
    expect(stroke('ihPlan')).toBe(stroke('ihActual'))
    expect(stroke('iwPlan')).toBe(stroke('iwActual'))
    const hues = new Set([stroke('phPlan'), stroke('ihPlan'), stroke('iwPlan')])
    expect(hues.size).toBe(3)
    for (const hue of hues) expect(palette.categorical as readonly string[]).toContain(hue)
    expect(line('phPlan')).not.toHaveAttribute('data-dash', '')
    expect(line('phActual')).toHaveAttribute('data-dash', '')
    // A bar shares its line's colour; the Plan bar is a lighter tint of it.
    for (const m of ['ph', 'ih', 'iw']) {
      expect(bar(`${m}ActualBar`)).toHaveAttribute('data-fill', stroke(`${m}Actual`))
      expect(bar(`${m}PlanBar`)).toHaveAttribute('data-fill', tintColor(stroke(`${m}Plan`)!, 0.5))
    }
  })

  it('draws only the bars and lines the toggle asks for', () => {
    render(<InsulationChart data={WEEKS} keys={['phPlanBar', 'phPlan', 'ihPlanBar', 'ihPlan', 'iwPlanBar', 'iwPlan']} mode="day" />)
    expect(line('phPlan')).toBeInTheDocument()
    expect(bar('phPlanBar')).toBeInTheDocument()
    expect(line('phActual')).toBeNull()
    expect(bar('phActualBar')).toBeNull()
    expect(line('iwActual')).toBeNull()
    expect(bar('iwActualBar')).toBeNull()
  })

  it('labels the axis DD/MM and the tooltip with the bucket, in vi-VN', () => {
    render(<InsulationChart data={WEEKS} keys={[...ALL]} mode="week" />)
    const tick = captured.xAxis?.tickFormatter as (v: string) => string
    expect(tick('2026-09-14')).toBe('14/09')
    const label = captured.tooltip?.labelFormatter as (v: string) => string
    expect(label('2026-09-14')).toBe('14/09 – 20/09')
    const format = captured.tooltip?.formatter as (v: unknown) => string
    expect(format(1234)).toBe('1.234')
    expect(format(null)).toBe('-')
    for (const id of ['bucket', 'cum']) {
      const yTick = captured.yAxes[id].tickFormatter as (v: number) => string
      expect(yTick(1800)).toBe('1.800')
      expect(captured.yAxes[id].allowDecimals).toBe(false)
    }
  })

  it('dots the Actual lines while the points can be told apart, not past 60', () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => point({ key: `k${i}` }))
    const { unmount } = render(<InsulationChart data={many(60)} keys={[...ALL]} mode="day" />)
    expect(line('phActual')).toHaveAttribute('data-dot', 'true')
    expect(line('phPlan')).toHaveAttribute('data-dot', 'false')
    unmount()
    render(<InsulationChart data={many(61)} keys={[...ALL]} mode="day" />)
    expect(line('phActual')).toHaveAttribute('data-dot', 'false')
  })
  it('report: the whole range on the desktop layout with no Brush, from a phone too (spec §10)', () => {
    const undo = setViewport(390)
    try {
      const { unmount } = render(<InsulationChart data={WEEKS} keys={[...ALL]} mode="week" />)
      expect(screen.getByTestId('brush')).toBeInTheDocument()
      expect(captured.yAxes.cum.hide).toBe(true)
      unmount()
      render(<InsulationChart data={WEEKS} keys={[...ALL]} mode="week" report />)
      expect(screen.queryByTestId('brush')).toBeNull()
      expect(captured.yAxes.cum.hide).toBe(false)
      expect(screen.getByTestId('legend')).toHaveAttribute('data-layout', '')
      expect(screen.getByTestId('insulation-chart').style.height).toBe('372px')
    } finally {
      undo()
    }
  })
})
