import { expect } from 'vitest'

/**
 * antd's controls and the class each carries at `size="small"`. Switch and
 * Checkbox keep their own size (CTL-01) and are not listed.
 */
const SMALL: [selector: string, small: string][] = [
  ['.ant-btn', 'ant-btn-sm'],
  ['.ant-input-number', 'ant-input-number-sm'],
  ['.ant-picker', 'ant-picker-small'],
  ['.ant-select', 'ant-select-sm'],
  ['.ant-segmented', 'ant-segmented-sm'],
  ['.ant-input-affix-wrapper', 'ant-input-affix-wrapper-sm'],
  // A bare Input, not the one inside an InputNumber, a picker or an affix.
  ['input.ant-input:not(.ant-input-number-input)', 'ant-input-sm'],
]

/** The antd controls under `root` that are not `size="small"`, by class and name. */
function sizeOf(root: HTMLElement, wantSmall: boolean) {
  const off: string[] = []
  for (const [selector, small] of SMALL) {
    for (const el of root.querySelectorAll<HTMLElement>(selector)) {
      if (selector.startsWith('input') && el.closest('.ant-input-affix-wrapper, .ant-input-group-wrapper') !== null) continue
      if (el.classList.contains(small) !== wantSmall) {
        off.push(`${selector} ${el.getAttribute('aria-label') ?? el.textContent?.slice(0, 30) ?? ''}`)
      }
    }
  }
  return off
}

/** Every control inside a table row is `size="small"` (CTL-01). */
export function expectAllSmall(row: HTMLElement) {
  expect(row.querySelectorAll(SMALL.map(([s]) => s).join(', ')).length).toBeGreaterThan(0)
  expect(sizeOf(row, true)).toEqual([])
}

/** Every control outside a table is the default size (CTL-01). */
export function expectNoneSmall(root: HTMLElement) {
  expect(sizeOf(root, false)).toEqual([])
}
