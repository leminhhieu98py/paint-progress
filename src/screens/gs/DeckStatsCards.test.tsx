import { render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { DeckProgressCard, StageRollupCard } from './DeckStatsCards'
import { computeDeckProgress } from '../../domain/progress'
import type { Cell, Stage } from '../../domain/types'

// The ring is a conic-gradient; asserting on that string would pin CSS, not the
// shares. The double records what the card hands it.
vi.mock('../../components/Donut', () => ({
  Donut: ({ slices, children }: { slices: { label: string; value: number }[]; children?: ReactNode }) => (
    <div
      data-testid="donut"
      data-slices={JSON.stringify(slices.map((s) => [s.label, s.value]))}
    >
      {children}
    </div>
  ),
}))

const STAGES: Stage[] = [
  { id: 's1', seq: 1, name: 'Blast + Coat 1', color: '#fadb14', weight: 0.5 },
  { id: 's2', seq: 2, name: 'Coat 2', color: '#bfbfbf', weight: 0.5 },
]

/** Four bays of unequal size, so bay share and area share cannot coincide. */
const CELLS: Cell[] = [
  { id: 'c1', code: 'R1C1', x: 0, y: 0, w: 0.5, h: 0.5, areaM2: 700, stageId: 's2' },
  { id: 'c2', code: 'R1C2', x: 0.5, y: 0, w: 0.5, h: 0.5, areaM2: 100, stageId: 's1' },
  { id: 'c3', code: 'R2C1', x: 0, y: 0.5, w: 0.5, h: 0.5, areaM2: 100, stageId: null },
  { id: 'c4', code: 'R2C2', x: 0.5, y: 0.5, w: 0.5, h: 0.5, areaM2: 100, stageId: null },
]

const DECK = { id: 'd1', code: 'CD', name: 'Cellar Deck', totalAreaM2: 1000, cells: CELLS }

const progressOf = () => computeDeckProgress(DECK, STAGES)

const renderRollup = (stages = STAGES, p = progressOf()) =>
  render(
    <StageRollupCard
      stages={stages}
      stageProgress={p.stages}
      cells={CELLS}
      totalAreaM2={DECK.totalAreaM2}
    />,
  )

describe('DeckProgressCard', () => {
  it('prints the one number the foreman is asked for, and what it is out of', () => {
    render(<DeckProgressCard progress={0.4438} totalAreaM2={5258.5} />)
    expect(screen.getByText('44,38%')).toBeInTheDocument()
    expect(screen.getByText('5.258,50 m²')).toBeInTheDocument()
  })
})

describe('StageRollupCard', () => {
  it('reads each coat as m² done over the deck m², cumulatively', () => {
    // A bay at Coat 2 has been through Coat 1: 700 + 100 = 800 m² have reached
    // Coat 1, 700 m² have reached Coat 2. Same denominator as the percent, so
    // the three figures on a row cannot disagree with each other.
    renderRollup()
    const card = screen.getByTestId('gs-stage-rollup')
    expect(within(card).getByText('800,00 / 1.000,00 m² · 80,00%')).toBeInTheDocument()
    expect(within(card).getByText('700,00 / 1.000,00 m² · 70,00%')).toBeInTheDocument()
  })

  it('names every coat, including one nothing has reached yet', () => {
    const stages = [...STAGES, { id: 's3', seq: 3, name: 'Tháo giáo', color: '#722ed1', weight: 0 }]
    renderRollup(stages, computeDeckProgress(DECK, stages))
    const card = screen.getByTestId('gs-stage-rollup')
    expect(within(card).getByText('Tháo giáo')).toBeInTheDocument()
    expect(within(card).getByText('0,00 / 1.000,00 m² · 0,00%')).toBeInTheDocument()
  })

  it('shows no bay count anywhere on the card', () => {
    // Feedback Rv1: "không cần hiển thị số ô đã làm / tổng số ô". The office
    // reads m² and percent; a count of bays of unequal size tells it nothing.
    renderRollup()
    const card = screen.getByTestId('gs-stage-rollup')
    expect(within(card).queryByText(/\d+\/\d+ ô/)).toBeNull()
    expect(within(card).queryByText('ô trên sàn')).toBeNull()
  })

  it('puts the deck area in the ring, not a second copy of the deck figure', () => {
    // The deck percentage is already the largest thing on the screen, one card
    // above. The area is what the ring is dividing up.
    renderRollup()
    const donut = screen.getByTestId('donut')
    expect(within(donut).getByText('1.000,00')).toBeInTheDocument()
    expect(within(donut).getByText('m² sàn')).toBeInTheDocument()
    expect(screen.queryByText('75,00%')).toBeNull()
  })

  it('divides the ring by area standing at each coat, not by bay count', () => {
    // One bay of 100 m² sits at Coat 1 and one of 700 at Coat 2. By count they
    // would be equal slices; by area they are 10% and 70% of the deck.
    renderRollup()
    expect(JSON.parse(screen.getByTestId('donut').getAttribute('data-slices') ?? '[]')).toEqual([
      ['Blast + Coat 1', 0.1],
      ['Coat 2', 0.7],
    ])
  })
})
