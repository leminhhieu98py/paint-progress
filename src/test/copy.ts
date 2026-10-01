import { within } from '@testing-library/react'
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

/** The customer's copyright line that ends every screen (RV7-2), word for word. */
export const COPYRIGHT = 'Bản quyền © 2026 Đoàn Công Linh – XDVTH'

/**
 * A line of prose under the page title (a `<p>` after the title line), or
 * null. PageHeader has no subtitle any more (HLT-01: facts sit on the title's
 * line); this guards against one coming back (CPY-01, CPY-03).
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

/**
 * The entries of the open `Quy tắc áp dụng` under `root`, in order. Open it
 * first; a closed disclosure has none.
 */
export function ruleTexts(root: HTMLElement = document.body): string[] {
  const button = within(root).getByRole('button', { name: /Quy tắc áp dụng/ })
  const list = button.nextElementSibling
  return list === null ? [] : Array.from(list.children, (el) => el.textContent ?? '')
}

/**
 * RUL-01: each entry is helper text -- one sentence ending in a full stop, no
 * spec id, no second sentence or clause after a semicolon or colon, and no
 * reasoning ("vì…", "nên…") or future ("sẽ").
 */
export function expectHelperText(texts: string[]) {
  expect(texts.length).toBeGreaterThan(0)
  for (const text of texts) {
    expect(text).not.toMatch(SPEC_ID)
    expect(text).toMatch(/\.$/)
    expect(text.slice(0, -1)).not.toMatch(/[.;:!?](\s|$)/)
    expect(text).not.toMatch(/(^|\s)(vì|nên|sẽ)\s/i)
  }
}

/**
 * RUL-01 for a confirm dialog's consequence item: a fragment, not a sentence --
 * no full stop, no second clause after a semicolon or colon, no spec id, no
 * reasoning ("vì…", "nên…") or future ("sẽ").
 */
export function expectConsequenceItem(text: string) {
  expect(text.trim()).not.toBe('')
  expect(text).not.toMatch(/[.;:]\s*$/)
  expect(text).not.toMatch(/[.;:](\s|$)/)
  expect(text).not.toMatch(SPEC_ID)
  expect(text).not.toMatch(/(^|\s)(vì|nên|sẽ)\s/i)
}

/**
 * The consequence items of an open ConsequenceModal under `root`, in order
 * (RUL-01), each checked with `expectConsequenceItem` on the way.
 */
export function consequenceItems(root: HTMLElement = document.body): string[] {
  const texts = within(root).queryAllByRole('listitem')
    .filter((li) => li.closest('ul[aria-label="Hệ quả"]') !== null)
    .map((li) => li.textContent ?? '')
  texts.forEach(expectConsequenceItem)
  return texts
}
