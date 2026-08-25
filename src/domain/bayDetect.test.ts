import { describe, expect, it } from 'vitest'
import { detectBays, nameBays } from './bayDetect'

const BLACK: [number, number, number] = [0, 0, 0]
const RED: [number, number, number] = [200, 50, 50]

function whiteImage(width: number, height: number): Uint8Array {
  return new Uint8Array(width * height * 3).fill(255)
}

function paint(rgb: Uint8Array, width: number, x: number, y: number, color = BLACK): void {
  const o = (y * width + x) * 3
  rgb[o] = color[0]
  rgb[o + 1] = color[1]
  rgb[o + 2] = color[2]
}

/** A beam: `thickness` px wide, along its own axis, from `from` to `to`. */
function beam(
  rgb: Uint8Array, width: number,
  axis: 'v' | 'h', at: number, from: number, to: number, thickness = 3,
): void {
  for (let t = 0; t < thickness; t++) {
    for (let i = from; i <= to; i++) {
      if (axis === 'v') paint(rgb, width, at + t, i)
      else paint(rgb, width, i, at + t)
    }
  }
}

/**
 * A beam the render has broken up: 40 px drawn, 8 px missing, all the way.
 *
 * Long enough that the opening keeps it (OPTIONS' minRunFraction is 20 px on a
 * 200 px image) and the closing bridges it, so it is still a beam -- but 83%
 * covered, which is under the 85% a deck edge has to reach.
 */
function brokenBeam(
  rgb: Uint8Array, width: number,
  axis: 'v' | 'h', at: number, from: number, to: number, thickness = 3,
): void {
  for (let i = from; i <= to; i++) {
    if (i % 48 >= 40) continue
    for (let t = 0; t < thickness; t++) {
      if (axis === 'v') paint(rgb, width, at + t, i)
      else paint(rgb, width, i, at + t)
    }
  }
}

/** A dashed line: 10 px drawn, 12 px missing -- 45% solid, closed by bridging. */
function dashedBeam(
  rgb: Uint8Array, width: number,
  axis: 'v' | 'h', at: number, from: number, to: number, thickness = 3,
): void {
  for (let i = from; i <= to; i++) {
    if (i % 22 >= 10) continue
    for (let t = 0; t < thickness; t++) {
      if (axis === 'v') paint(rgb, width, at + t, i)
      else paint(rgb, width, i, at + t)
    }
  }
}

/** The whole deck: four outer beams and whatever interior ones are asked for. */
function deck(width: number, height: number, box: [number, number, number, number]) {
  const [x0, y0, x1, y1] = box
  const rgb = whiteImage(width, height)
  beam(rgb, width, 'v', x0, y0, y1)
  beam(rgb, width, 'v', x1 - 2, y0, y1)
  beam(rgb, width, 'h', y0, x0, x1)
  beam(rgb, width, 'h', y1 - 2, x0, x1)
  return rgb
}

/** Bays as `WxH@X,Y` in pixels, so a failure reads as geometry rather than floats. */
const asPixels = (bays: { x: number; y: number; w: number; h: number }[], width: number, height: number) =>
  bays.map((b) => `${Math.round(b.w * width)}x${Math.round(b.h * height)}`
    + `@${Math.round(b.x * width)},${Math.round(b.y * height)}`)

const OPTIONS = { minRunFraction: 0.1, closeFraction: 0.02, minAreaFraction: 0.005, minFill: 0.8 }
const WHOLE = { x: 0, y: 0, w: 1, h: 1 }

describe('detectBays', () => {
  it('finds the bays a grid of beams encloses', () => {
    // 100x100, deck 10..90, one interior beam on each axis: four bays.
    const rgb = deck(100, 100, [10, 10, 90, 90])
    beam(rgb, 100, 'v', 50, 10, 90)
    beam(rgb, 100, 'h', 50, 10, 90)

    // A tiling: bays meet ON the beams' own axes, so nothing is left over for
    // the beams' thickness. 12, 51 and 89 are the middles of the 3px beams at
    // 10, 50 and 88 -- which is where the admin draws the boundary by hand.
    expect(asPixels(detectBays(rgb, 100, 100, WHOLE, OPTIONS), 100, 100)).toEqual([
      '39x39@12,12', '37x39@51,12',
      '39x37@12,51', '37x37@51,51',
    ])
  })

  it('ignores text and leader lines inside a bay', () => {
    // The reason the structure pass exists. The customer's sheet puts a numbered
    // bubble in almost every bay with a leader line running from it to the beam
    // it labels -- and a leader crosses the bay corner to corner. Kept as ink it
    // is a wall, and it cuts the bay into two triangles that are then thrown out
    // for their shape. Held to a beam's minimum straight run it disappears: a
    // diagonal never has more than one pixel in a row.
    const rgb = deck(100, 100, [10, 10, 90, 90])
    for (let d = 13; d <= 87; d++) paint(rgb, 100, d, d)
    for (let x = 40; x <= 48; x++) paint(rgb, 100, x, 40)
    for (let x = 40; x <= 46; x++) paint(rgb, 100, x, 42)

    // 75 wide, not 77: the beams are 3px, so the bay runs from the inner face
    // of one to the inner face of the next.
    expect(asPixels(detectBays(rgb, 100, 100, WHOLE, OPTIONS), 100, 100)).toEqual(['76x76@12,12'])
  })

  it('does not divide a row by a beam that stops part way', () => {
    // The price of reading the beams' axes rather than the pockets between
    // them, and it is worth stating plainly: a beam covering half the deck does
    // not span it, so it is not a centreline, so it divides nothing -- not even
    // the half it does cover. The sheet's own unevenness is lost here, and the
    // admin rules that division by hand.
    //
    // It buys a tiling that covers the whole deck instead of 68% of it, and a
    // result that does not move when the box moves. Measured on the real sheet:
    // 138 bays covering 75% of the deck from a tight box, 148 at 80% from a
    // loose one, 146 at 79% from a very loose one -- against 163 bays covering
    // 68% before, from a box that had to be drawn carefully.
    const rgb = deck(100, 100, [10, 10, 90, 90])
    beam(rgb, 100, 'h', 50, 10, 90)
    beam(rgb, 100, 'v', 50, 10, 50)

    expect(asPixels(detectBays(rgb, 100, 100, WHOLE, OPTIONS), 100, 100))
      .toEqual(['76x39@12,12', '76x37@12,51'])
  })

  it('seals a bay whose own outer beam is missing with the admin box', () => {
    // The deck's outer beams are interrupted -- its corners are cut -- and a bay
    // that leaks has no boundary at all. The box the admin drew is the wall of
    // last resort, which is the only job it has left.
    const rgb = deck(100, 100, [10, 10, 90, 90])
    beam(rgb, 100, 'v', 50, 10, 90)
    // Erase the top beam's left half.
    for (let t = 0; t < 3; t++) for (let x = 10; x <= 49; x++) paint(rgb, 100, x, 10 + t, [255, 255, 255])

    // The box is ON the outer beams, which is what a wall of last resort means:
    // with a margin the leaking bay would join the margin instead and be thrown
    // out for its shape.
    const bays = detectBays(rgb, 100, 100, { x: 0.1, y: 0.1, w: 0.8, h: 0.8 }, OPTIONS)
    // The left bay now starts at the box wall (11) and reaches the left beam's
    // outer face (11), because the beam it should have been bounded by is gone;
    // the right bay is untouched.
    expect(asPixels(bays, 100, 100)).toEqual(['39x77@11,11', '35x75@53,13'])
  })

  it('drops the margin between a loose box and the deck', () => {
    // A box dragged with a margin encloses a ring around the deck. It is a
    // region like any other and would become a cell covering the title block;
    // its area barely fills its own bounding box, which is what rules it out.
    const rgb = deck(100, 100, [30, 30, 70, 70])

    const bays = detectBays(rgb, 100, 100, { x: 0.05, y: 0.05, w: 0.9, h: 0.9 }, OPTIONS)
    expect(asPixels(bays, 100, 100)).toEqual(['36x36@32,32'])
  })

  it('bridges a gap in a beam rather than letting two bays run together', () => {
    // Beams break where other structure crosses them. A 4px hole is not a door.
    const rgb = deck(100, 100, [10, 10, 90, 90])
    beam(rgb, 100, 'v', 50, 10, 90)
    for (let t = 0; t < 3; t++) for (let y = 44; y <= 47; y++) paint(rgb, 100, 50 + t, y, [255, 255, 255])

    // Two columns, and the row count is whatever the deck's own beams give --
    // the hole must not cost the middle beam its centreline.
    const bays = detectBays(rgb, 100, 100, WHOLE, OPTIONS)
    expect([...new Set(bays.map((b) => Math.round(b.x * 100)))]).toEqual([12, 51])
  })

  it('reads a centreline the red overlay is painted over', () => {
    // Red is the admin's own coarse plan grid, and it is excluded everywhere
    // else -- detecting it back as structure would defeat the point of the
    // feature. In the centreline pass it is counted, because on the customer's
    // sheet the red is drawn ALONG beam centrelines: the beam underneath has
    // its dashes painted out, and dropping the red drops the beam with them.
    const rgb = deck(100, 100, [10, 10, 90, 90])
    beam(rgb, 100, 'v', 50, 10, 90, 3)
    for (let y = 10; y <= 90; y++) paint(rgb, 100, 51, y, RED)

    expect([...new Set(detectBays(rgb, 100, 100, WHOLE, OPTIONS).map((b) => Math.round(b.x * 100)))])
      .toEqual([12, 51])
  })

  it('reads a beam drawn as two solid lines with a dashed centre', () => {
    // The sheet's own convention, and the reason the dashes have to be bridged
    // before a line is measured: a beam is two solid lines with a dashed line
    // down the middle, and it is the DASHED one that marks the beam's axis. Read
    // without bridging, a 50%-duty dash never clears the bar, and the two solid
    // flanks become two separate boundaries with a sliver between them.
    const rgb = deck(100, 100, [10, 10, 90, 90])
    beam(rgb, 100, 'v', 48, 10, 90, 1)
    beam(rgb, 100, 'v', 53, 10, 90, 1)
    for (let y = 10; y <= 90; y++) if (Math.floor(y / 3) % 2 === 0) paint(rgb, 100, 51, y)

    // One boundary at the beam's axis, not two at its faces.
    expect([...new Set(detectBays(rgb, 100, 100, WHOLE, OPTIONS).map((b) => Math.round(b.x * 100)))])
      .toEqual([12, 51])
  })

  it('takes the dashed line even where it is not the middle of the ink', () => {
    // The case the admin pointed at, zoomed in on their own screen: the boundary
    // was sitting on a beam's solid edge instead of its dashed axis. It happens
    // wherever the beam's ink is not symmetric -- a thicker flange on one side,
    // or a stiffener drawn against it -- because the middle of the ink is then
    // not the middle of the beam.
    //
    // Here the ink runs 190..203 with the dashes at 199..201: the middle of the
    // band is 196, and the answer is 200.
    const width = 400
    const height = 400
    const rgb = whiteImage(width, height)
    for (const x of [40, 358]) beam(rgb, width, 'v', x, 40, 360)
    for (const y of [40, 358]) beam(rgb, width, 'h', y, 40, 360)
    for (let y = 190; y <= 198; y++) beam(rgb, width, 'h', y, 40, 360, 1)
    for (let y = 202; y <= 203; y++) beam(rgb, width, 'h', y, 40, 360, 1)
    for (let y = 199; y <= 201; y++) {
      for (let x = 40; x <= 360; x++) if (Math.floor(x / 4) % 2 === 0) paint(rgb, width, x, y)
    }

    const tops = [...new Set(detectBays(rgb, width, height, WHOLE, {
      ...OPTIONS, minRunFraction: 0.05, dashGapFraction: 0.02,
    }).map((b) => Math.round(b.y * height)))]
    // Somewhere on the dashes, and nowhere near the middle of the ink.
    expect(tops.some((t) => t >= 199 && t <= 201)).toBe(true)
    expect(tops.some((t) => t >= 190 && t <= 198)).toBe(false)
  })

  it('closes the deck at its edge when the outer beam is too cut to read', () => {
    // The admin found the gaps were all at the boundary, next to where they had
    // cropped. The deck's outer beams are the hardest to read a centreline from:
    // their corners are cut, so they span less of the deck than any beam inside
    // it and fall below the bar -- and the whole boundary strip of bays then has
    // no closing line and is not there.
    //
    // Here the left outer beam stops two thirds of the way down: 63% of the
    // deck, under the 70% a centreline needs. Its column of bays still has to
    // exist -- for the two rows the beam does run past. The third is a corner
    // the beam never reaches, and deckSpan drops it, which is the other half of
    // this rule and why the count is 8 rather than 9.
    const width = 200
    const height = 200
    const rgb = whiteImage(width, height)
    beam(rgb, width, 'v', 20, 20, 120)      // left edge, cut two thirds down
    beam(rgb, width, 'v', 178, 20, 180)     // right edge
    beam(rgb, width, 'h', 20, 20, 180)      // top edge
    beam(rgb, width, 'h', 178, 20, 180)     // bottom edge
    for (const at of [80, 120]) {
      beam(rgb, width, 'v', at, 20, 180)
      beam(rgb, width, 'h', at, 20, 180)
    }

    const bays = detectBays(rgb, width, height, { x: 0.05, y: 0.05, w: 0.9, h: 0.9 }, OPTIONS)

    expect(bays).toHaveLength(8)
    // The boundary bays reach the deck's own edge rather than stopping at the
    // first beam that happened to read -- that is what the edge line buys.
    expect(Math.round(Math.min(...bays.map((b) => b.x)) * width)).toBeLessThan(30)
    // And the one bay missing is the corner the cut beam never reached: bottom
    // row, left column.
    expect(bays.filter((b) => b.x < 0.3 && b.y > 0.55)).toEqual([])
  })

  it('keeps a bay standing on solid structure', () => {
    // Deck to paint is deck to paint whether the sheet draws a pocket there or
    // something solid -- the E-house, a pedestal, a hatched column. Dropping a
    // cell for enclosing nothing punched 46 holes of 184 in the middle of the
    // real deck, which is why the "encloses something" rule works on whole rows
    // and columns instead.
    //
    // Here the bottom-right quarter is solid, and it is still a bay.
    const rgb = deck(100, 100, [10, 10, 90, 90])
    beam(rgb, 100, 'v', 50, 10, 90)
    beam(rgb, 100, 'h', 50, 10, 90)
    for (let y = 53; y <= 87; y++) for (let x = 53; x <= 87; x++) paint(rgb, 100, x, y)

    expect(asPixels(detectBays(rgb, 100, 100, WHOLE, OPTIONS), 100, 100)).toEqual([
      '39x39@12,12', '37x39@51,12', '39x37@12,51', '37x37@51,51',
    ])
  })

  it('returns nothing for a sheet with no structure on it', () => {
    expect(detectBays(whiteImage(60, 60), 60, 60, WHOLE, OPTIONS)).toEqual([])
  })
})

describe('nameBays', () => {
  const at = (x: number, y: number, w: number, h: number) => ({ x, y, w, h })

  it('numbers bays by row and column, reading order', () => {
    // Tops jittered and the input shuffled: no two beams rasterise to the same
    // pixel, and the regions come back in whatever order the scan found them.
    expect(nameBays([
      at(0.52, 0.503, 0.38, 0.4), at(0.1, 0.1, 0.3, 0.3),
      at(0.52, 0.098, 0.38, 0.3), at(0.1, 0.5, 0.4, 0.4),
    ]).map((b) => `${b.code}@${b.x}`))
      .toEqual(['R1C1@0.1', 'R1C2@0.52', 'R2C1@0.1', 'R2C2@0.52'])
  })

  it('keeps a tall bay in the row it starts, rather than opening a new one', () => {
    // A beam that stops part way leaves a bay spanning two rows of its
    // neighbours. Grouping by a shared top edge would give it a row of its own
    // and renumber everything below it.
    expect(nameBays([
      at(0.1, 0.1, 0.3, 0.6), at(0.5, 0.1, 0.4, 0.3), at(0.5, 0.45, 0.4, 0.25),
    ]).map((b) => `${b.code}@${b.x}`)).toEqual(['R1C1@0.1', 'R1C2@0.5', 'R2C1@0.5'])
  })

  it('starts a new row for a bay that overlaps nothing above it', () => {
    expect(nameBays([at(0.1, 0.1, 0.3, 0.2), at(0.1, 0.6, 0.3, 0.2)]).map((b) => b.code))
      .toEqual(['R1C1', 'R2C1'])
  })
  it('leaves out the corner an L-shaped deck does not reach into', () => {
    // Two thirds of a square: the top-left quadrant is not deck. Its two beams
    // stop where the deck stops -- the left beam only runs down the bottom
    // half, the top beam only across the right half -- which is exactly how a
    // real sheet draws a deck that is not a rectangle.
    //
    // The grid cannot express that: it is a product of every x line with every
    // y line, so it always proposes a cell in that corner. On the customer's
    // sheet that cost 35 phantom cells out of 198, all of them along an edge,
    // and the admin had to find and delete each one.
    const rgb = whiteImage(200, 200)
    beam(rgb, 200, 'v', 20, 100, 180)   // left edge: bottom half only
    beam(rgb, 200, 'v', 100, 20, 180)   // middle, full height
    beam(rgb, 200, 'v', 178, 20, 180)   // right edge, full height
    beam(rgb, 200, 'h', 20, 100, 180)   // top edge: right half only
    beam(rgb, 200, 'h', 100, 20, 180)   // middle, full width
    beam(rgb, 200, 'h', 178, 20, 180)   // bottom edge, full width

    const bays = detectBays(rgb, 200, 200, WHOLE, OPTIONS)

    expect(bays).toHaveLength(3)
    // Named rather than counted: a rule that dropped the wrong cell would still
    // leave three.
    const inTopLeft = bays.filter((b) => b.x < 0.4 && b.y < 0.4)
    expect(inTopLeft).toEqual([])
  })

  it('keeps every cell of a deck that really is a rectangle', () => {
    // The other half of the rule above. Dropping a cell because its edge reads
    // weakly is a one-way loss -- the admin cannot get it back except by
    // re-detecting the whole deck -- so the guard has to leave a plain
    // rectangular deck completely alone.
    const rgb = deck(200, 200, [20, 20, 180, 180])
    beam(rgb, 200, 'v', 100, 20, 180)
    beam(rgb, 200, 'h', 100, 20, 180)

    expect(detectBays(rgb, 200, 200, WHOLE, OPTIONS)).toHaveLength(4)
  })
  it('drops a cell over a slot the deck leaves open at its edge', () => {
    // A notch in the middle of the top edge, not at a corner: the top beam runs
    // either side of it and stops. Scanning the top row across still finds the
    // deck's left and right edges, so the row reads full width and cannot see
    // the slot -- only the column can, by finding no top edge above it.
    const width = 200
    const height = 200
    const rgb = whiteImage(width, height)
    for (const at of [20, 80, 120, 178]) beam(rgb, width, 'v', at, 20, 178)
    beam(rgb, width, 'h', 80, 20, 178)
    beam(rgb, width, 'h', 178, 20, 178)
    beam(rgb, width, 'h', 20, 20, 80)     // top edge, left of the slot
    beam(rgb, width, 'h', 20, 120, 178)   // top edge, right of the slot

    const bays = detectBays(rgb, width, height, { x: 0.05, y: 0.05, w: 0.9, h: 0.9 }, OPTIONS)

    expect(bays.filter((b) => b.x > 0.35 && b.x < 0.5 && b.y < 0.3)).toEqual([])
    // Everything either side of the slot survives: the notch is one cell wide.
    expect(bays.filter((b) => b.y < 0.3)).toHaveLength(2)
  })

  it('drops a cell over a slot the deck leaves open at its far edge', () => {
    // The right edge stops for one row band and picks up again below it. Only a
    // scan that comes inward from the RIGHT can see that: from the left, the
    // first solid line is the left edge and everything looks normal, so an
    // extent that ran from the first solid line to the end of the search would
    // read this band as full width and keep a cell that is off the deck.
    const width = 200
    const height = 200
    const rgb = whiteImage(width, height)
    for (const at of [20, 80, 120, 178]) beam(rgb, width, 'h', at, 20, 178)
    beam(rgb, width, 'v', 20, 20, 178)
    beam(rgb, width, 'v', 100, 20, 178)
    beam(rgb, width, 'v', 178, 20, 80)     // right edge, above the slot
    beam(rgb, width, 'v', 178, 120, 178)   // right edge, below the slot

    const bays = detectBays(rgb, width, height, WHOLE, OPTIONS)

    expect(bays).toHaveLength(5)
    expect(bays.filter((b) => b.x > 0.4 && b.y > 0.35 && b.y < 0.5)).toEqual([])
  })

  it('keeps every cell when no edge reads solidly enough to place the deck', () => {
    // Every beam broken 1 px in 4, so nothing reaches the bar a deck edge has to
    // clear. The extent is then unknown, and unknown must mean "keep" -- this
    // rule is here to remove cells that are demonstrably outside the deck, not
    // cells it cannot see. Reading a missing measurement as "outside" would
    // empty the whole deck on any drawing that renders faintly.
    const width = 200
    const height = 200
    const rgb = whiteImage(width, height)
    for (const at of [20, 100, 178]) {
      brokenBeam(rgb, width, 'v', at, 20, 178)
      brokenBeam(rgb, width, 'h', at, 20, 178)
    }

    expect(detectBays(rgb, width, height, WHOLE, OPTIONS)).toHaveLength(4)
  })
  it('picks up a bay hanging off the deck that no grid line reaches', () => {
    // A pedestal box on the outside of the left beam. The deck's outline is not
    // just stepped -- things hang off it: pedestals, stair landings, corner
    // platforms -- and they sit outside every line the beam grid produced. The
    // grid cannot reach them: the box's own beams are too short to read a
    // centreline from, and the deck-extent rule correctly refuses to put a cell
    // out there on the strength of a line it cannot see.
    //
    // The drawing already closed it, so it is in `regions` -- this is about
    // handing back a closed area the grid had no way to propose.
    const width = 200
    const height = 200
    const rgb = whiteImage(width, height)
    for (const at of [40, 110, 178]) {
      beam(rgb, width, 'v', at, 40, 178)
      beam(rgb, width, 'h', at, 40, 178)
    }
    beam(rgb, width, 'v', 15, 60, 100)    // the box's outer wall
    beam(rgb, width, 'h', 60, 15, 40)
    beam(rgb, width, 'h', 100, 15, 40)

    const bays = detectBays(rgb, width, height, WHOLE, OPTIONS)

    expect(bays).toHaveLength(5)
    const hanging = bays.filter((b) => b.x * width < 30)
    expect(hanging).toHaveLength(1)
    expect(Math.round(hanging[0].y * height)).toBeGreaterThan(55)
    expect(Math.round((hanging[0].y + hanging[0].h) * height)).toBeLessThan(105)
  })

  it('does not hand back a closed box that is not attached to the deck', () => {
    // The title block is a closed rectangle too, and so is every detail frame on
    // the sheet. What separates a pedestal from them is that a pedestal touches
    // the deck. Same box as above, moved 15 px clear of the left beam: nothing
    // else about it changed, and it must not become a bay.
    const width = 200
    const height = 200
    const rgb = whiteImage(width, height)
    for (const at of [40, 110, 178]) {
      beam(rgb, width, 'v', at, 40, 178)
      beam(rgb, width, 'h', at, 40, 178)
    }
    beam(rgb, width, 'v', 5, 60, 100)
    beam(rgb, width, 'v', 25, 60, 100)
    beam(rgb, width, 'h', 60, 5, 25)
    beam(rgb, width, 'h', 100, 5, 25)

    const bays = detectBays(rgb, width, height, WHOLE, OPTIONS)

    expect(bays).toHaveLength(4)
    expect(bays.filter((b) => b.x * width < 30)).toEqual([])
  })
  it('does not split a bay on a line the drawing does not draw there', () => {
    // The top strip of the customer's deck: two horizontal beams run the full
    // width, but between them the vertical beams stop -- the strip is one open
    // run, not six bays. The grid proposes a cell per column anyway, because a
    // line that reads as a centreline over the deck as a whole is a line
    // everywhere in the grid, including where it was never drawn.
    //
    // Here the middle beam runs the bottom row only. It still clears the
    // centreline bar over the whole deck (78%), so the grid has that line; over
    // the top row it is 3% and the two cells either side of it are one bay.
    const width = 300
    const height = 200
    const rgb = whiteImage(width, height)
    for (const at of [40, 180, 260]) beam(rgb, width, 'v', at, 40, 178)
    beam(rgb, width, 'v', 100, 70, 178)
    for (const at of [40, 70, 178]) beam(rgb, width, 'h', at, 40, 260)

    const bays = detectBays(rgb, width, height, WHOLE, OPTIONS)

    expect(bays).toHaveLength(5)
    // The merged bay spans both columns: from the deck's left edge to the beam
    // at 180, across the shallow top row.
    const top = bays.filter((b) => Math.round(b.y * height) < 60)
    expect(asPixels(top, width, height)).toEqual(['140x30@41,41', '79x30@181,41'])
  })

  it('does not split a bay on a horizontal line that stops short either', () => {
    // The same rule the other way up, so a deck whose missing beam runs the
    // other way is not left to a rule that only ever looked at one axis.
    const width = 200
    const height = 300
    const rgb = whiteImage(width, height)
    for (const at of [40, 180, 260]) beam(rgb, width, 'h', at, 40, 178)
    beam(rgb, width, 'h', 100, 70, 178)
    for (const at of [40, 70, 178]) beam(rgb, width, 'v', at, 40, 260)

    const bays = detectBays(rgb, width, height, WHOLE, OPTIONS)

    expect(bays).toHaveLength(5)
    const left = bays.filter((b) => Math.round(b.x * width) < 60)
    expect(asPixels(left, width, height)).toEqual(['29x139@42,42', '29x79@42,181'])
  })
  it('counts a dashed beam as drawn, so a dash pattern is not read as a missing line', () => {
    // Same shape as the merge above, except the middle beam is DASHED across the
    // top row rather than absent: 45% of that stretch carries ink. Beams on this
    // sheet are dashed by convention, and reading the gaps between dashes as
    // "no line here" would merge the whole deck into a handful of bays.
    const width = 300
    const height = 200
    const rgb = whiteImage(width, height)
    for (const at of [40, 180, 260]) beam(rgb, width, 'v', at, 40, 178)
    dashedBeam(rgb, width, 'v', 100, 40, 70)
    beam(rgb, width, 'v', 100, 70, 178)
    for (const at of [40, 70, 178]) beam(rgb, width, 'h', at, 40, 260)

    // The default bridge is 1 px at this size, which would close nothing; the
    // customer's sheet renders 3000 px wide where it is 10.
    const bays = detectBays(rgb, width, height, WHOLE, { ...OPTIONS, dashGapFraction: 0.05 })

    expect(bays).toHaveLength(6)
  })

  it('leaves no two bays overlapping after a merge', () => {
    // A merged bay is handed to the admin as one rectangle and its area is
    // counted once. A merge that joined blocks covering different columns would
    // hand back an L reported as its bounding box, overlapping the bay beside
    // it and double-counting that ground in every percentage the deck reports.
    const width = 300
    const height = 200
    const rgb = whiteImage(width, height)
    for (const at of [40, 180, 260]) beam(rgb, width, 'v', at, 40, 178)
    beam(rgb, width, 'v', 100, 70, 178)
    for (const at of [40, 70, 178]) beam(rgb, width, 'h', at, 40, 260)

    const bays = detectBays(rgb, width, height, WHOLE, OPTIONS)

    for (let i = 0; i < bays.length; i++) {
      for (let j = i + 1; j < bays.length; j++) {
        const w = Math.min(bays[i].x + bays[i].w, bays[j].x + bays[j].w) - Math.max(bays[i].x, bays[j].x)
        const h = Math.min(bays[i].y + bays[i].h, bays[j].y + bays[j].h) - Math.max(bays[i].y, bays[j].y)
        expect(w <= 0 || h <= 0).toBe(true)
      }
    }
  })
  it('does not let a closed area below the deck become a bay', () => {
    // The customer's sheet underlines its own title, and the deck's bottom beam
    // plus that underline close a strip of blank paper between them. It is
    // closed and it touches the deck, so nothing in the rescue rule tells it
    // from a pedestal: it came back as a bay hanging 115px under the
    // bottom-right corner, over the title text.
    //
    // What gives it away is that its bounding box overshoots the shape inside
    // it. A pedestal is a box -- four walls, all drawn, every side reads 1.00.
    // This one's floor is drawn in two pieces at different depths, so the bottom
    // of its box carries ink over half its length.
    const width = 300
    const height = 260
    const rgb = whiteImage(width, height)
    for (const at of [40, 150, 260]) {
      beam(rgb, width, 'v', at, 40, 178)
      beam(rgb, width, 'h', at, 40, 260)
    }
    beam(rgb, width, 'h', 178, 40, 260)
    beam(rgb, width, 'v', 100, 178, 210)
    beam(rgb, width, 'v', 200, 178, 200)
    beam(rgb, width, 'v', 150, 200, 210)   // the riser between the two pieces
    beam(rgb, width, 'h', 210, 100, 150)
    beam(rgb, width, 'h', 200, 150, 200)

    // A shorter opening than the rest of this file uses, so the 11px riser that
    // closes the shape survives to close it.
    const bays = detectBays(rgb, width, height, WHOLE, { ...OPTIONS, minRunFraction: 0.02 })

    // Nothing may reach below the deck's bottom beam at 178.
    expect(bays.filter((b) => (b.y + b.h) * height > 185)).toEqual([])
  })
})
