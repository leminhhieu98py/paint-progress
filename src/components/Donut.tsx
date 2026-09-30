import { Tooltip } from 'antd'
import { useId, useState, type CSSProperties, type ReactNode } from 'react'
import { palette } from '../theme'
import { ringSegments, sectorPath } from './donutGeometry'
import { cancelTapElsewhere, clearOnTapElsewhere } from './ringHover'

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
   * (CHT-02). The tooltip shows them under the label, a line each when there
   * are several, and they are the slice's accessible description, so the
   * ring never states a number the legend beside it does not.
   */
  detail?: string | readonly string[]
  color: string
}

/** How far a hovered or focused slice's outer edge moves out, in px (CHT-02: ≤ 4). */
const LIFT = 3
/** The other slices while one is active (CHT-02). */
const DIM = 0.35

const linesOf = (detail: DonutSlice['detail']): readonly string[] =>
  detail === undefined ? [] : typeof detail === 'string' ? [detail] : detail

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
  const { segments: laidOut, remainderFrom } = ringSegments(slices)
  // A slice no wider than its gap has no colour to show: no path, so no tab
  // stop and no tooltip on nothing (m-2). Its legend row still answers.
  const segments = laidOut.filter((seg) => seg.solidTo > seg.from)
  const c = size / 2
  const rInner = c - thickness
  const keyOf = (s: DonutSlice) => s.key ?? s.label
  const enter = (key: string) => {
    setTipKey(key)
    onActiveChange?.(key)
  }
  // A key with no slice on the ring -- a 0% row, a sliver -- dims nothing:
  // there is nothing to point the reader at (m-7).
  const dimming = activeKey !== null && segments.some((seg) => keyOf(slices[seg.index]) === activeKey)
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
        {remainderFrom < 1 && (
          <path
            data-testid="donut-remainder"
            d={sectorPath(c, c, c, rInner, remainderFrom, 1)}
            fill={remainderColor}
            fillRule="evenodd"
            pointerEvents="none"
          />
        )}
        {/*
          The slices and the gaps between them are one hover area (m-11):
          crossing a gap keeps the slice active, so the tooltip and the dim do
          not flicker off and on between neighbours. Leaving the area -- off
          the ring, into the centre, onto the remainder track -- lets go. A
          finger's leave is ignored; a tap toggles instead (m-3).
        */}
        <g
          data-testid="donut-slices"
          onPointerLeave={(e) => {
            if (e.pointerType !== 'touch' && tipKey !== null) leave()
          }}
        >
          {remainderFrom > 0 && (
            // White under the slices: the gaps, the hover area across them, and
            // what a dimmed slice fades towards.
            <path
              data-testid="donut-hit"
              d={sectorPath(c, c, c, rInner, 0, remainderFrom)}
              fill="#ffffff"
              fillRule="evenodd"
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
                    {linesOf(s.detail).map((line) => <div key={line}>{line}</div>)}
                  </>
                )}
              >
                <g>
                  <path
                    data-testid="donut-slice"
                    data-arc={String(seg.arc)}
                    role="img"
                    aria-label={s.label}
                    aria-describedby={linesOf(s.detail).length > 0 ? `${id}-${seg.index}` : undefined}
                    tabIndex={0}
                    d={sectorPath(c, c, active ? c + LIFT : c, rInner, seg.from, seg.solidTo)}
                    fill={s.color}
                    opacity={dimming && !active ? DIM : 1}
                    style={{ outline: 'none', cursor: 'default', transition: 'opacity 120ms' }}
                    onPointerEnter={(e) => {
                      if (e.pointerType !== 'touch') enter(key)
                    }}
                    onPointerUp={(e) => {
                      if (e.pointerType !== 'touch') return
                      if (tipKey === key) {
                        leave()
                        cancelTapElsewhere(e.currentTarget)
                      } else {
                        enter(key)
                        clearOnTapElsewhere(e.currentTarget, leave)
                      }
                    }}
                    onFocus={() => enter(key)}
                    onBlur={leave}
                  />
                </g>
              </Tooltip>
            )
          })}
        </g>
        {/* The hairline edge the ring has always had. */}
        <circle cx={c} cy={c} r={c - 0.5} fill="none" stroke="#16202B14" strokeWidth={1} pointerEvents="none" />
      </svg>
      <div hidden>
        {segments.map((seg) => linesOf(slices[seg.index].detail).length > 0 && (
          <span key={seg.index} id={`${id}-${seg.index}`}>{linesOf(slices[seg.index].detail).join(' ')}</span>
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
