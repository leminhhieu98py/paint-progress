import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ManpowerPoint } from '../../../domain/piping/manpower'
import type { ManpowerGroup } from '../../../domain/piping/types'
import { palette, tintColor } from '../../../theme'
import { setViewport } from '../../../test/viewport'
import { ManpowerChart } from './ManpowerChart'

/**
 * jsdom gives ResponsiveContainer no size, so the chart parts are stood in for
 * and print the props that carry the spec: one stack of the groups for Plan
 * and one for Actual, the two total lines, the names ("trung bình" said
 * explicitly in week view, spec §3) and what the axis and tooltip read. The
 * numbers themselves are domain/piping/manpower's.
 */
const captured = vi.hoisted(() => ({
  data: [] as Array<Record<string, unknown>>,
  tooltip: null as null | Record<string, unknown>,
  xAxis: null as null | Record<string, unknown>,
  yAxis: null as null | Record<string, unknown>,
  brush: null as null | Record<string, unknown>,
}))

vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('recharts')>()
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    ComposedChart: ({ children, data }: { children: React.ReactNode; data: Array<Record<string, unknown>> }) => {
      captured.data = data
      return <div data-testid="composed-chart">{children}</div>
    },
    Brush: (props: Record<string, unknown>) => {
      captured.brush = props
      return <div data-testid="brush" />
    },
    CartesianGrid: () => null,
    XAxis: (props: Record<string, unknown>) => {
      captured.xAxis = props
      return null
    },
    YAxis: (props: Record<string, unknown>) => {
      captured.yAxis = props
      return null
    },
    Tooltip: (props: Record<string, unknown>) => {
      captured.tooltip = props
      return null
    },
    Legend: (props: Record<string, unknown>) => <div data-testid="legend" data-layout={String(props.layout ?? '')} />,
    Bar: (props: Record<string, unknown>) => (
      <div
        data-testid="bar"
        data-key={String(props.dataKey)}
        data-name={String(props.name)}
        data-stack={String(props.stackId)}
        data-fill={String(props.fill)}
        data-stroke={String(props.stroke)}
        data-stroke-width={String(props.strokeWidth)}
      />
    ),
    Line: (props: Record<string, unknown>) => (
      <div data-testid="line" data-key={String(props.dataKey)} data-name={String(props.name)} />
    ),
  }
})

const GROUPS: ManpowerGroup[] = [
  { id: 'g1', name: 'Reinstatement', sort: 1, hidden: false },
  { id: 'g2', name: 'Insulation', sort: 2, hidden: true },
]

const point = (over: Partial<ManpowerPoint>): ManpowerPoint => ({
  key: '2026-10-05', start: '2026-10-05', end: '2026-10-05', label: '05/10', tooltip: '05/10/2026',
  plan: { g1: 10, g2: 4 }, actual: { g1: 8, g2: null }, planTotal: 14, actualTotal: 8, ...over,
})

const DAYS = [point({}), point({ key: '2026-10-06', start: '2026-10-06', end: '2026-10-06', tooltip: '06/10/2026' })]
const WEEKS = [point({ key: '2026-10-05', end: '2026-10-11', tooltip: '05/10 – 11/10', plan: { g1: 10.5, g2: null } })]

/** WCAG contrast of a `#RRGGBB` colour against white. */
function contrastOnWhite(hex: string): number {
  const lin = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  const l = 0.2126 * lin(1) + 0.7152 * lin(3) + 0.0722 * lin(5)
  return 1.05 / (l + 0.05)
}

const manyGroups = (n: number): ManpowerGroup[] =>
  Array.from({ length: n }, (_, i) => ({ id: `g${i}`, name: `G${i}`, sort: i, hidden: false }))

const days = (n: number): ManpowerPoint[] => Array.from({ length: n }, (_, i) => {
  const day = new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10)
  return point({ key: day, start: day, end: day })
})

const attrs = (testId: string, attr: string) => screen.getAllByTestId(testId).map((el) => el.getAttribute(attr))

beforeEach(() => {
  captured.data = []
  captured.tooltip = null
  captured.xAxis = null
  captured.yAxis = null
  captured.brush = null
})

describe('ManpowerChart (spec §5)', () => {
  it('stacks the groups for Plan and for Actual side by side, with a total line each', () => {
    render(<ManpowerChart data={DAYS} groups={GROUPS} mode="day" />)
    expect(attrs('bar', 'data-name')).toEqual([
      'Plan · Reinstatement', 'Plan · Insulation', 'Actual · Reinstatement', 'Actual · Insulation',
    ])
    expect(attrs('bar', 'data-stack')).toEqual(['plan', 'plan', 'actual', 'actual'])
    expect(attrs('line', 'data-name')).toEqual(['Plan tổng theo ngày', 'Actual tổng theo ngày'])
    expect(attrs('line', 'data-key')).toEqual(['planTotal', 'actualTotal'])
  })

  it('hands Recharts one flat row per bucket', () => {
    render(<ManpowerChart data={DAYS} groups={GROUPS} mode="day" />)
    expect(captured.data).toHaveLength(2)
    const keys = attrs('bar', 'data-key')
    expect(keys.map((k) => captured.data[0][k as string])).toEqual([10, 4, 8, null])
    expect(captured.data[0].planTotal).toBe(14)
    expect(captured.data[0].actualTotal).toBe(8)
  })

  it('colours each group from the categorical palette: Actual solid, Plan a tint outlined in the hue', () => {
    render(<ManpowerChart data={DAYS} groups={GROUPS} mode="day" />)
    const fills = attrs('bar', 'data-fill')
    const strokes = attrs('bar', 'data-stroke')
    expect(fills.slice(2)).toEqual([palette.categorical[0], palette.categorical[1]])
    expect(strokes.slice(2)).toEqual(['undefined', 'undefined'])
    expect(fills.slice(0, 2)).toEqual([tintColor(palette.categorical[0], 0.55), tintColor(palette.categorical[1], 0.55)])
    expect(strokes.slice(0, 2)).toEqual([palette.categorical[0], palette.categorical[1]])
    expect(attrs('bar', 'data-stroke-width').slice(0, 2)).toEqual(['1.5', '1.5'])
  })

  it('gives every Plan bar a boundary of at least 3:1 on white (CHT-01)', () => {
    render(<ManpowerChart data={DAYS} groups={manyGroups(8)} mode="day" />)
    for (const stroke of attrs('bar', 'data-stroke').slice(0, 8)) {
      expect(contrastOnWhite(stroke as string)).toBeGreaterThanOrEqual(3)
    }
  })

  it('never paints a Plan bar like any Actual bar, past eight groups too', () => {
    render(<ManpowerChart data={DAYS} groups={manyGroups(12)} mode="day" />)
    const fills = attrs('bar', 'data-fill')
    const plan = new Set(fills.slice(0, 12))
    for (const actual of fills.slice(12)) expect(plan.has(actual)).toBe(false)
    for (const stroke of attrs('bar', 'data-stroke').slice(0, 12)) {
      expect(contrastOnWhite(stroke as string)).toBeGreaterThanOrEqual(3)
    }
  })

  it('says trung bình on the total lines and the tooltip in week view only', () => {
    render(<ManpowerChart data={WEEKS} groups={GROUPS} mode="week" />)
    expect(attrs('bar', 'data-name')[0]).toBe('Plan · Reinstatement')
    expect(attrs('line', 'data-name')).toEqual(['Plan tổng (trung bình)', 'Actual tổng (trung bình)'])
    const label = captured.tooltip?.labelFormatter as (v: string) => string
    expect(label('2026-10-05')).toBe('05/10 – 11/10 · trung bình')
  })

  it('opens the day view on the last 90 days of a long range', () => {
    const { unmount } = render(<ManpowerChart data={days(120)} groups={GROUPS} mode="day" />)
    expect(captured.brush?.startIndex).toBe(30)
    unmount()
    render(<ManpowerChart data={days(90)} groups={GROUPS} mode="day" />)
    expect(captured.brush?.startIndex).toBeUndefined()
  })

  it('labels the axis DD/MM, the tooltip with the bucket range, numbers in vi-VN and a gap as -', () => {
    render(<ManpowerChart data={WEEKS} groups={GROUPS} mode="week" />)
    const tick = captured.xAxis?.tickFormatter as (v: string) => string
    expect(tick('2026-10-05')).toBe('05/10')
    const label = captured.tooltip?.labelFormatter as (v: string) => string
    expect(label('2026-10-05')).toBe('05/10 – 11/10 · trung bình')
    const format = captured.tooltip?.formatter as (v: unknown) => string
    expect(format(10.5)).toBe('10,5')
    expect(format(null)).toBe('-')
    const yTick = captured.yAxis?.tickFormatter as (v: number) => string
    expect(yTick(1800)).toBe('1.800')
  })
  it('report: every day of a long range on the desktop layout with no Brush, from a phone too (spec §10)', () => {
    const undo = setViewport(390)
    try {
      render(<ManpowerChart data={days(120)} groups={GROUPS} mode="day" report />)
      expect(screen.queryByTestId('brush')).toBeNull()
      expect(captured.brush).toBeNull()
      expect(captured.data).toHaveLength(120)
      expect(captured.yAxis?.width).toBe(56)
      expect(screen.getByTestId('legend')).toHaveAttribute('data-layout', '')
      expect(screen.getByTestId('manpower-chart').style.height).toBe('372px')
    } finally {
      undo()
    }
  })
})
