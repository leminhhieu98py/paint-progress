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

    // Each bay runs from the inner face of one beam to the inner face of the
    // next: 13..49 and 53..87 on each axis, given 3px beams at 10, 50 and 88.
    expect(asPixels(detectBays(rgb, 100, 100, WHOLE, OPTIONS), 100, 100)).toEqual([
      '37x37@13,13', '35x37@53,13',
      '37x35@13,53', '35x35@53,53',
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
    expect(asPixels(detectBays(rgb, 100, 100, WHOLE, OPTIONS), 100, 100)).toEqual(['75x75@13,13'])
  })

  it('joins the bays a beam that stops part way does not divide', () => {
    // The interior beam covers the top half only, so the sheet shows two bays
    // above and ONE below -- the unevenness that a grid of guides cannot
    // express, and that falls out of this for free.
    const rgb = deck(100, 100, [10, 10, 90, 90])
    beam(rgb, 100, 'h', 50, 10, 90)
    beam(rgb, 100, 'v', 50, 10, 50)

    expect(asPixels(detectBays(rgb, 100, 100, WHOLE, OPTIONS), 100, 100)).toEqual([
      '37x37@13,13', '35x37@53,13',
      '75x35@13,53',
    ])
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
    expect(asPixels(bays, 100, 100)).toEqual(['35x35@33,33'])
  })

  it('bridges a gap in a beam rather than letting two bays run together', () => {
    // Beams break where other structure crosses them. A 4px hole is not a door.
    const rgb = deck(100, 100, [10, 10, 90, 90])
    beam(rgb, 100, 'v', 50, 10, 90)
    for (let t = 0; t < 3; t++) for (let y = 44; y <= 47; y++) paint(rgb, 100, 50 + t, y, [255, 255, 255])

    expect(detectBays(rgb, 100, 100, WHOLE, OPTIONS)).toHaveLength(2)
  })

  it('ignores the red plan overlay, the same as every other pass', () => {
    const rgb = deck(100, 100, [10, 10, 90, 90])
    beam(rgb, 100, 'v', 50, 10, 90, 3)
    for (let t = 0; t < 3; t++) for (let y = 10; y <= 90; y++) paint(rgb, 100, 30 + t, y, RED)

    // Two bays, not three: the red line is not a beam.
    expect(detectBays(rgb, 100, 100, WHOLE, OPTIONS)).toHaveLength(2)
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
