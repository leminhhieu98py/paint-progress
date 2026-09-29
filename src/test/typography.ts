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
