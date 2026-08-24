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
})
