import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'
import { palette } from '../theme'

/**
 * How a ring and its legend rows answer the pointer (CHT-02), shared by the
 * `Donut` and the three screens that print its legend.
 *
 * A mouse highlights on enter and lets go on leave. A finger has no hover: a
 * tap toggles the item, the next tap elsewhere clears it, and the leave event
 * the browser fires after the finger lifts is ignored (m-3) -- it used to
 * clear what the tap had just set.
 */

/** A legend row while its slice is active: a background, the text not bolder (R5-C1). */
export const LEGEND_ACTIVE_BG = palette.bgHover

/**
 * Calls `clear` on the next pointer that goes down outside `el`, once.
 *
 * Registered in the capture phase, so a tap on another row or slice clears
 * this one before that one's own tap sets it.
 */
export function clearOnTapElsewhere(el: Element, clear: () => void): void {
  const onDown = (e: PointerEvent) => {
    document.removeEventListener('pointerdown', onDown, true)
    if (!(e.target instanceof Node) || !el.contains(e.target)) clear()
  }
  document.addEventListener('pointerdown', onDown, true)
}

/**
 * The props of one focusable legend row for `key`, its own layout in `base`.
 *
 * The highlight's padding comes out of the row gap (negative margin), so the
 * rows sit where they would without it. Tab order is the rows' DOM order,
 * which is legend order.
 */
export function legendRowProps(
  key: string,
  active: string | null,
  setActive: (key: string | null) => void,
  base: CSSProperties = {},
): {
  tabIndex: number
  onPointerEnter: (e: ReactPointerEvent<HTMLElement>) => void
  onPointerLeave: (e: ReactPointerEvent<HTMLElement>) => void
  onPointerUp: (e: ReactPointerEvent<HTMLElement>) => void
  onFocus: () => void
  onBlur: () => void
  style: CSSProperties
} {
  return {
    tabIndex: 0,
    onPointerEnter: (e) => {
      if (e.pointerType !== 'touch') setActive(key)
    },
    onPointerLeave: (e) => {
      if (e.pointerType !== 'touch') setActive(null)
    },
    onPointerUp: (e) => {
      if (e.pointerType !== 'touch') return
      if (active === key) {
        setActive(null)
      } else {
        setActive(key)
        clearOnTapElsewhere(e.currentTarget, () => setActive(null))
      }
    },
    onFocus: () => setActive(key),
    onBlur: () => setActive(null),
    style: {
      ...base,
      margin: '-2px -6px',
      padding: '2px 6px',
      borderRadius: 6,
      background: active === key ? LEGEND_ACTIVE_BG : undefined,
    },
  }
}
