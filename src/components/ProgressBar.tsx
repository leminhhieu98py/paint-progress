import { formatPercent } from '../lib/format'
import { palette } from '../theme'

/**
 * A ratio as a track, a fill and its own number.
 *
 * The label is not decoration and is on by default: the whole product exists
 * to report percentages that money is paid against, and a bar alone is read to
 * about five percent. The bar is the comparison between rows; the number is
 * the value.
 *
 * The width is rounded to four decimals rather than emitted raw. Floating
 * point makes `0.4438 * 100` into 44.379999999999995, and every bar on a
 * project rollup would carry a seventeen-character width string that is
 * sub-pixel identical to the short one.
 *
 * `ratio` is clamped rather than trusted. Stage weights are admin-editable and
 * a deck whose weights sum above 1 produces a progress above 1 -- unclamped
 * that fill escapes its track and pushes the table column out, which looks
 * like a layout bug rather than the data problem it is. The label is left
 * UNCLAMPED on purpose, so a wrong number still reads as wrong.
 */
export function ProgressBar({
  ratio,
  color = palette.accent,
  height = 6,
  showLabel = true,
}: {
  ratio: number
  color?: string
  height?: number
  showLabel?: boolean
}) {
  const clamped = Math.min(1, Math.max(0, ratio))
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
      <div
        style={{
          flex: 1,
          minWidth: 24,
          height,
          borderRadius: 999,
          background: palette.track,
          overflow: 'hidden',
        }}
      >
        <div
          data-testid="progress-fill"
          style={{
            width: `${(clamped * 100).toFixed(4)}%`,
            height: '100%',
            borderRadius: 999,
            background: color,
            transition: 'width .55s cubic-bezier(.2,.8,.25,1)',
          }}
        />
      </div>
      {showLabel && (
        <span
          style={{ fontSize: 13, fontWeight: 600, minWidth: 58, textAlign: 'right', flex: 'none' }}
        >
          {formatPercent(ratio)}
        </span>
      )}
    </div>
  )
}
