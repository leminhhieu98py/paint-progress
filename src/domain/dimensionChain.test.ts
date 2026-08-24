import { describe, expect, it } from 'vitest'
import { distributeChain, parseDimensionChain, rerailAxisGuides } from './dimensionChain'

/**
 * The Main Deck's real across-chain, as printed on the drawing and typed by
 * the admin: 2500, 9500, 14500, 14500, 9500, 7600 -- the same fixture
 * geometry.test.ts uses as ACROSS_SPANS/ACROSS_OFFSETS (there expressed with
 * a leading datum-span 0; here as the raw spans a paste would produce, since
 * parseDimensionChain never emits that leading placeholder).
 */
const REAL_CHAIN = '2500 9500 14500 14500 9500 7600'
const REAL_SPANS = [2500, 9500, 14500, 14500, 9500, 7600]
const REAL_OFFSETS = [0, 2500, 12000, 26500, 41000, 50500, 58100]

describe('parseDimensionChain', () => {
  it('strips thousands separators from a grouped integer, period style', () => {
    // Vietnamese grouping: 14.500 means fourteen thousand five hundred.
    expect(parseDimensionChain('14.500')).toEqual({ ok: true, spansMm: [14500] })
  })

  it('strips thousands separators from a grouped integer, comma style', () => {
    // English grouping: 14,500 means the same fourteen thousand five hundred.
    expect(parseDimensionChain('14,500')).toEqual({ ok: true, spansMm: [14500] })
  })

  it('reads a comma decimal as a fractional millimetre', () => {
    // Vietnamese decimal: 2500,5 means two thousand five hundred point five.
    expect(parseDimensionChain('2500,5')).toEqual({ ok: true, spansMm: [2500.5] })
  })

  it('reads a plain integer with no separator', () => {
    expect(parseDimensionChain('2500')).toEqual({ ok: true, spansMm: [2500] })
  })

  it('rejects a token no rule matches, naming it rather than guessing', () => {
    // 2500,9500 is neither a valid thousands group (2500 is 4 digits, not
    // 1-3) nor a valid decimal (9500 is 4 fraction digits, not 1-2) -- so it
    // is refused by name instead of read as either 25009500 or 2500.9500.
    // This is the brief's own worked example.
    const result = parseDimensionChain('2500,9500')
    expect(result.ok).toBe(false)
    expect(result).toMatchObject({ badToken: '2500,9500' })
  })

  it('rejects a token that is not a number at all, naming it', () => {
    const result = parseDimensionChain('abc')
    expect(result.ok).toBe(false)
    expect(result).toMatchObject({ badToken: 'abc' })
  })

  it('rejects the whole paste on the FIRST bad token among otherwise-good ones', () => {
    // A single mis-typed separator must not silently drop just that span and
    // keep going -- the whole paste is refused, naming the offending token.
    const result = parseDimensionChain('2500 2500,9500 14500')
    expect(result.ok).toBe(false)
    expect(result).toMatchObject({ badToken: '2500,9500' })
  })

  it('rejects a single zero span, naming it', () => {
    // <= 0 is refused even though '0' matches the plain-integer rule -- a
    // zero-width bay is not a span the admin meant to type.
    const result = parseDimensionChain('0')
    expect(result.ok).toBe(false)
    expect(result).toMatchObject({ badToken: '0' })
  })

  it('rejects an empty paste as having no valid spans', () => {
    const result = parseDimensionChain('')
    expect(result.ok).toBe(false)
  })

  it('rejects a paste that is only whitespace, the same as empty', () => {
    const result = parseDimensionChain('   \n\t  ')
    expect(result.ok).toBe(false)
  })

  it('splits on spaces', () => {
    expect(parseDimensionChain('2500 9500 14500')).toEqual({ ok: true, spansMm: [2500, 9500, 14500] })
  })

  it('splits on newlines', () => {
    expect(parseDimensionChain('2500\n9500\n14500')).toEqual({ ok: true, spansMm: [2500, 9500, 14500] })
  })

  it('splits on tabs', () => {
    expect(parseDimensionChain('2500\t9500\t14500')).toEqual({ ok: true, spansMm: [2500, 9500, 14500] })
  })

  it('splits on semicolons', () => {
    expect(parseDimensionChain('2500;9500;14500')).toEqual({ ok: true, spansMm: [2500, 9500, 14500] })
  })

  it('drops a bare comma left standing alone between two spaced numbers', () => {
    // '2500 , 9500': the comma is its own whitespace-delimited token here,
    // and a lone comma or period token is dropped rather than rejected --
    // it is not a decimal point stuck to a digit, so there is no token to
    // misread as one.
    expect(parseDimensionChain('2500 , 9500')).toEqual({ ok: true, spansMm: [2500, 9500] })
  })

  it('drops a bare period standing alone the same way', () => {
    expect(parseDimensionChain('2500 . 9500')).toEqual({ ok: true, spansMm: [2500, 9500] })
  })

  it('parses the real Main Deck chain end to end', () => {
    expect(parseDimensionChain(REAL_CHAIN)).toEqual({ ok: true, spansMm: REAL_SPANS })
  })
})

describe('distributeChain', () => {
  it('offsets the real chain as a zero-based running sum, last offset the total', () => {
    const distributed = distributeChain(REAL_SPANS, 0, 1)
    expect(distributed.map((d) => d.offsetMm)).toEqual(REAL_OFFSETS)
  })

  it('maps offset 0 to startPos and the total to endPos exactly', () => {
    const distributed = distributeChain(REAL_SPANS, 0, 1)
    expect(distributed[0].pos).toBe(0)
    expect(distributed[distributed.length - 1].pos).toBe(1)
  })

  it('maps every interior offset by its ratio of the total, not merely in increasing order', () => {
    // This is the mapping the whole feature rests on: pos = start + ratio *
    // (end - start). A test that only checked "increasing" would also pass
    // an evenly-spaced guess that ignores the mm ratios entirely.
    const distributed = distributeChain(REAL_SPANS, 0, 1)
    const total = REAL_OFFSETS[REAL_OFFSETS.length - 1]
    for (let i = 0; i < REAL_OFFSETS.length; i++) {
      expect(distributed[i].pos).toBeCloseTo(REAL_OFFSETS[i] / total, 12)
    }
  })

  it('maps the same chain between two interior edge positions, not just 0..1', () => {
    const distributed = distributeChain(REAL_SPANS, 0.1, 0.9)
    const total = REAL_OFFSETS[REAL_OFFSETS.length - 1]
    for (let i = 0; i < REAL_OFFSETS.length; i++) {
      const ratio = REAL_OFFSETS[i] / total
      expect(distributed[i].pos).toBeCloseTo(0.1 + ratio * 0.8, 12)
    }
    expect(distributed[0].pos).toBeCloseTo(0.1, 12)
    expect(distributed[distributed.length - 1].pos).toBeCloseTo(0.9, 12)
  })

  it('produces n+1 guides for n spans', () => {
    expect(distributeChain(REAL_SPANS, 0, 1)).toHaveLength(REAL_SPANS.length + 1)
  })

  it('throws on a zero total rather than stacking every guide on the first', () => {
    expect(() => distributeChain([], 0, 1)).toThrow()
  })
})

describe('rerailAxisGuides', () => {
  const RATIOS = REAL_OFFSETS.map((o) => o / REAL_OFFSETS[REAL_OFFSETS.length - 1])

  /**
   * The real chain's 7 guides, positioned the way the CURRENT (pre-feature)
   * workflow actually leaves them: dragged into rough, monotonic, but
   * otherwise arbitrary spots that bear no relation to their mm ratios.
   * pos and offsetMm are independent facts about a guide -- only their ORDER
   * has to agree -- and re-railing exists precisely to fix that up once one
   * edge is dragged to a real position, so a fixture that already places
   * every guide by ratio would not exercise it at all.
   *
   * The last guide sits far out at 1, well clear of interior guide 5 (0.5),
   * so dragging it inward to 0.8 in the tests below is a move
   * `moveGuideClamped` actually allows (its only neighbour is at 0.5).
   */
  const arbitraryLayout = (): { axis: 'x'; pos: number; offsetMm: number }[] => [
    { axis: 'x', pos: 0, offsetMm: REAL_OFFSETS[0] },
    { axis: 'x', pos: 0.1, offsetMm: REAL_OFFSETS[1] },
    { axis: 'x', pos: 0.2, offsetMm: REAL_OFFSETS[2] },
    { axis: 'x', pos: 0.3, offsetMm: REAL_OFFSETS[3] },
    { axis: 'x', pos: 0.4, offsetMm: REAL_OFFSETS[4] },
    { axis: 'x', pos: 0.5, offsetMm: REAL_OFFSETS[5] },
    { axis: 'x', pos: 1, offsetMm: REAL_OFFSETS[6] },
  ]

  it('re-rails every interior guide to ratio * newEdgePos when the last guide moves', () => {
    // Simulates onGuideMove having already run moveGuideClamped, which
    // clamped the requested drag to 0.8 -- comfortably clear of guide 5's
    // 0.5, so the clamp let it through unchanged. rerailAxisGuides' job is
    // everything downstream of that clamp.
    const dragged = arbitraryLayout().map((guide, i) => (i === 6 ? { ...guide, pos: 0.8 } : guide))

    const result = rerailAxisGuides(dragged, 'x', 6)

    RATIOS.forEach((ratio, i) => {
      expect(result[i].pos).toBeCloseTo(ratio * 0.8, 12)
      // The mm chain the admin typed is never touched by a drag.
      expect(result[i].offsetMm).toBe(REAL_OFFSETS[i])
    })
    // The dragged edge itself is untouched by re-railing -- it IS the new
    // endPos, so ratio 1 * 0.8 lands exactly back on 0.8.
    expect(result[6].pos).toBeCloseTo(0.8, 12)
  })

  it('re-rails every interior guide when the FIRST guide moves instead', () => {
    // Mirrors the previous fixture: the first guide starts at 0, its only
    // neighbour (guide 1) sits at 0.5, so dragging the first guide OUT to
    // 0.2 stays clear of it and moveGuideClamped lets it through.
    const layout: { axis: 'x'; pos: number; offsetMm: number }[] = [
      { axis: 'x', pos: 0, offsetMm: REAL_OFFSETS[0] },
      { axis: 'x', pos: 0.5, offsetMm: REAL_OFFSETS[1] },
      { axis: 'x', pos: 0.6, offsetMm: REAL_OFFSETS[2] },
      { axis: 'x', pos: 0.7, offsetMm: REAL_OFFSETS[3] },
      { axis: 'x', pos: 0.8, offsetMm: REAL_OFFSETS[4] },
      { axis: 'x', pos: 0.9, offsetMm: REAL_OFFSETS[5] },
      { axis: 'x', pos: 1, offsetMm: REAL_OFFSETS[6] },
    ]
    const dragged = layout.map((guide, i) => (i === 0 ? { ...guide, pos: 0.2 } : guide))

    const result = rerailAxisGuides(dragged, 'x', 0)

    RATIOS.forEach((ratio, i) => {
      expect(result[i].pos).toBeCloseTo(0.2 + ratio * (1 - 0.2), 12)
      expect(result[i].offsetMm).toBe(REAL_OFFSETS[i])
    })
    expect(result[0].pos).toBeCloseTo(0.2, 12)
  })

  it('does nothing when the moved guide is interior, not an edge', () => {
    // Move interior guide 3 (pos 0.3) to 0.35 -- still strictly between
    // guide 2 (0.2) and guide 4 (0.4), so it stays interior in pos order and
    // only moveGuideClamped's own clamp governs this case, not re-railing.
    const dragged = arbitraryLayout().map((guide, i) => (i === 3 ? { ...guide, pos: 0.35 } : guide))

    const result = rerailAxisGuides(dragged, 'x', 3)

    expect(result).toBe(dragged)
  })

  it('leaves every other guide exactly where it was on a degenerate axis (all offsets zero)', () => {
    // Guides added by double-click before any mm was typed: there is no
    // chain to scale by, so behave exactly as today and move only the
    // dragged guide.
    const guides = [
      { axis: 'x' as const, pos: 0, offsetMm: 0 },
      { axis: 'x' as const, pos: 0.3, offsetMm: 0 },
      { axis: 'x' as const, pos: 0.6, offsetMm: 0 },
      { axis: 'x' as const, pos: 1, offsetMm: 0 },
    ]
    const dragged = guides.map((guide, i) => (i === 3 ? { ...guide, pos: 0.8 } : guide))

    const result = rerailAxisGuides(dragged, 'x', 3)

    expect(result[0].pos).toBe(0)
    expect(result[1].pos).toBe(0.3)
    expect(result[2].pos).toBe(0.6)
    expect(result[3].pos).toBe(0.8)
  })

  it('ignores guides on the other axis entirely', () => {
    const guides = [
      ...arbitraryLayout(),
      { axis: 'y' as const, pos: 0.5, offsetMm: 999999 },
    ]
    const dragged = guides.map((guide, i) => (i === 6 ? { ...guide, pos: 0.8 } : guide))

    const result = rerailAxisGuides(dragged, 'x', 6)

    expect(result[result.length - 1]).toEqual(guides[guides.length - 1])
  })

  it('refuses to re-rail rather than divide by a collapsed range, when every guide on the axis shares one pos', () => {
    // Defence in depth. `sorted` is ascending by pos, so `first.pos <=
    // last.pos` always holds once there are 2+ distinct positions -- the
    // ONLY way `first.pos < last.pos` can fail is every guide on the axis
    // sharing the identical pos, which MIN_GUIDE_GAP should make unreachable
    // through the UI. Constructed directly, bypassing moveGuideClamped, to
    // prove the guard holds on its own rather than trusting that proof.
    const collapsed = [
      { axis: 'x' as const, pos: 0.5, offsetMm: 0 },
      { axis: 'x' as const, pos: 0.5, offsetMm: 5000 },
      { axis: 'x' as const, pos: 0.5, offsetMm: 10000 },
    ]

    const result = rerailAxisGuides(collapsed, 'x', 2)

    expect(result).toBe(collapsed)
  })

  it('does nothing on an axis with fewer than three guides -- nothing interior to re-rail', () => {
    const guides = [
      { axis: 'x' as const, pos: 0, offsetMm: 0 },
      { axis: 'x' as const, pos: 1, offsetMm: 10000 },
    ]
    const dragged = [guides[0], { ...guides[1], pos: 0.8 }]

    expect(rerailAxisGuides(dragged, 'x', 1)).toBe(dragged)
  })
})
