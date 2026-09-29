import { act, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { KpiDay } from '../../domain/kpi'
import { formatAreaM2, formatHours, formatMhrPerM2, formatPercent } from '../../lib/format'
import { palette } from '../../theme'
import { EfficiencyLineChart, HoursBarChart, KpiComboChart } from './charts'

/**
 * RV6-10's zoom/pan Brush and the container height it needs. jsdom's
 * ResponsiveContainer never reports a real size (see `KpiDashboard.test.tsx`'s
 * own note on this), so `ComposedChart` and its axes render nothing worth
 * asserting on here -- `domain/kpi.test.ts` already covers the numbers. What
 * this file can reach, and what RV6-10 actually changed, is: is a `Brush`
 * wired into the chart, and does the chart's own container carry the taller
 * height the brush needs. `ResponsiveContainer` and `ComposedChart` are
 * stood in for so their real (unobservable in jsdom) sizing logic does not
 * swallow the `Brush` before it ever mounts.
 */
/** What the charts hand the Legend and the Tooltip, for CHT-03. */
const captured = vi.hoisted(() => ({
  legend: null as null | Record<string, unknown>,
  tooltip: null as null | Record<string, unknown>,
}))

vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('recharts')>()
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    ComposedChart: ({ children }: { children: React.ReactNode }) => (
      <div data-testid="composed-chart">{children}</div>
    ),
    LineChart: ({ children }: { children: React.ReactNode }) => (
      <div data-testid="line-chart">{children}</div>
    ),
    BarChart: ({ children }: { children: React.ReactNode }) => (
      <div data-testid="bar-chart">{children}</div>
    ),
    Brush: (props: Record<string, unknown>) => (
      <div data-testid="kpi-brush" data-day-key={String(props.dataKey)} />
    ),
    CartesianGrid: () => null,
    XAxis: () => null,
    YAxis: () => null,
    Tooltip: (props: Record<string, unknown>) => {
      captured.tooltip = props
      return null
    },
    // The legend prints one entry through the chart's own `formatter`, which
    // is where QA F3 puts the label's colour; the real Legend needs a sized
    // chart to render anything at all.
    Legend: (props: { formatter?: (value: string) => React.ReactNode } & Record<string, unknown>) => {
      captured.legend = props
      return <div data-testid="legend">{props.formatter ? props.formatter('Kế hoạch') : 'Kế hoạch'}</div>
    },
    // The four series print the one prop RV6-29 changes -- their colour -- and
    // the plan line its dash, which RV6-29 must leave alone.
    Bar: (props: Record<string, unknown>) => (
      <div
        data-testid={`kpi-bar-${String(props.dataKey)}`}
        data-fill={String(props.fill)}
        data-name={String(props.name)}
        data-opacity={String(props.fillOpacity ?? 1)}
        data-active-bar={JSON.stringify(props.activeBar ?? null)}
      />
    ),
    Line: (props: Record<string, unknown>) => (
      <div
        data-testid={`kpi-line-${String(props.dataKey)}`}
        data-stroke={String(props.stroke)}
        data-dash={props.strokeDasharray === undefined ? '' : String(props.strokeDasharray)}
        data-connectnulls={String(props.connectNulls ?? false)}
        data-opacity={String(props.strokeOpacity ?? 1)}
        data-active-dot={JSON.stringify(props.activeDot ?? null)}
      />
    ),
  }
})

const DATA: KpiDay[] = [
  { day: '2026-09-01', planM2: 100, actualM2: 100, planCumShare: 0.5, actualCumShare: 0.5 },
  { day: '2026-09-02', planM2: 100, actualM2: null, planCumShare: 1, actualCumShare: null },
]

describe('KpiComboChart', () => {
  it('wires a Brush into the chart for zoom/pan (RV6-10)', () => {
    render(<KpiComboChart data={DATA} />)
    expect(screen.getByTestId('kpi-brush')).toBeInTheDocument()
    expect(screen.getByTestId('kpi-brush')).toHaveAttribute('data-day-key', 'day')
  })

  it('grows the chart container to 372px so the plot area keeps its height', () => {
    render(<KpiComboChart data={DATA} />)
    expect(screen.getByTestId('kpi-chart')).toHaveStyle({ height: '372px' })
  })

  // ---------------------------------------------------------------------
  // RV6-29 / RV6-30 -- per-deck colours, and the defaults when there are none
  // ---------------------------------------------------------------------

  describe('series colours', () => {
    const fill = (key: string) => screen.getByTestId(`kpi-bar-${key}`).getAttribute('data-fill')
    const stroke = (key: string) => screen.getByTestId(`kpi-line-${key}`).getAttribute('data-stroke')

    it('paints plan grey and actual accent with no colours given (RV6-30)', () => {
      render(<KpiComboChart data={DATA} />)
      expect(fill('planM2')).toBe(palette.textQuaternary)
      expect(stroke('planCumShare')).toBe(palette.textTertiary)
      expect(fill('actualM2')).toBe(palette.accent)
      expect(stroke('actualCumShare')).toBe(palette.accentHover)
    })

    it('paints the plan bar and the plan line with the plan colour, and the actual pair with the actual colour', () => {
      render(<KpiComboChart data={DATA} colors={{ plan: '#123abc', actual: '#0000ff' }} />)
      expect(fill('planM2')).toBe('#123abc')
      expect(stroke('planCumShare')).toBe('#123abc')
      expect(fill('actualM2')).toBe('#0000ff')
      expect(stroke('actualCumShare')).toBe('#0000ff')
    })

    it('keeps the plan line dashed whatever its colour', () => {
      render(<KpiComboChart data={DATA} colors={{ plan: '#123abc', actual: '#0000ff' }} />)
      expect(screen.getByTestId('kpi-line-planCumShare').getAttribute('data-dash')).toBe('5 3')
      expect(screen.getByTestId('kpi-line-actualCumShare').getAttribute('data-dash')).toBe('')
    })

    it('falls back per family: a null colour is the default for that family alone', () => {
      render(<KpiComboChart data={DATA} colors={{ plan: null, actual: '#0000ff' }} />)
      expect(fill('planM2')).toBe(palette.textQuaternary)
      expect(stroke('planCumShare')).toBe(palette.textTertiary)
      expect(fill('actualM2')).toBe('#0000ff')
      expect(stroke('actualCumShare')).toBe('#0000ff')
    })
  })
})

describe('KpiComboChart: the work\'s unit (RV6-35)', () => {
  const name = (key: string) => screen.getByTestId(`kpi-bar-${key}`).getAttribute('data-name')

  it('names the daily series in the unit it is given', () => {
    render(<KpiComboChart data={DATA} unit="tấn" />)
    expect(name('planM2')).toBe('Kế hoạch (tấn/ngày)')
    expect(name('actualM2')).toBe('Thực hiện (tấn/ngày)')
  })

  it('names them in m² when no unit is given', () => {
    render(<KpiComboChart data={DATA} />)
    expect(name('planM2')).toBe('Kế hoạch (m²/ngày)')
    expect(name('actualM2')).toBe('Thực hiện (m²/ngày)')
  })
})

describe('legend text colour (QA F3)', () => {
  // Recharts paints a legend entry's text in the series colour, so a yellow
  // or a grey coat was unreadable on white. The marker keeps the colour; the
  // label reads in the neutral secondary text colour on every chart.
  const legendText = () => within(screen.getByTestId('legend')).getByText('Kế hoạch')

  it('reads the KPI combo legend in the secondary text colour', () => {
    render(<KpiComboChart data={DATA} colors={{ plan: '#fadb14', actual: '#00ff1e' }} />)
    expect(legendText()).toHaveStyle({ color: palette.textSecondary })
  })

  it('reads the efficiency line legend in the secondary text colour', () => {
    render(
      <EfficiencyLineChart
        data={[{ day: '2026-09-01', 'Coat 1': 0.5 }]}
        stages={[{ name: 'Coat 1', color: '#fadb14' }]}
      />,
    )
    expect(legendText()).toHaveStyle({ color: palette.textSecondary })
  })

  it('reads the hours bar legend in the secondary text colour', () => {
    render(<HoursBarChart data={[{ day: '2026-09-01', hours: 8, wasteHours: 1 }]} />)
    expect(legendText()).toHaveStyle({ color: palette.textSecondary })
  })
})

describe('EfficiencyLineChart: missing days (QA F4)', () => {
  it('does not draw the line across a day with no ratio', () => {
    // The data is padded to every calendar day, and a day nobody worked a
    // coat is a null: a gap in the line, not a slope joining the days either
    // side of it as though work had gone on.
    render(
      <EfficiencyLineChart
        data={[{ day: '2026-09-01', 'Coat 1': 0.5 }, { day: '2026-09-02', 'Coat 1': null }, { day: '2026-09-03', 'Coat 1': 0.7 }]}
        stages={[{ name: 'Coat 1', color: '#fadb14' }]}
      />,
    )
    expect(screen.getByTestId('kpi-line-Coat 1')).toHaveAttribute('data-connectnulls', 'false')
  })
})

// ---------------------------------------------------------------------
// CHT-01 / CHT-03 -- colours the app picks, legend hover, tooltips, active marks
// ---------------------------------------------------------------------

/** Hover the legend item of `dataKey`, as Recharts reports it, then leave it. */
const hoverLegend = (dataKey: string) => act(() => {
  const enter = captured.legend?.onMouseEnter as (entry: { dataKey: string; value: string }, i: number) => void
  enter({ dataKey, value: dataKey }, 0)
})
const leaveLegend = () => act(() => {
  const leave = captured.legend?.onMouseLeave as (entry: { dataKey: string; value: string }, i: number) => void
  leave({ dataKey: '', value: '' }, 0)
})
const opacity = (id: string) => screen.getByTestId(id).getAttribute('data-opacity')
const format = (value: number, name: string) =>
  (captured.tooltip?.formatter as (v: number, n: string) => unknown)(value, name)
const label = (day: string) => (captured.tooltip?.labelFormatter as (d: string) => unknown)(day)

describe('EfficiencyLineChart: legend hover and active dot (CHT-03)', () => {
  const STAGES = [{ name: 'Coat 1', color: '#fadb14' }, { name: 'Coat 2', color: '#722ed1' }]
  const renderChart = () => render(
    <EfficiencyLineChart data={[{ day: '2026-09-01', 'Coat 1': 0.5, 'Coat 2': 0.25 }]} stages={STAGES} />,
  )

  it('keeps the hovered legend item\'s line and dims the others to 0.3, until the pointer leaves', () => {
    renderChart()
    expect(opacity('kpi-line-Coat 1')).toBe('1')
    hoverLegend('Coat 2')
    expect(opacity('kpi-line-Coat 2')).toBe('1')
    expect(opacity('kpi-line-Coat 1')).toBe('0.3')
    leaveLegend()
    expect(opacity('kpi-line-Coat 1')).toBe('1')
  })

  it('keeps the coats\' own colours, which an admin configures', () => {
    renderChart()
    expect(screen.getByTestId('kpi-line-Coat 2')).toHaveAttribute('data-stroke', '#722ed1')
  })

  it('marks the hovered day with an active dot and reads it in the app\'s format', () => {
    renderChart()
    expect(JSON.parse(screen.getByTestId('kpi-line-Coat 1').getAttribute('data-active-dot') ?? 'null')).toMatchObject({ r: 5 })
    expect(label('2026-09-04')).toBe('04/09')
    expect(format(0.125, 'Coat 1')).toBe(formatMhrPerM2(0.125))
  })
})

describe('HoursBarChart: palette, legend hover and active bar (CHT-01, CHT-03)', () => {
  const renderChart = () => render(<HoursBarChart data={[{ day: '2026-09-01', hours: 8, wasteHours: 1 }]} />)

  it('paints its two series from the categorical palette: done in the accent, waste in the red', () => {
    renderChart()
    expect(screen.getByTestId('kpi-bar-hours')).toHaveAttribute('data-fill', palette.categorical[0])
    expect(screen.getByTestId('kpi-bar-wasteHours')).toHaveAttribute('data-fill', palette.categorical[3])
  })

  it('keeps the hovered legend item\'s bars and dims the other series to 0.3', () => {
    renderChart()
    hoverLegend('wasteHours')
    expect(opacity('kpi-bar-wasteHours')).toBe('1')
    expect(opacity('kpi-bar-hours')).toBe('0.3')
    leaveLegend()
    expect(opacity('kpi-bar-hours')).toBe('1')
  })

  it('gives a hovered bar an active state and reads it in hours, under Vietnamese names', () => {
    renderChart()
    expect(JSON.parse(screen.getByTestId('kpi-bar-hours').getAttribute('data-active-bar') ?? 'null')).toMatchObject({ stroke: palette.ink })
    expect(screen.getByTestId('kpi-bar-hours')).toHaveAttribute('data-name', 'Thực hiện')
    expect(screen.getByTestId('kpi-bar-wasteHours')).toHaveAttribute('data-name', 'Hao phí')
    expect(format(7.5, 'Thực hiện')).toBe(formatHours(7.5))
  })
})

describe('KpiComboChart: legend hover and active marks (CHT-03)', () => {
  it('keeps the hovered legend item\'s series and dims the other three to 0.3', () => {
    render(<KpiComboChart data={DATA} />)
    hoverLegend('actualCumShare')
    expect(opacity('kpi-line-actualCumShare')).toBe('1')
    expect(opacity('kpi-line-planCumShare')).toBe('0.3')
    expect(opacity('kpi-bar-planM2')).toBe('0.3')
    expect(opacity('kpi-bar-actualM2')).toBe('0.3')
    leaveLegend()
    expect(opacity('kpi-bar-planM2')).toBe('1')
  })

  it('gives bars an active state and both lines an active dot, the plan line included', () => {
    render(<KpiComboChart data={DATA} />)
    for (const key of ['planM2', 'actualM2']) {
      expect(JSON.parse(screen.getByTestId(`kpi-bar-${key}`).getAttribute('data-active-bar') ?? 'null')).toMatchObject({ stroke: palette.ink })
    }
    for (const key of ['planCumShare', 'actualCumShare']) {
      expect(JSON.parse(screen.getByTestId(`kpi-line-${key}`).getAttribute('data-active-dot') ?? 'null')).toMatchObject({ r: 5 })
    }
  })

  it('reads a share as a percentage and a quantity in the app\'s number format', () => {
    render(<KpiComboChart data={DATA} />)
    expect(format(0.5, 'Luỹ kế kế hoạch')).toBe(formatPercent(0.5))
    expect(format(100, 'Kế hoạch (m²/ngày)')).toBe(formatAreaM2(100))
  })
})
