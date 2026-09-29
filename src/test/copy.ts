import { expect } from 'vitest'

/**
 * A spec identifier as the specs write them (CPY-04): a rule id such as
 * `USR-R5` or `ZON-R5`, or a feedback id such as `RV5-22`. They stay in code
 * as keys; none of them may reach the screen.
 */
export const SPEC_ID = /\b[A-Z]{3}-R\d+\b|\bRV\d+-\d+\b/

/** Nothing currently rendered in the document names a spec id. */
export function expectNoSpecIds(root: HTMLElement = document.body) {
  expect(root.textContent ?? '').not.toMatch(SPEC_ID)
}
