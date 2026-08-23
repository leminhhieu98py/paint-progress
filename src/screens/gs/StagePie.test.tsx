import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { PieSlice } from '../../domain/pieSlices'
import { StagePie } from './StagePie'

// recharts measures its container to lay out an SVG, and jsdom reports zero for
// every dimension, so the real chart renders nothing here. The doubles expose
// the props the component passes so the contract between this component and
// recharts is still asserted -- which data array, which key, which colour per
// slice. That recharts itself draws is verified in a real browser (Task 11).
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="responsive">{children}</div>
  ),
  PieChart: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="piechart">{children}</div>
  ),
  Pie: ({
    data, dataKey, nameKey, children,
  }: {
    data: PieSlice[]
    dataKey: string
    nameKey: string
    children: React.ReactNode
  }) => (
    <div
      data-testid="pie"
      data-datakey={dataKey}
      data-namekey={nameKey}
      data-values={data.map((d) => d.areaM2).join(',')}
    >
      {children}
    </div>
  ),
  Cell: ({ fill }: { fill: string }) => <div data-testid="pie-cell" data-fill={fill} />,
  Tooltip: () => <div data-testid="tooltip" />,
}))

const SLICES: PieSlice[] = [
  { key: 'coat1', label: 'Blast + Coat 1', areaM2: 300, color: '#fadb14' },
  { key: 'coat2', label: 'Coat 2', areaM2: 200, color: '#bfbfbf' },
  { key: 'coat3', label: 'Coat 3', areaM2: 0, color: '#52c41a' },
  { key: 'not-started', label: 'Chưa bắt đầu', areaM2: 100, color: '#d9d9d9' },
  { key: 'unmapped', label: 'Chưa chia ô', areaM2: 400, color: '#8c8c8c' },
]

describe('StagePie', () => {
  it('puts the deck\'s progress in the centre', () => {
    render(<StagePie slices={SLICES} totalAreaM2={1000} progress={0.155} />)
    // prog(D) from computeDeckProgress, formatted vi-VN. This is the number
    // the customer is billed against.
    expect(screen.getByTestId('gs-deck-progress')).toHaveTextContent('15,50%')
  })

  it('hands recharts every slice, including the unmapped one', () => {
    render(<StagePie slices={SLICES} totalAreaM2={1000} progress={0.155} />)
    expect(screen.getByTestId('pie')).toHaveAttribute('data-values', '300,200,0,100,400')
    expect(screen.getByTestId('pie')).toHaveAttribute('data-datakey', 'areaM2')
    expect(screen.getByTestId('pie')).toHaveAttribute('data-namekey', 'label')
  })

  it('colours the cells in slice order', () => {
    render(<StagePie slices={SLICES} totalAreaM2={1000} progress={0.155} />)
    // One Cell per slice, in the same order: recharts pairs them positionally,
    // so a legend built from `slices` and Cells built from anything else would
    // put the wrong colour against the wrong stage.
    expect(screen.getAllByTestId('pie-cell').map((el) => el.getAttribute('data-fill')))
      .toEqual(['#fadb14', '#bfbfbf', '#52c41a', '#d9d9d9', '#8c8c8c'])
  })

  it('lists every slice with its area and its share of the deck', () => {
    render(<StagePie slices={SLICES} totalAreaM2={1000} progress={0.155} />)

    const row = screen.getByTestId('legend-coat1')
    expect(row).toHaveTextContent('Blast + Coat 1')
    expect(row).toHaveTextContent('300,00 m²')
    // 300 / 1000. Divided by the deck's declared area, which is passed in
    // explicitly, NOT by the sum of the slices.
    expect(row).toHaveTextContent('30,00%')

    expect(screen.getByTestId('legend-unmapped')).toHaveTextContent('40,00%')
  })

  it('keeps dividing by the deck\'s declared area when the cells over-cover it', () => {
    // 300 + 400 = 700 m² of cells on a deck declaring 500, so there is no
    // unmapped slice and the shares add up to more than 100%. That is the
    // honest reading: the deck's declared area is the denominator every other
    // number in the app uses. An implementation that divides by the slice sum
    // would report 42,86% and 57,14% here and look tidier while disagreeing
    // with the report.
    render(
      <StagePie
        slices={[
          { key: 'coat1', label: 'Blast + Coat 1', areaM2: 300, color: '#fadb14' },
          { key: 'coat2', label: 'Coat 2', areaM2: 400, color: '#bfbfbf' },
        ]}
        totalAreaM2={500}
        progress={0.5}
      />,
    )
    expect(screen.getByTestId('legend-coat1')).toHaveTextContent('60,00%')
    expect(screen.getByTestId('legend-coat2')).toHaveTextContent('80,00%')
  })

  it('renders zero shares rather than dividing by zero', () => {
    render(<StagePie slices={SLICES} totalAreaM2={0} progress={0} />)
    // A deck whose total_area_m2 has not been entered yet: `not null default 0`
    // and createDeck never sets it, so this is the state every deck starts in.
    expect(screen.getByTestId('legend-coat1')).toHaveTextContent('0,00%')
    expect(screen.getByTestId('gs-deck-progress')).toHaveTextContent('0,00%')
  })
})
