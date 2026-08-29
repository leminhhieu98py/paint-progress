import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DeckProgressCard, StageRollupCard } from './DeckStatsCards'
import { computeDeckProgress } from '../../domain/progress'
import type { Cell, Stage } from '../../domain/types'

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

const progressOf = () =>
  computeDeckProgress(
    { id: 'd1', code: 'CD', name: 'Cellar Deck', totalAreaM2: 1000, cells: CELLS },
    STAGES,
  )

describe('DeckProgressCard', () => {
  it('prints the one number the foreman is asked for, and what it is out of', () => {
    render(<DeckProgressCard progress={0.4438} totalAreaM2={5258.5} />)
    expect(screen.getByText('44,38%')).toBeInTheDocument()
    expect(screen.getByText('5.258,50 m²')).toBeInTheDocument()
  })
})

describe('StageRollupCard', () => {
  it('counts bays cumulatively: a bay at Coat 2 has been through Coat 1', () => {
    const p = progressOf()
    render(<StageRollupCard stages={STAGES} stageProgress={p.stages} cells={CELLS} />)
    const card = screen.getByTestId('gs-stage-rollup')
    // Two of four bays have reached Coat 1; one of four has reached Coat 2.
    expect(within(card).getByText(/^2\/4 ô/)).toBeInTheDocument()
    expect(within(card).getByText(/^1\/4 ô/)).toBeInTheDocument()
  })

  it('reports the AREA share beside the bay count, not the bay fraction', () => {
    // The bays are deliberately unequal: 2/4 bays is 50%, but those two bays
    // are 800 of 1000 m². The percentage that leaves this screen is the one the
    // report bills against, so it has to be the area one.
    const p = progressOf()
    render(<StageRollupCard stages={STAGES} stageProgress={p.stages} cells={CELLS} />)
    const card = screen.getByTestId('gs-stage-rollup')
    expect(within(card).getByText('2/4 ô · 80,00%')).toBeInTheDocument()
    expect(within(card).getByText('1/4 ô · 70,00%')).toBeInTheDocument()
  })

  it('names every coat, including one nothing has reached yet', () => {
    const stages = [...STAGES, { id: 's3', seq: 3, name: 'Tháo giáo', color: '#722ed1', weight: 0 }]
    const p = computeDeckProgress(
      { id: 'd1', code: 'CD', name: 'Cellar Deck', totalAreaM2: 1000, cells: CELLS },
      stages,
    )
    render(<StageRollupCard stages={stages} stageProgress={p.stages} cells={CELLS} />)
    const card = screen.getByTestId('gs-stage-rollup')
    expect(within(card).getByText('Tháo giáo')).toBeInTheDocument()
    expect(within(card).getByText('0/4 ô · 0,00%')).toBeInTheDocument()
  })

  it('puts the bay count in the ring, not a second copy of the deck figure', () => {
    // The deck percentage is already the largest thing on the screen, one card
    // above. Repeating it here would be two numbers to keep in step.
    const p = progressOf()
    render(<StageRollupCard stages={STAGES} stageProgress={p.stages} cells={CELLS} />)
    expect(screen.getByText('4')).toBeInTheDocument()
    expect(screen.getByText('ô trên sàn')).toBeInTheDocument()
    expect(screen.queryByText('75,00%')).toBeNull()
  })
})
