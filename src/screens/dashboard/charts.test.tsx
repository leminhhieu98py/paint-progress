import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { KpiDay } from '../../domain/kpi'
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
    Tooltip: () => null,
    // The legend prints one entry through the chart's own `formatter`, which
    // is where QA F3 puts the label's colour; the real Legend needs a sized
    // chart to render anything at all.
    Legend: (props: { formatter?: (value: string) => React.ReactNode }) => (
      <div data-testid="legend">{props.formatter ? props.formatter('Kế hoạch') : 'Kế hoạch'}</div>
    ),
    // The four series print the one prop RV6-29 changes -- their colour -- and
    // the plan line its dash, which RV6-29 must leave alone.
    Bar: (props: Record<string, unknown>) => (
      <div data-testid={`kpi-bar-${String(props.dataKey)}`} data-fill={String(props.fill)} data-name={String(props.name)} />
    ),
    Line: (props: Record<string, unknown>) => (
      <div
        data-testid={`kpi-line-${String(props.dataKey)}`}
        data-stroke={String(props.stroke)}
        data-dash={props.strokeDasharray === undefined ? '' : String(props.strokeDasharray)}
        data-connectnulls={String(props.connectNulls ?? false)}
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
