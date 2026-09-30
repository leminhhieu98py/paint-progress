import { expect } from 'vitest'

/**
 * A left-aligned table cell or header (UI-03, UI-06): no alignment of its own,
 * or an explicit left/start. Stronger than "not centred", which a column set to
 * `align: 'right'` would also pass. antd writes a column's `align` as an inline
 * `text-align` on its th and td, so that is what is read.
 */
export function expectLeft(el: Element | null) {
  expect(el).not.toBeNull()
  const cell = el as HTMLElement
  expect(['', 'left', 'start']).toContain(cell.style.textAlign)
  expect(['', 'left', 'start']).toContain(getComputedStyle(cell).textAlign)
}
