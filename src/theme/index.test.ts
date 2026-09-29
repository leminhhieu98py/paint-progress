import { describe, expect, it } from 'vitest'
import { categoricalColor, palette } from '.'

/** WCAG relative luminance of a `#rrggbb` colour. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

const contrastWithWhite = (hex: string) => 1.05 / (luminance(hex) + 0.05)

describe('palette.categorical (CHT-01)', () => {
  it('has eight distinct colours', () => {
    expect(palette.categorical).toHaveLength(8)
    expect(new Set(palette.categorical.map((c) => c.toLowerCase())).size).toBe(8)
    for (const c of palette.categorical) expect(c).toMatch(/^#[0-9a-f]{6}$/i)
  })

  it('keeps every colour at 3:1 or more against white, the graphical-object minimum', () => {
    for (const c of palette.categorical) {
      expect({ colour: c, ratio: contrastWithWhite(c) >= 3 }).toEqual({ colour: c, ratio: true })
    }
  })

  it('starts on the accent, so a one-slice ring reads as it always has', () => {
    expect(palette.categorical[0]).toBe(palette.accent)
  })
})

describe('categoricalColor (CHT-01)', () => {
  it('hands out the palette in order for the first eight items', () => {
    for (let i = 0; i < 8; i++) expect(categoricalColor(i)).toBe(palette.categorical[i])
  })

  it('repeats the palette past eight items in a lighter tint of the same hue', () => {
    for (let i = 8; i < 16; i++) {
      const tint = categoricalColor(i)
      const base = palette.categorical[i % 8]
      expect(tint).not.toBe(base)
      expect(luminance(tint)).toBeGreaterThan(luminance(base))
    }
  })

  it('never gives two neighbours the same colour, round the ring included', () => {
    // A ring's last slice touches its first, so a ring of n slices is checked
    // as a cycle, for every n up to five laps of the palette.
    for (let n = 2; n <= 40; n++) {
      const ring = Array.from({ length: n }, (_, i) => categoricalColor(i))
      ring.forEach((c, i) => expect(c).not.toBe(ring[(i + 1) % n]))
    }
  })
})
