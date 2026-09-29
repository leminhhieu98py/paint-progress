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

/**
 * The subtitle under the page title (PageHeader's `<p>`), or null when the
 * page has none. CPY-03: a subtitle left empty, or only `<project> ·`, is
 * dropped entirely.
 */
export function pageSubtitle(): HTMLElement | null {
  const title = document.querySelector('h1')
  const next = title?.parentElement?.nextElementSibling
  return next instanceof HTMLParagraphElement ? next : null
}

/**
 * The texts of the KeyFacts pills (HLT-01) under `root` -- the facts beside a
 * card or page title -- in order, e.g. `['2 lớp', 'tổng 1,00']`.
 */
export function keyFactTexts(root: ParentNode = document): string[] {
  return Array.from(root.querySelectorAll('[data-testid="key-fact"]'), (el) => el.textContent ?? '')
}
