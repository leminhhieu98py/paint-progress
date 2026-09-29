import { describe, expect, it } from 'vitest'
import { ringSegments, sectorPath } from './donutGeometry'

describe('ringSegments', () => {
  it('lays slices out in order, each followed by a hairline gap', () => {
    const { segments, remainderFrom } = ringSegments([
      { value: 0.5 },
      { value: 0.25 },
    ])
    // The gap is what keeps two adjacent slices of similar colour from reading
    // as one wedge.
    expect(segments).toEqual([
      { index: 0, from: 0, solidTo: 0.495, to: 0.5, arc: 0.5 },
      { index: 1, from: 0.5, solidTo: 0.745, to: 0.75, arc: 0.25 },
    ])
    expect(remainderFrom).toBe(0.75)
  })

  it('skips a zero slice rather than drawing a gap for it', () => {
    // A deck at 0% contributes nothing, and a bare gap where it should be
    // reads as a fourth deck that got lost.
    const { segments } = ringSegments([
      { value: 0.5 },
      { value: 0 },
    ])
    expect(segments.map((s) => s.index)).toEqual([0])
  })

  it('leaves no remainder when the slices already fill the circle', () => {
    expect(ringSegments([{ value: 1 }]).remainderFrom).toBe(1)
  })

  it('is all remainder for a project with no progress at all', () => {
    expect(ringSegments([])).toEqual({ segments: [], remainderFrom: 0 })
  })

  it('never runs a slice past the full circle', () => {
    // Reachable through edited stage weights that sum above 1.
    const { segments, remainderFrom } = ringSegments([{ value: 1.4 }])
    expect(segments[0].to).toBe(1)
    expect(remainderFrom).toBe(1)
  })

  it('keeps the arc keyed to value when a slice also carries a display number (RV6-02)', () => {
    // `display` is legend-only; the ring sizes the arc off `value` alone.
    const deck = { value: 0.5, display: 0.9 }
    const { segments } = ringSegments([deck])
    expect(segments[0].to).toBe(0.5)
  })
})

describe('sectorPath', () => {
  it('draws a quarter ring clockwise from twelve o\'clock', () => {
    // Outer arc from (50,0) to (100,50), in to (80,50), inner arc back to (50,20).
    expect(sectorPath(50, 50, 50, 30, 0, 0.25)).toBe(
      'M50 0A50 50 0 0 1 100 50L80 50A30 30 0 0 0 50 20Z',
    )
  })

  it('flags the large arc once a sector passes half the circle', () => {
    expect(sectorPath(50, 50, 50, 30, 0, 0.75)).toContain('A50 50 0 1 1')
  })

  it('draws a whole ring as two halves, since one arc cannot end where it starts', () => {
    const d = sectorPath(50, 50, 50, 30, 0, 1)
    expect(d).toBe('M50 0A50 50 0 1 1 50 100A50 50 0 1 1 50 0ZM50 20A30 30 0 1 0 50 80A30 30 0 1 0 50 20Z')
  })
})
