import { expect } from 'vitest'

/**
 * antd's controls and the classes each carries at `size="small"` and at
 * `size="large"`. Switch and Checkbox keep their own size and are not listed.
 */
const SIZED: [selector: string, small: string, large: string][] = [
  ['.ant-btn', 'ant-btn-sm', 'ant-btn-lg'],
  ['.ant-input-number', 'ant-input-number-sm', 'ant-input-number-lg'],
  ['.ant-picker', 'ant-picker-small', 'ant-picker-large'],
  ['.ant-select', 'ant-select-sm', 'ant-select-lg'],
  ['.ant-segmented', 'ant-segmented-sm', 'ant-segmented-lg'],
  ['.ant-input-affix-wrapper', 'ant-input-affix-wrapper-sm', 'ant-input-affix-wrapper-lg'],
  // A field with an addon: antd sizes the wrapper, not only the input.
  ['.ant-input-group-wrapper', 'ant-input-group-wrapper-sm', 'ant-input-group-wrapper-lg'],
  // A bare Input, not the one inside an InputNumber, a picker or an affix.
  ['input.ant-input:not(.ant-input-number-input)', 'ant-input-sm', 'ant-input-lg'],
]

/** The antd controls under `root` that carry a size of their own, by class and name. */
function sized(root: HTMLElement) {
  const off: string[] = []
  for (const [selector, small, large] of SIZED) {
    for (const el of root.querySelectorAll<HTMLElement>(selector)) {
      if (el.classList.contains(small) || el.classList.contains(large)) {
        off.push(`${selector} ${el.getAttribute('aria-label') ?? el.textContent?.slice(0, 30) ?? ''}`)
      }
    }
  }
  return off
}

/**
 * Every control under `root` -- a table row included -- stands at the theme's
 * one control height: no `size="small"`, no `size="large"` (CTL-02).
 */
export function expectOneHeight(root: HTMLElement) {
  expect(root.querySelectorAll(SIZED.map(([s]) => s).join(', ')).length).toBeGreaterThan(0)
  expect(sized(root)).toEqual([])
}
