import { swatchStyle } from './swatch'
import { useTypeScale } from './typeScale'
import { palette } from '../theme'

/** `#rrggbb` at body size in a monospace face: every code the same width. */
const HEX_WIDTH = 64
const GAP = 10

/**
 * A colour shown read-only, as a circle and its hex code (CLR-01), laid out
 * as one fixed-width block with its content left-aligned, circle first. The
 * cell centres the block; every circle in a column then sits on one vertical
 * line and every code starts at one x, whatever its letters (AD7).
 */
export function SwatchCode({ color, label, diameter }: {
  color: string
  /** The circle's accessible name, e.g. `Màu của Blast + Coat 1`. */
  label: string
  diameter: number
}) {
  const type = useTypeScale()
  return (
    <span
      data-testid="swatch-code"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'flex-start',
        gap: GAP,
        width: diameter + GAP + HEX_WIDTH,
        flex: 'none',
      }}
    >
      <span aria-label={label} style={{ ...swatchStyle(diameter), display: 'inline-block', background: color }} />
      <span
        style={{
          ...type.body,
          color: palette.textSecondary,
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {color}
      </span>
    </span>
  )
}
