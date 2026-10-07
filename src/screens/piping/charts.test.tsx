import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReinstatementPoint } from '../../domain/piping/reinstatement'
import { ReinstatementChart } from './charts'

/**
 * jsdom gives ResponsiveContainer no size, so the chart parts are stood in for
 * and print the props that carry the spec: which series, named how (spec §3:
 * "lũy kế" said explicitly), on which axis, and what the axis and tooltip
 * read. The numbers themselves are domain/piping/reinstatement's.
 */
const captured = vi.hoisted(() => ({
  tooltip: null as null | Record<string, unknown>,
  xAxis: null as null | Record<string, unknown>,
  yAxes: {} as Record<string, Record<string, unknown>>,
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
    Legend: () => <div data-testid="legend" />,
    Bar: (props: Record<string, unknown>) => (
      <div data-testid={`bar-${String(props.dataKey)}`} data-name={String(props.name)} data-axis={String(props.yAxisId)} />
    ),
    Line: (props: Record<string, unknown>) => (
      <div data-testid={`line-${String(props.dataKey)}`} data-name={String(props.name)} data-axis={String(props.yAxisId)} />
    ),
  }
})

const point = (over: Partial<ReinstatementPoint>): ReinstatementPoint => ({
  key: '2026-09-07', start: '2026-09-07', end: '2026-09-07', label: '07/09', tooltip: '07/09/2026',
  plan: 10, planCum: 10, actual: 4, actualCum: 4, ...over,
})

const DAYS: ReinstatementPoint[] = [
  point({}),
  point({ key: '2026-09-08', start: '2026-09-08', end: '2026-09-08', label: '08/09', tooltip: '08/09/2026', plan: 1234.5, planCum: 1244.5, actual: null, actualCum: null }),
]

const WEEKS: ReinstatementPoint[] = [
  point({ end: '2026-09-13', tooltip: '07/09 – 13/09' }),
  point({ key: '2026-09-14', start: '2026-09-14', end: '2026-09-20', label: '14/09', tooltip: '14/09 – 20/09' }),
]

const name = (testId: string) => screen.getByTestId(testId).getAttribute('data-name')

beforeEach(() => {
  captured.tooltip = null
  captured.xAxis = null
  captured.yAxes = {}
})

describe('ReinstatementChart (spec §4, R-5)', () => {
  it('draws Plan and Actual bars per day and the two cumulative lines, named with lũy kế', () => {
    render(<ReinstatementChart data={DAYS} mode="day" />)
    expect(screen.getByTestId('composed-chart')).toHaveAttribute('data-points', '2')
    expect(name('bar-plan')).toBe('Plan theo ngày')
    expect(name('bar-actual')).toBe('Actual theo ngày')
    expect(name('line-planCum')).toBe('Plan lũy kế')
    expect(name('line-actualCum')).toBe('Actual lũy kế')
    // Bars on the left axis, cumulative lines on their own right axis.
    expect(screen.getByTestId('bar-plan')).toHaveAttribute('data-axis', 'bucket')
    expect(screen.getByTestId('line-actualCum')).toHaveAttribute('data-axis', 'cum')
    expect(captured.yAxes.cum.orientation).toBe('right')
  })

  it('names the bars per week in week view', () => {
    render(<ReinstatementChart data={WEEKS} mode="week" />)
    expect(name('bar-plan')).toBe('Plan theo tuần')
    expect(name('bar-actual')).toBe('Actual theo tuần')
    expect(name('line-planCum')).toBe('Plan lũy kế')
  })

  it('labels the axis DD/MM and the tooltip with the bucket range', () => {
    render(<ReinstatementChart data={WEEKS} mode="week" />)
    const tick = captured.xAxis?.tickFormatter as (v: string) => string
    expect(tick('2026-09-14')).toBe('14/09')
    const label = captured.tooltip?.labelFormatter as (v: string) => string
    expect(label('2026-09-14')).toBe('14/09 – 20/09')
  })

  it('reads numbers in vi-VN and a missing value as -', () => {
    render(<ReinstatementChart data={DAYS} mode="day" />)
    const format = captured.tooltip?.formatter as (v: unknown) => string
    expect(format(1234.5)).toBe('1.234,5')
    expect(format(null)).toBe('-')
    const tick = captured.yAxes.bucket.tickFormatter as (v: number) => string
    expect(tick(1800)).toBe('1.800')
  })
})
