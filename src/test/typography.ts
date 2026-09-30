import { expect } from 'vitest'

/**
 * The weight a piece of text is drawn at (TYP-02), read the way a browser
 * would: the nearest inline `font-weight` from the element up to its table
 * cell, and a `<strong>`/`<b>` on the way counted as bold, since with no
 * reset stylesheet those render at 700.
 */
export function weightOf(el: Element | null): number {
  expect(el).not.toBeNull()
  let node = el as HTMLElement | null
  while (node !== null) {
    if (node.style.fontWeight !== '') return Number(node.style.fontWeight)
    if (node.tagName === 'STRONG' || node.tagName === 'B') return 700
    if (node.tagName === 'TD' || node.tagName === 'TH') break
    node = node.parentElement
  }
  return 400
}

// `inherit` is a control taking its parent's step (`font: inherit`).
const SIZES = new Set(['11px', '12px', '13px', '15px', '20px', '21px', '32px', 'inherit'])
const WEIGHTS = new Set(['400', '600', '700', 'inherit'])

/**
 * Every hand-set size and weight under `root` is a step of the type scale
 * (TYP-01): no 10, 11.5 or 14, no 500, and 700 only at a display size.
 * Icons are glyphs, not text, and keep their own sizes.
 */
export function expectOnScale(root: HTMLElement) {
  const off: string[] = []
  for (const el of [root, ...root.querySelectorAll<HTMLElement>('[style]')]) {
    if (el.closest('.anticon') !== null) continue
    const { fontSize, fontWeight } = el.style
    const what = `${el.tagName.toLowerCase()} "${(el.textContent ?? '').slice(0, 30)}" ${fontSize}/${fontWeight}`
    if (fontSize !== '' && !SIZES.has(fontSize)) off.push(what)
    else if (fontWeight !== '' && !WEIGHTS.has(fontWeight)) off.push(what)
    else if (fontWeight === '700' && !['21px', '32px'].includes(fontSize)) off.push(what)
  }
  for (const el of root.querySelectorAll('strong, b')) off.push(`<${el.tagName.toLowerCase()}> "${el.textContent}"`)
  expect(off).toEqual([])
}
