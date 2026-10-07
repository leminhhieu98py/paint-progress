import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ManpowerPoint } from '../../../domain/piping/manpower'
import type { ManpowerGroup } from '../../../domain/piping/types'
import { palette } from '../../../theme'
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
    Brush: () => <div data-testid="brush" />,
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
    Legend: () => <div data-testid="legend" />,
    Bar: (props: Record<string, unknown>) => (
      <div
        data-testid="bar"
        data-key={String(props.dataKey)}
        data-name={String(props.name)}
        data-stack={String(props.stackId)}
        data-fill={String(props.fill)}
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

const attrs = (testId: string, attr: string) => screen.getAllByTestId(testId).map((el) => el.getAttribute(attr))

beforeEach(() => {
  captured.data = []
  captured.tooltip = null
  captured.xAxis = null
  captured.yAxis = null
})

describe('ManpowerChart (spec §5)', () => {
  it('stacks the groups for Plan and for Actual side by side, with a total line each', () => {
    render(<ManpowerChart data={DAYS} groups={GROUPS} mode="day" />)
    expect(attrs('bar', 'data-name')).toEqual([
      'Plan · Reinstatement', 'Plan · Insulation', 'Actual · Reinstatement', 'Actual · Insulation',
    ])
    expect(attrs('bar', 'data-stack')).toEqual(['plan', 'plan', 'actual', 'actual'])
    expect(attrs('line', 'data-name')).toEqual(['Plan tổng', 'Actual tổng'])
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

  it('colours each group from the categorical palette, its plan a tint of the same hue', () => {
    render(<ManpowerChart data={DAYS} groups={GROUPS} mode="day" />)
    const fills = attrs('bar', 'data-fill')
    expect(fills[2]).toBe(palette.categorical[0])
    expect(fills[3]).toBe(palette.categorical[1])
    expect(fills[0]).not.toBe(fills[2])
    expect(fills[0]).toMatch(/^#[0-9A-F]{6}$/)
  })

  it('says trung bình on every series in week view', () => {
    render(<ManpowerChart data={WEEKS} groups={GROUPS} mode="week" />)
    expect(attrs('bar', 'data-name')[0]).toBe('Plan · Reinstatement (trung bình)')
    expect(attrs('line', 'data-name')).toEqual(['Plan tổng (trung bình)', 'Actual tổng (trung bình)'])
  })

  it('labels the axis DD/MM, the tooltip with the bucket range, numbers in vi-VN and a gap as -', () => {
    render(<ManpowerChart data={WEEKS} groups={GROUPS} mode="week" />)
    const tick = captured.xAxis?.tickFormatter as (v: string) => string
    expect(tick('2026-10-05')).toBe('05/10')
    const label = captured.tooltip?.labelFormatter as (v: string) => string
    expect(label('2026-10-05')).toBe('05/10 – 11/10')
    const format = captured.tooltip?.formatter as (v: unknown) => string
    expect(format(10.5)).toBe('10,5')
    expect(format(null)).toBe('-')
    const yTick = captured.yAxis?.tickFormatter as (v: number) => string
    expect(yTick(1800)).toBe('1.800')
  })
})
