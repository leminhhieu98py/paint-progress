import { theme } from 'antd'
import type { CSSProperties } from 'react'

/**
 * A colour as a full circle, nothing else (CLR-01): no border, no frame, no
 * shadow. `diameter` is the height of the controls in its row (CTL-01).
 * Paired with the `pp-swatch` class, which strips the native picker's
 * pseudo-element frame and draws the keyboard focus ring.
 */
export function swatchStyle(diameter: number): CSSProperties {
  return {
    width: diameter,
    height: diameter,
    borderRadius: '50%',
    border: 'none',
    padding: 0,
    appearance: 'none',
    background: 'none',
    flex: 'none',
  }
}

/** The height of a control at this size under the current theme. */
export function useControlHeight(size?: 'small'): number {
  const { token } = theme.useToken()
  return size === 'small' ? token.controlHeightSM : token.controlHeight
}
