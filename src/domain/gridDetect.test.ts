import { describe, expect, it } from 'vitest'
import { inkProfile, keepDrawnCells, linesFromProfile } from './gridDetect'

const BLACK: [number, number, number] = [0, 0, 0]
// r-g=150, r-b=150 -- well past the >40 exclusion threshold. The customer's
// sheet draws its red plan-grid overlay in a colour like this.
const RED: [number, number, number] = [200, 50, 50]
// r>180, g>180, b<140 -- the sheet's yellow fills.
const YELLOW: [number, number, number] = [200, 200, 100]
const WHITE: [number, number, number] = [255, 255, 255]

function whiteImage(width: number, height: number): Uint8Array {
  return new Uint8Array(width * height * 3).fill(255)
}

function setPixel(rgb: Uint8Array, width: number, x: number, y: number, color: [number, number, number]): void {
  const o = (y * width + x) * 3
  rgb[o] = color[0]
  rgb[o + 1] = color[1]
  rgb[o + 2] = color[2]
}

function fillColumn(
  rgb: Uint8Array, width: number, x: number, yFrom: number, yTo: number, color: [number, number, number],
): void {
  for (let y = yFrom; y <= yTo; y++) setPixel(rgb, width, x, y, color)
}

function fillRow(
  rgb: Uint8Array, width: number, y: number, xFrom: number, xTo: number, color: [number, number, number],
): void {
  for (let x = xFrom; x <= xTo; x++) setPixel(rgb, width, x, y, color)
}

describe('inkProfile / linesFromProfile', () => {
  it('collapses a 3px-wide line to ONE line at its midpoint', () => {
    // 30x10, columns 14-16 painted full height -- the only ink on the image.
    const width = 30
    const height = 10
    const rgb = whiteImage(width, height)
    fillColumn(rgb, width, 14, 0, height - 1, BLACK)
    fillColumn(rgb, width, 15, 0, height - 1, BLACK)
    fillColumn(rgb, width, 16, 0, height - 1, BLACK)

    const profile = inkProfile(rgb, width, height)
    const { x } = linesFromProfile(profile, { x: 0.5, y: 0.5 })

    // One guide at the run's midpoint (15), not three -- one per painted
    // column would mesh the cell between them down to zero width.
    expect(x).toEqual([15 / width])
  })

  it('excludes red overlay pixels from the ink mask', () => {
    // A red line and a black line, each the only ink in their own column.
    const width = 30
    const height = 10
    const rgb = whiteImage(width, height)
    fillColumn(rgb, width, 20, 0, height - 1, RED)
    fillColumn(rgb, width, 5, 0, height - 1, BLACK)

    const profile = inkProfile(rgb, width, height)
    const { x } = linesFromProfile(profile, { x: 0.5, y: 0.5 })

    // If red were counted as ink this would be [5/30, 20/30]. It is not.
    expect(x).toEqual([5 / width])
  })

  it('excludes yellow fill pixels from the ink mask', () => {
    const width = 30
    const height = 10
    const rgb = whiteImage(width, height)
    fillColumn(rgb, width, 20, 0, height - 1, YELLOW)
    fillColumn(rgb, width, 5, 0, height - 1, BLACK)

    const profile = inkProfile(rgb, width, height)
    const { x } = linesFromProfile(profile, { x: 0.5, y: 0.5 })

    expect(x).toEqual([5 / width])
  })

  it('rejects a line spanning 20% of the content box at 0.5 and finds it at 0.15', () => {
    // 10 wide x 20 tall. Column 3 is painted for rows 0-3 (4 of 20 rows =
    // 20% of the content box's height). A single pixel at (0, 19) stretches
    // the content box down to the full 20 rows without adding meaningful ink
    // of its own -- otherwise the "content box" IS the test line and it
    // would trivially span 100% of it.
    const width = 10
    const height = 20
    const rgb = whiteImage(width, height)
    fillColumn(rgb, width, 3, 0, 3, BLACK)
    setPixel(rgb, width, 0, 19, BLACK)

    const profile = inkProfile(rgb, width, height)

    // Both directions, on the same cached profile.
    expect(linesFromProfile(profile, { x: 0.5, y: 0.5 }).x).toEqual([])
    expect(linesFromProfile(profile, { x: 0.15, y: 0.5 }).x).toEqual([3 / width])
  })

  it('picks different lines per axis -- the whole point of the x/y split', () => {
    // 20x20. A long horizontal line (row 10, full width) and a short
    // vertical line (column 5, rows 0-3 = 20% of the content box's height,
    // once the horizontal line's own row is folded into it). The horizontal
    // line crosses every column once, so every OTHER column also carries an
    // ink count of 1 -- comfortably below any fraction tested here, so it
    // never becomes a spurious candidate.
    const width = 20
    const height = 20
    const rgb = whiteImage(width, height)
    fillRow(rgb, width, 10, 0, width - 1, BLACK)
    fillColumn(rgb, width, 5, 0, 3, BLACK)

    const profile = inkProfile(rgb, width, height)

    // Lenient on x: the short vertical is found alongside the horizontal.
    expect(linesFromProfile(profile, { x: 0.15, y: 0.7 })).toEqual({ x: [5 / width], y: [10 / height] })
    // Strict on x, same y: only the horizontal survives.
    expect(linesFromProfile(profile, { x: 0.7, y: 0.7 })).toEqual({ x: [], y: [10 / height] })
  })

  it('drives horizontal lines off fraction.y, independent of fraction.x', () => {
    // The mirror image of the previous test: this time x is HELD CONSTANT
    // across both calls and only y changes, so a row candidacy computed off
    // fraction.x (a regression that collapses the split back to one number)
    // is caught even though the previous test's example never varies y at
    // all -- there, y is pinned at 0.7 on both sides, which the brief's own
    // worked example does too, and would not by itself catch a detector that
    // quietly used fraction.x for rows.
    //
    // A robust vertical line (column 10, full height) and a marginal
    // horizontal line (row 8, columns 0-3 -- 20% of the content box's width)
    // that only clears a lenient y.
    const width = 20
    const height = 20
    const rgb = whiteImage(width, height)
    fillColumn(rgb, width, 10, 0, height - 1, BLACK)
    fillRow(rgb, width, 8, 0, 3, BLACK)

    const profile = inkProfile(rgb, width, height)

    // x pinned at 0.7 on both calls; only y moves.
    expect(linesFromProfile(profile, { x: 0.7, y: 0.15 })).toEqual({ x: [10 / width], y: [8 / height] })
    expect(linesFromProfile(profile, { x: 0.7, y: 0.7 })).toEqual({ x: [10 / width], y: [] })
  })

  it('drives the cheap path off the fraction alone, reusing one cached profile', () => {
    // Column 2 is full height (10/10); column 7 is half height (5/10). One
    // `inkProfile` call; two `linesFromProfile` calls against the SAME
    // returned object, at fractions either side of the halfway column.
    const width = 10
    const height = 10
    const rgb = whiteImage(width, height)
    fillColumn(rgb, width, 2, 0, 9, BLACK)
    fillColumn(rgb, width, 7, 0, 4, BLACK)

    const profile = inkProfile(rgb, width, height)

    expect(linesFromProfile(profile, { x: 0.9, y: 0.9 }).x).toEqual([2 / width])
    expect(linesFromProfile(profile, { x: 0.4, y: 0.9 }).x).toEqual([2 / width, 7 / width])
  })

  it('measures a beam against the DECK region, not the sheet the deck is printed on', () => {
    // The bug this whole option exists for, reproduced at 100x100.
    //
    // The sheet has a page border (row 0, row 99, column 0, column 99) and a
    // deck drawn in its top-left corner, x 10-49 by y 10-49 -- 40% of the
    // sheet on each axis, which is about what the customer's real Main Deck
    // occupies on its A3 sheet. The deck's own beams span the deck fully.
    //
    // Without a region the content box is the ink bounding box, which IS the
    // page border, so every deck beam spans only 40% of it and is rejected at
    // any usable fraction -- while the border itself spans 100% and is
    // reported as a "beam". That is exactly what the browser harness saw on
    // the real sheet: one line, zero cells.
    const width = 100
    const height = 100
    const rgb = whiteImage(width, height)
    fillRow(rgb, width, 0, 0, width - 1, BLACK)
    fillRow(rgb, width, height - 1, 0, width - 1, BLACK)
    fillColumn(rgb, width, 0, 0, height - 1, BLACK)
    fillColumn(rgb, width, width - 1, 0, height - 1, BLACK)
    for (const x of [10, 30, 49]) fillColumn(rgb, width, x, 10, 49, BLACK)
    for (const y of [10, 30, 49]) fillRow(rgb, width, y, 10, 49, BLACK)

    // Whole sheet: the border, and only the border.
    const sheetProfile = inkProfile(rgb, width, height)
    expect(linesFromProfile(sheetProfile, { x: 0.7, y: 0.7 })).toEqual({
      x: [0, (width - 1) / width],
      y: [0, (height - 1) / height],
    })

    // Same pixels, same fraction, region = the deck: all three beams on each
    // axis, and the border gone -- its columns carry no ink INSIDE the region.
    const deckProfile = inkProfile(rgb, width, height, {
      region: { x: 0.1, y: 0.1, w: 0.4, h: 0.4 },
    })
    expect(linesFromProfile(deckProfile, { x: 0.7, y: 0.7 })).toEqual({
      x: [10 / width, 30 / width, 49 / width],
      y: [10 / height, 30 / height, 49 / height],
    })
  })

  it('keeps the region as the content box even where the region holds no ink', () => {
    // A region over blank paper must report "nothing here", not fall back to
    // the sheet's ink box and start finding lines somewhere else entirely.
    const width = 50
    const height = 50
    const rgb = whiteImage(width, height)
    fillColumn(rgb, width, 5, 0, height - 1, BLACK)

    const profile = inkProfile(rgb, width, height, {
      region: { x: 0.5, y: 0.5, w: 0.4, h: 0.4 },
    })
    // 0.5 -> column 25; 0.9 -> up to but NOT including column 45. Deliberately
    // away from the image's own edge, so the arithmetic is pinned by the
    // numbers rather than rescued by the clamp.
    expect(profile.contentBox).toEqual({ minCol: 25, maxCol: 44, minRow: 25, maxRow: 44 })
    expect(linesFromProfile(profile, { x: 0.3, y: 0.3 })).toEqual({ x: [], y: [] })
  })

  it('survives a zero-width region instead of dividing by it', () => {
    const width = 20
    const height = 20
    const rgb = whiteImage(width, height)
    fillColumn(rgb, width, 10, 0, height - 1, BLACK)

    const profile = inkProfile(rgb, width, height, {
      region: { x: 0.5, y: 0.5, w: 0, h: 0 },
    })
    expect(linesFromProfile(profile, { x: 0.5, y: 0.5 })).toEqual({ x: [], y: [] })
  })

  it('collapses a beam drawn as two edges into one line', () => {
    // Measured on the customer's real sheet: the bay pitch is 73-86px, but six
    // gaps came back at 11-46px. Those are not narrow bays -- a beam is drawn
    // with both of its edges, so each one surfaces as two lines with a sliver
    // of nothing between them, and the mesh gets a thread-thin cell per beam.
    //
    // 200x200, five real lines 40px apart (columns 20/60/100/140/180) with
    // column 103 added: a second edge 3px off the middle one. mergeWithin
    // (0.004 = 0.8px here) is far too small to catch it, which is the point --
    // this is a different scale of duplicate from a beam whose ink dips for a
    // pixel.
    const width = 200
    const height = 200
    const rgb = whiteImage(width, height)
    for (const x of [20, 60, 100, 103, 140, 180]) fillColumn(rgb, width, x, 0, height - 1, BLACK)

    const profile = inkProfile(rgb, width, height, { region: { x: 0, y: 0, w: 1, h: 1 } })
    const { x } = linesFromProfile(profile, { x: 0.5, y: 0.5 })

    // Five lines, and the pair is replaced by its midpoint (101.5) -- not by
    // either edge, which would bias every bay on that side of the beam.
    // Read back in pixels, rounded: a mean of normalized positions lands a
    // float ulp off the same division done directly, and 101.5 is the claim,
    // not the ulp.
    expect(x.map((pos) => Math.round(pos * width * 1e3) / 1e3)).toEqual([20, 60, 101.5, 140, 180])
  })

  it('leaves an evenly spaced grid alone', () => {
    // The guard on the rule above: every gap equals the median, so nothing is
    // a duplicate of anything, and a collapse here would eat real bays.
    const width = 200
    const height = 200
    const rgb = whiteImage(width, height)
    for (const x of [20, 60, 100, 140, 180]) fillColumn(rgb, width, x, 0, height - 1, BLACK)

    const profile = inkProfile(rgb, width, height, { region: { x: 0, y: 0, w: 1, h: 1 } })
    expect(linesFromProfile(profile, { x: 0.5, y: 0.5 }).x)
      .toEqual([20 / width, 60 / width, 100 / width, 140 / width, 180 / width])
  })

  it('keeps a genuinely narrow bay that is wide relative to the rest', () => {
    // Gaps 40/40/20: the 20 is half the median, over the 40% bar, so it stays.
    // A rule that merged "the smallest gap" unconditionally would delete this
    // bay, and on a real deck the narrow bays at the edges are real.
    const width = 200
    const height = 200
    const rgb = whiteImage(width, height)
    for (const x of [20, 60, 100, 120]) fillColumn(rgb, width, x, 0, height - 1, BLACK)

    const profile = inkProfile(rgb, width, height, { region: { x: 0, y: 0, w: 1, h: 1 } })
    expect(linesFromProfile(profile, { x: 0.5, y: 0.5 }).x)
      .toEqual([20 / width, 60 / width, 100 / width, 120 / width])
  })

  it('does not judge duplicates from fewer than three gaps', () => {
    // Three lines give two gaps, and with two gaps there is no majority to
    // compare against -- either one could BE the doubled pair. Refusing to
    // guess is what keeps a two-bay deck from collapsing to one.
    const width = 200
    const height = 200
    const rgb = whiteImage(width, height)
    for (const x of [20, 26, 180]) fillColumn(rgb, width, x, 0, height - 1, BLACK)

    const profile = inkProfile(rgb, width, height, { region: { x: 0, y: 0, w: 1, h: 1 } })
    expect(linesFromProfile(profile, { x: 0.5, y: 0.5 }).x)
      .toEqual([20 / width, 26 / width, 180 / width])
  })

  it('collapses a beam drawn as three lines, not just two', () => {
    // A wide beam can surface as both edges plus its own web. One pass that
    // merged pairs and stopped would leave two lines 1.5px apart.
    const width = 200
    const height = 200
    const rgb = whiteImage(width, height)
    for (const x of [20, 60, 100, 103, 106, 140, 180]) fillColumn(rgb, width, x, 0, height - 1, BLACK)

    const profile = inkProfile(rgb, width, height, { region: { x: 0, y: 0, w: 1, h: 1 } })
    expect(linesFromProfile(profile, { x: 0.5, y: 0.5 }).x
      .map((pos) => Math.round(pos * width * 1e3) / 1e3)).toEqual([20, 60, 103, 140, 180])
  })

  it('is not fooled into eating real bays by one huge blank span', () => {
    // Gaps 40/40/40/300 -- three real bays and one long empty stretch, which a
    // crop with a margin on one side, or a missing beam, produces routinely.
    // The median gap is 40, so nothing is close enough to collapse. The MEAN is
    // 105, which would put the bar at 42 and swallow all three real bays into
    // a single line. That is why the rule is built on the median.
    const width = 500
    const height = 200
    const rgb = whiteImage(width, height)
    for (const x of [20, 60, 100, 140, 440]) fillColumn(rgb, width, x, 0, height - 1, BLACK)

    const profile = inkProfile(rgb, width, height, { region: { x: 0, y: 0, w: 1, h: 1 } })
    expect(linesFromProfile(profile, { x: 0.5, y: 0.5 }).x.map((pos) => pos * width))
      .toEqual([20, 60, 100, 140, 440])
  })

  it('collapses doubled HORIZONTAL beams too', () => {
    // Not a mirror for symmetry's sake: on the customer's real sheet every one
    // of the four 11-12px duplicate gaps was on the horizontal axis. A collapse
    // wired into the x axis alone would leave the actual defect in place.
    const width = 200
    const height = 200
    const rgb = whiteImage(width, height)
    for (const y of [20, 60, 100, 103, 140, 180]) fillRow(rgb, width, y, 0, width - 1, BLACK)

    const profile = inkProfile(rgb, width, height, { region: { x: 0, y: 0, w: 1, h: 1 } })
    expect(linesFromProfile(profile, { x: 0.5, y: 0.5 }).y
      .map((pos) => Math.round(pos * height * 1e3) / 1e3)).toEqual([20, 60, 101.5, 140, 180])
  })

  it('yields empty arrays and does not crash on an all-white image', () => {
    const width = 10
    const height = 10
    const rgb = whiteImage(width, height)

    const profile = inkProfile(rgb, width, height)
    expect(profile.contentBox).toBeNull()
    expect(linesFromProfile(profile, { x: 0.5, y: 0.5 })).toEqual({ x: [], y: [] })
  })
})

describe('keepDrawnCells', () => {
  /**
   * A 200x200 sheet with a 2x2 grid of bays: lines at 20/100/180 on both axes.
   * `erase` blanks part of a line, standing in for a beam that is not there --
   * which is what the corner areas, the E-house and the circular structures on
   * a real deck look like to this rule.
   */
  function grid(erase: (rgb: Uint8Array, width: number) => void = () => {}) {
    const width = 200
    const height = 200
    const rgb = whiteImage(width, height)
    for (const x of [20, 100, 180]) fillColumn(rgb, width, x, 20, 180, BLACK)
    for (const y of [20, 100, 180]) fillRow(rgb, width, y, 20, 180, BLACK)
    erase(rgb, width)
    return inkProfile(rgb, width, height, { region: { x: 0, y: 0, w: 1, h: 1 } })
  }

  const CELLS = [
    { code: 'TL', x: 0.1, y: 0.1, w: 0.4, h: 0.4, areaM2: 1 },
    { code: 'TR', x: 0.5, y: 0.1, w: 0.4, h: 0.4, areaM2: 1 },
    { code: 'BL', x: 0.1, y: 0.5, w: 0.4, h: 0.4, areaM2: 1 },
    { code: 'BR', x: 0.5, y: 0.5, w: 0.4, h: 0.4, areaM2: 1 },
  ]

  it('keeps every cell of a grid that is fully drawn', () => {
    expect(keepDrawnCells(grid(), CELLS).map((c) => c.code)).toEqual(['TL', 'TR', 'BL', 'BR'])
  })

  it('drops a cell the drawing does not enclose, and keeps its neighbours', () => {
    // Every line bounding the bottom-right bay is erased, so that quarter of
    // the sheet is blank paper inside the grid -- exactly the shape of the
    // corner areas the admin says are not bays. Its two neighbours each lose
    // ONE edge to the same erasure and must survive: a rule strict enough to
    // need all four edges would delete real deck area either side of every
    // beam that stops short.
    const profile = grid((rgb, width) => {
      for (let y = 101; y <= 180; y++) {
        fillColumn(rgb, width, 100, y, y, WHITE)
        fillColumn(rgb, width, 180, y, y, WHITE)
      }
      for (let x = 101; x <= 180; x++) {
        fillRow(rgb, width, 100, x, x, WHITE)
        fillRow(rgb, width, 180, x, x, WHITE)
      }
    })
    expect(keepDrawnCells(profile, CELLS).map((c) => c.code)).toEqual(['TL', 'TR', 'BL'])
  })

  it('drops a cell down to two drawn edges', () => {
    // Two of four is a corner, not a bay: nothing on the sheet says where the
    // other two sides would be.
    const profile = grid((rgb, width) => {
      for (let y = 101; y <= 180; y++) fillColumn(rgb, width, 180, y, y, WHITE)
      for (let x = 101; x <= 180; x++) fillRow(rgb, width, 180, x, x, WHITE)
    })
    expect(keepDrawnCells(profile, CELLS).map((c) => c.code)).toEqual(['TL', 'TR', 'BL'])
  })

  it('finds a beam whose drawn edges straddle the cell boundary', () => {
    // A detected line sits at the beam's CENTRE, and a beam is drawn as its two
    // edges with white in between -- so a cell boundary lands on paper that
    // carries no ink at all. Testing the exact boundary pixel would reject
    // every real bay on the sheet.
    const width = 1000
    const height = 200
    const rgb = whiteImage(width, height)
    // One bay from x 100 to 300. The horizontal beams are drawn as two edges
    // 6px apart, so the boundary itself is blank; the vertical beams are drawn
    // ONCE, 3px to the low side, which is what the deck's outermost beams look
    // like. Both signs of the offset are therefore load-bearing -- a band that
    // only looked one way would find the horizontals and lose the verticals.
    for (const centre of [100, 300]) fillColumn(rgb, width, centre - 3, 20, 180, BLACK)
    for (const centre of [20, 180]) {
      fillRow(rgb, width, centre - 3, 100, 300, BLACK)
      fillRow(rgb, width, centre + 3, 100, 300, BLACK)
    }
    const profile = inkProfile(rgb, width, height, { region: { x: 0, y: 0, w: 1, h: 1 } })

    const cell = { code: 'A', x: 0.1, y: 0.1, w: 0.2, h: 0.8, areaM2: 1 }
    expect(keepDrawnCells(profile, [cell])).toEqual([cell])
  })

  it('drops everything when the profile found nothing to measure', () => {
    const blank = inkProfile(whiteImage(20, 20), 20, 20)
    expect(keepDrawnCells(blank, CELLS)).toEqual([])
  })
})
