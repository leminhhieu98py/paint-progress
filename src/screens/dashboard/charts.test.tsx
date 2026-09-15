import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { KpiDay } from '../../domain/kpi'
import { KpiComboChart } from './charts'

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
    Brush: (props: Record<string, unknown>) => (
      <div data-testid="kpi-brush" data-day-key={String(props.dataKey)} />
    ),
    CartesianGrid: () => null,
    XAxis: () => null,
    YAxis: () => null,
    Tooltip: () => null,
    Legend: () => null,
    Bar: () => null,
    Line: () => null,
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
})
