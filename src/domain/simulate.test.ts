import { describe, expect, it } from 'vitest'
import { paintDeck, progressReport, projectReport } from './simulate'
import type { Deck, Stage } from './types'

const STAGES: Stage[] = [
  { id: 's1', seq: 1, name: 'Primer', color: '#bfbfbf', weight: 0.2 },
  { id: 's2', seq: 2, name: 'Coat 1', color: '#1677ff', weight: 0.3 },
  { id: 's3', seq: 3, name: 'Coat 2', color: '#52c41a', weight: 0.5 },
]

/** Ten bays of 10 m², so a share of the deck reads straight off the count. */
const DECK: Deck = {
  id: 'd1',
  code: 'MD',
  name: 'Main Deck',
  totalAreaM2: 100,
  cells: Array.from({ length: 10 }, (_, i) => ({
    id: `c${i}`,
    code: `R1C${i + 1}`,
    x: i / 10, y: 0, w: 0.1, h: 1,
    areaM2: 10,
    stageId: null,
  })),
}

describe('paintDeck', () => {
  it('paints the share of the deck asked for, by area', () => {
    const painted = paintDeck(DECK, STAGES, { Primer: 0.5 })

    expect(painted.cells.filter((c) => c.stageId === 's1')).toHaveLength(5)
    expect(painted.cells.filter((c) => c.stageId === null)).toHaveLength(5)
  })

  it('reads the shares as "at least this far", deepest first', () => {
    // A bay at Coat 2 has had the primer and the first coat too. Asking for
    // 20% at Coat 2 and 50% at Primer means half the deck has been primed, and
    // 20% of it has gone all the way -- not 70% of it touched.
    const painted = paintDeck(DECK, STAGES, { Primer: 0.5, 'Coat 2': 0.2 })

    expect(painted.cells.filter((c) => c.stageId === 's3')).toHaveLength(2)
    expect(painted.cells.filter((c) => c.stageId === 's1')).toHaveLength(3)
    expect(painted.cells.filter((c) => c.stageId === null)).toHaveLength(5)
  })

  it('gives the same answer twice', () => {
    // Nothing random: a number that moves between two runs cannot be used to
    // check anything.
    const mix = { Primer: 0.5, 'Coat 1': 0.3 }
    expect(paintDeck(DECK, STAGES, mix)).toEqual(paintDeck(DECK, STAGES, mix))
  })

  it('leaves the deck alone when nothing is asked for', () => {
    expect(paintDeck(DECK, STAGES, {}).cells.every((c) => c.stageId === null)).toBe(true)
  })

  it('changes nothing on the deck it was given', () => {
    // The caller is holding a real deck read off the database.
    const painted = paintDeck(DECK, STAGES, { Primer: 1 })
    expect(DECK.cells.every((c) => c.stageId === null)).toBe(true)
    expect(painted.cells.every((c) => c.stageId === 's1')).toBe(true)
  })
})

describe('progressReport', () => {
  it('reports each stage cumulatively, and the weighted total', () => {
    // Half primed, a fifth all the way. Primer counts every bay at or past it:
    // 5 of 10. Coat 1 counts the 2 at Coat 2. Total = 0.2*0.5 + 0.3*0.2 + 0.5*0.2.
    const painted = paintDeck(DECK, STAGES, { Primer: 0.5, 'Coat 2': 0.2 })

    expect(progressReport(painted, STAGES)).toEqual({
      Primer: '50.0% (50.0 m²)',
      'Coat 1': '20.0% (20.0 m²)',
      'Coat 2': '20.0% (20.0 m²)',
      'TỔNG': '26.0%',
    })
  })
})

describe('projectReport', () => {
  it('weights each deck by its share of the project area', () => {
    const small: Deck = { ...DECK, id: 'd2', totalAreaM2: 300, cells: DECK.cells }
    const report = projectReport([paintDeck(DECK, STAGES, { Primer: 1 }), small], STAGES)

    expect(report.d1).toBe('20.0% × 25.0%')
    expect(report['TỔNG DỰ ÁN']).toBe('5.0%')
  })
})
