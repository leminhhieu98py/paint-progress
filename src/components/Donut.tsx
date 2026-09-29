import { Tooltip } from 'antd'
import { useId, useState, type CSSProperties, type ReactNode } from 'react'
import { palette } from '../theme'
import { ringSegments, sectorPath } from './donutGeometry'

export interface DonutSlice {
  /**
   * What `activeKey` and `onActiveChange` call this slice: the id of the row
   * the screen's legend prints for it. The label when absent.
   */
  key?: string
  label: string
  /** Fraction of the WHOLE circle, not of the other slices. Sizes the arc. */
  value: number
  /**
   * What the legend prints instead of `value`, when the two differ (RV6-02):
   * a deck's arc is its weight × progress (its contribution to the whole),
   * but its legend figure is meant to read the same as the rollup table's
   * own `Tiến độ` column, i.e. the deck's progress alone. Optional so a
   * caller with nothing to distinguish just prints `value`, as before.
   */
  display?: number
  /**
   * The legend's figures for this slice, exactly as the legend prints them
   * (CHT-02). The tooltip shows them under the label, and they are the
   * slice's accessible description, so the ring never states a number the
   * legend beside it does not.
   */
  detail?: string
  color: string
}

/** How far a hovered or focused slice's outer edge moves out, in px (CHT-02: ≤ 4). */
const LIFT = 3
/** The other slices while one is active (CHT-02). */
const DIM = 0.35

/**
 * A ring with something written in the middle of it.
 *
 * SVG sectors rather than a charting library: this is a ring with no axes and
 * no animation the reader needs, and recharts would be a second rendering
 * model on the same screen as the Konva drawing. One path per slice, so each
 * slice answers the pointer and the keyboard (CHT-02): hovering or focusing
 * it lifts it, dims the others, reports its key through `onActiveChange` and
 * opens a tooltip with the legend's figures for it.
 *
 * `activeKey` is controlled, because the legend lives in the screen: the
 * screen keeps the key, highlights its own row for it, and sets it from that
 * row's hover and focus in turn. A slice made active from its legend row
 * opens no tooltip -- the row the reader is pointing at prints the same
 * figures already.
 */
export function Donut({
  slices,
  label,
  activeKey = null,
  onActiveChange,
  size = 150,
  thickness = 27,
  remainderColor = palette.track,
  children,
  style,
}: {
  slices: DonutSlice[]
  /** The ring's accessible name. */
  label: string
  activeKey?: string | null
  onActiveChange?: (key: string | null) => void
  size?: number
  thickness?: number
  remainderColor?: string
  children?: ReactNode
  style?: CSSProperties
}) {
  const id = useId()
  /** The slice the pointer or focus is on, which alone opens a tooltip. */
  const [tipKey, setTipKey] = useState<string | null>(null)
  const { segments, remainderFrom } = ringSegments(slices)
  const c = size / 2
  const rInner = c - thickness
  const keyOf = (s: DonutSlice) => s.key ?? s.label
  const enter = (key: string) => {
    setTipKey(key)
    onActiveChange?.(key)
  }
  const leave = () => {
    setTipKey(null)
    onActiveChange?.(null)
  }

  return (
    <div style={{ position: 'relative', width: size, height: size, flex: 'none', ...style }}>
      <svg
        data-testid="donut-ring"
        role="group"
        aria-label={label}
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        style={{ position: 'absolute', inset: 0, overflow: 'visible' }}
      >
        {/* White under everything: the gaps between slices, and what a dimmed slice fades towards. */}
        <path d={sectorPath(c, c, c, rInner, 0, 1)} fill="#ffffff" fillRule="evenodd" pointerEvents="none" />
        {remainderFrom < 1 && (
          <path
            d={sectorPath(c, c, c, rInner, remainderFrom, 1)}
            fill={remainderColor}
            fillRule="evenodd"
            pointerEvents="none"
          />
        )}
        {segments.map((seg) => {
          const s = slices[seg.index]
          const key = keyOf(s)
          const active = activeKey === key
          // The group between the tooltip and the path is there because
          // rc-tooltip writes its own aria-describedby onto its child, and the
          // path's has to stay the legend's figures.
          return (
            <Tooltip
              key={key}
              open={tipKey === key}
              title={(
                <>
                  <div>{s.label}</div>
                  {s.detail && <div>{s.detail}</div>}
                </>
              )}
            >
              <g>
                <path
                  data-testid="donut-slice"
                  data-arc={String(seg.arc)}
                  role="img"
                  aria-label={s.label}
                  aria-describedby={s.detail ? `${id}-${seg.index}` : undefined}
                  tabIndex={0}
                  d={sectorPath(c, c, active ? c + LIFT : c, rInner, seg.from, seg.solidTo)}
                  fill={s.color}
                  opacity={activeKey !== null && !active ? DIM : 1}
                  style={{ outline: 'none', cursor: 'default', transition: 'opacity 120ms' }}
                  onPointerEnter={() => enter(key)}
                  onPointerLeave={leave}
                  onFocus={() => enter(key)}
                  onBlur={leave}
                />
              </g>
            </Tooltip>
          )
        })}
        {/* The hairline edge the ring has always had. */}
        <circle cx={c} cy={c} r={c - 0.5} fill="none" stroke="#16202B14" strokeWidth={1} pointerEvents="none" />
      </svg>
      <div hidden>
        {segments.map((seg) => slices[seg.index].detail && (
          <span key={seg.index} id={`${id}-${seg.index}`}>{slices[seg.index].detail}</span>
        ))}
      </div>
      <div
        style={{
          position: 'absolute',
          inset: thickness,
          borderRadius: '50%',
          background: palette.bgContainer,
          boxShadow: '0 2px 9px -4px #16202B2E',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
          padding: '0 8px',
        }}
      >
        {children}
      </div>
    </div>
  )
}
