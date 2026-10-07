import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CamPoint } from '../../../domain/piping/cam'
import { palette } from '../../../theme'
import { InsulationChart } from './InsulationChart'

/**
 * jsdom gives ResponsiveContainer no size, so the chart parts are stood in for
 * and print the props that carry the spec: which of the six lines, named as
 * the file names them (spec §0), coloured per milestone, Plan dashed. The
 * numbers themselves are domain/piping/cam's.
 */
const captured = vi.hoisted(() => ({
  tooltip: null as null | Record<string, unknown>,
  xAxis: null as null | Record<string, unknown>,
  yAxis: null as null | Record<string, unknown>,
}))

vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('recharts')>()
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    LineChart: ({ children, data }: { children: React.ReactNode; data: unknown[] }) => (
      <div data-testid="line-chart" data-points={data.length}>{children}</div>
    ),
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
    Line: (props: Record<string, unknown>) => (
      <div
        data-testid={`line-${String(props.dataKey)}`}
        data-name={String(props.name)}
        data-stroke={String(props.stroke)}
        data-dash={String(props.strokeDasharray ?? '')}
      />
    ),
  }
})

const point = (over: Partial<CamPoint>): CamPoint => ({
  key: '2026-09-07', start: '2026-09-07', end: '2026-09-07', label: '07/09', tooltip: '07/09/2026',
  phPlan: 1, phActual: 1, ihPlan: 0, ihActual: 0, iwPlan: 0, iwActual: 0, ...over,
})

const WEEKS: CamPoint[] = [
  point({ end: '2026-09-13', tooltip: '07/09 – 13/09' }),
  point({ key: '2026-09-14', start: '2026-09-14', end: '2026-09-20', label: '14/09', tooltip: '14/09 – 20/09', phActual: null }),
]

const ALL = ['phPlan', 'phActual', 'ihPlan', 'ihActual', 'iwPlan', 'iwActual'] as const
const line = (key: string) => screen.queryByTestId(`line-${key}`)

beforeEach(() => {
  captured.tooltip = null
  captured.xAxis = null
  captured.yAxis = null
})

describe('InsulationChart (spec §6.4, Q20A)', () => {
  it('draws the six cumulative lines named as the file names them', () => {
    render(<InsulationChart data={WEEKS} keys={[...ALL]} mode="week" />)
    expect(screen.getByTestId('line-chart')).toHaveAttribute('data-points', '2')
    expect(ALL.map((k) => line(k)?.getAttribute('data-name'))).toEqual([
      'Painting Handover – Plan', 'Painting Handover – Actual',
      'Insulation Handover – Plan', 'Insulation Handover – Actual',
      'Insulation Work – Plan', 'Insulation Work – Actual',
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
  })

  it('draws only the lines the toggle asks for', () => {
    render(<InsulationChart data={WEEKS} keys={['phPlan', 'ihPlan', 'iwPlan']} mode="day" />)
    expect(line('phPlan')).toBeInTheDocument()
    expect(line('phActual')).toBeNull()
    expect(line('iwActual')).toBeNull()
  })

  it('labels the axis DD/MM and the tooltip with the bucket, cumulative, in vi-VN', () => {
    render(<InsulationChart data={WEEKS} keys={[...ALL]} mode="week" />)
    const tick = captured.xAxis?.tickFormatter as (v: string) => string
    expect(tick('2026-09-14')).toBe('14/09')
    const label = captured.tooltip?.labelFormatter as (v: string) => string
    expect(label('2026-09-14')).toBe('14/09 – 20/09 · lũy kế')
    const format = captured.tooltip?.formatter as (v: unknown) => string
    expect(format(1234)).toBe('1.234')
    expect(format(null)).toBe('-')
    const yTick = captured.yAxis?.tickFormatter as (v: number) => string
    expect(yTick(1800)).toBe('1.800')
    expect(captured.yAxis?.allowDecimals).toBe(false)
  })
})
