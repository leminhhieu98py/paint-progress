import { describe, expect, it } from 'vitest'
import { adminTheme, categoricalColor, fieldTheme, fieldType, palette, type } from '.'

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

  it('has no grey, which a ring reads as its remainder track (m-5)', () => {
    // HSL saturation: the slate the palette once had is 0,10; the track is a
    // grey too. Every hue here is a colour, well clear of both.
    const saturation = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      const max = Math.max(r, g, b)
      const min = Math.min(r, g, b)
      const l = (max + min) / 2
      return max === min ? 0 : (max - min) / (1 - Math.abs(2 * l - 1))
    }
    expect(saturation(palette.track)).toBeLessThan(0.4)
    for (const c of palette.categorical) {
      expect({ colour: c, saturated: saturation(c) >= 0.4 }).toEqual({ colour: c, saturated: true })
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

describe('type (TYP-01)', () => {
  it('is the one scale, size and weight per role', () => {
    expect(type).toEqual({
      display: { fontSize: 32, fontWeight: 700 },
      displaySm: { fontSize: 21, fontWeight: 700 },
      pageTitle: { fontSize: 20, fontWeight: 600 },
      cardTitle: { fontSize: 15, fontWeight: 600 },
      body: { fontSize: 13, fontWeight: 400 },
      bodyStrong: { fontSize: 13, fontWeight: 600 },
      label: { fontSize: 13, fontWeight: 600 },
      caption: { fontSize: 12, fontWeight: 400 },
      micro: { fontSize: 11, fontWeight: 600 },
    })
  })

  it('goes no smaller than 11 and no heavier than 600 outside the two display sizes', () => {
    for (const [role, t] of Object.entries(type)) {
      expect({ role, ok: t.fontSize >= 11 && Number.isInteger(t.fontSize) }).toEqual({ role, ok: true })
      if (!role.startsWith('display')) expect({ role, weight: t.fontWeight <= 600 }).toEqual({ role, weight: true })
    }
  })

  it('agrees with the admin theme: base size is body, card and dialog titles are cardTitle', () => {
    expect(adminTheme.token?.fontSize).toBe(type.body.fontSize)
    expect(adminTheme.token?.fontWeightStrong).toBe(type.bodyStrong.fontWeight)
    expect(adminTheme.components?.Card?.headerFontSize).toBe(type.cardTitle.fontSize)
    expect(adminTheme.components?.Modal?.titleFontSize).toBe(type.cardTitle.fontSize)
  })
})

describe('fieldType (GS-04, GS-10)', () => {
  it('is the same scale on the field theme\'s base of 14: body, bodyStrong and label move, nothing else', () => {
    expect(fieldType).toEqual({
      ...type,
      body: { fontSize: 14, fontWeight: 400 },
      bodyStrong: { fontSize: 14, fontWeight: 600 },
      label: { fontSize: 14, fontWeight: 600 },
    })
  })

  it('agrees with the field theme: its base size is body', () => {
    expect(fieldTheme.token?.fontSize).toBe(fieldType.body.fontSize)
  })
})
