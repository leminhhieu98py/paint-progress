import { Button, Space } from 'antd'
import Konva from 'konva'
import { useEffect, useRef, useState } from 'react'
import { Image as KonvaImage, Layer, Line, Rect, Stage } from 'react-konva'
import useImage from 'use-image'
import type { Guide, MeshCell } from '../domain/types'
import {
  clampStagePan, clampZoom, GUIDE_HIT_WIDTH, guideHitProfile,
  MIN_ZOOM, WHEEL_ZOOM_STEP, ZOOM_STEP,
} from './canvasView'

const PLAIN_FILL = 'rgba(0, 0, 0, 0.04)'
/**
 * Cells are filled at this opacity so the beams and grid labels underneath stay
 * readable — the drawing is what the operator recognises, not our overlay.
 */
const STAGE_FILL_OPACITY = 0.45
/**
 * Selection is drawn as a translucent overlay on its own layer above every
 * cell, not by swapping the cell's own fill: Phase 4 groups cells into zones
 * partly on how far along each one is, so hiding a cell's stage colour on
 * selection would remove the information that grouping decision is made
 * from. A stroke alone was rejected too — every cell already carries an
 * always-on red border, so a selection stroke would compete with the grid's
 * own boundary on a dense mesh; a large-area fill cue reads faster.
 *
 * Magenta (antd's magenta-6) is picked because it sits outside the stage
 * palette entirely — yellow #fadb14, grey #bfbfbf, green #52c41a, blue
 * #1677ff, purple #722ed1 (src/domain/stageTemplate.ts) — and is far enough
 * from the cell grid's own red border (rgba(255, 0, 0, 0.6) below) to read
 * as a distinct, unmistakable "selected" cue against any stage colour or none.
 */
const SELECTION_OVERLAY_FILL = 'rgba(235, 47, 150, 0.28)'
const SELECTION_STROKE = '#eb2f96'

/**
 * Width used until the container has been measured.
 *
 * The stage used to be a hard 900 px, which overflowed a 636 px container in the
 * browser instead of scaling — tolerable for an admin on a laptop, wrong for the
 * GS on a tablet, which is what Phase 3 builds. The width now follows the
 * container; this is what it renders at before the first measurement, and in
 * jsdom, which reports clientWidth 0 for everything and implements no
 * ResizeObserver.
 */
export const FALLBACK_STAGE_WIDTH = 900

export function DrawingCanvas({
  imageUrl,
  imageW,
  imageH,
  guides,
  cells,
  selectedCodes,
  cellColors,
  panZoom = false,
  onGuideMove,
  onGuideAdd,
  onCellClick,
}: {
  imageUrl: string
  imageW: number
  imageH: number
  guides: Omit<Guide, 'id'>[]
  cells: MeshCell[]
  selectedCodes: string[]
  /** Colour per cell code; a code absent from the map renders unfilled. */
  cellColors?: Record<string, string>
  /**
   * Pan by dragging, zoom by the buttons or the wheel. Off by default: the
   * admin editor drags guides, and it has never had (or wanted) a viewport of
   * its own. Spec §8.1 requires it for the GS screen, where the drawing is
   * bigger than the tablet.
   */
  panZoom?: boolean
  onGuideMove?: (index: number, pos: number) => void
  onGuideAdd?: (axis: 'x' | 'y', pos: number) => void
  onCellClick?: (code: string, additive: boolean) => void
}) {
  const [image] = useImage(imageUrl)
  const containerRef = useRef<HTMLDivElement>(null)
  const [measuredWidth, setMeasuredWidth] = useState(0)
  const stageRef = useRef<Konva.Stage>(null)
  const [zoom, setZoom] = useState(MIN_ZOOM)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const apply = () => setMeasuredWidth(el.clientWidth)
    apply()
    // Guarded rather than polyfilled: jsdom implements no ResizeObserver, and
    // the fallback width keeps the component renderable without one. The
    // observer exists for a tablet rotation, which no unit test can produce.
    if (typeof ResizeObserver !== 'function') return
    const observer = new ResizeObserver(apply)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const width = measuredWidth > 0 ? measuredWidth : FALLBACK_STAGE_WIDTH
  const scale = width / imageW
  const height = imageH * scale
  const selected = new Set(selectedCodes)
  const xGuides = guides.filter((g) => g.axis === 'x')
  const yGuides = guides.filter((g) => g.axis === 'y')

  /**
   * Zoom is React state, pan is Konva's own. dragBoundFunc is bound per node, so
   * the stage's clamp never sees a guide's drag — which is why there is no
   * `onDragEnd` on the stage to tell the two apart (Konva events bubble; a
   * guide's dragend would arrive there and be mistaken for a pan).
   *
   * Changing the zoom can leave an existing pan outside the new bounds, and
   * Konva does not re-run dragBoundFunc on a scale change, so the position is
   * re-clamped here by hand. stageRef is null under the mocked react-konva, so
   * this branch has no unit coverage — it is in the browser checklist.
   */
  const applyZoom = (next: number) => {
    const clamped = clampZoom(next)
    setZoom(clamped)
    const stage = stageRef.current
    if (stage) {
      stage.position(clampStagePan({ x: stage.x(), y: stage.y() }, width, height, clamped))
    }
  }

  return (
    <div ref={containerRef} style={{ width: '100%', position: 'relative' }}>
      {panZoom && (
        <Space size={4} style={{ position: 'absolute', top: 8, right: 8, zIndex: 1 }}>
          <Button size="large" onClick={() => applyZoom(zoom + ZOOM_STEP)}>
            Phóng to
          </Button>
          <Button size="large" onClick={() => applyZoom(zoom - ZOOM_STEP)}>
            Thu nhỏ
          </Button>
          <Button size="large" onClick={() => applyZoom(MIN_ZOOM)}>
            Vừa khung
          </Button>
        </Space>
      )}
      <Stage
        name="drawing"
        width={width}
        height={height}
        ref={stageRef}
        scaleX={zoom}
        scaleY={zoom}
        draggable={panZoom}
        dragBoundFunc={(pos) => clampStagePan(pos, width, height, zoom)}
        onWheel={(e: Konva.KonvaEventObject<WheelEvent>) => {
          if (!panZoom) return
          e.evt.preventDefault()
          applyZoom(zoom + (e.evt.deltaY < 0 ? WHEEL_ZOOM_STEP : -WHEEL_ZOOM_STEP))
        }}
        onDblClick={(e: Konva.KonvaEventObject<MouseEvent>) => {
          if (!onGuideAdd) return
          const point = e.target.getStage()?.getPointerPosition()
          if (!point) return
          // Double-click near an edge adds a guide on the axis you are closest to,
          // which is how the admin starts a fresh mesh. On an exact tie (equally
          // close to a vertical and a horizontal edge — the stage centre, or a
          // perfect square drawing's midline crossing) the vertical guide wins:
          // deck plans are read column-first (bay letters run along the top),
          // so the first guide an admin adds is expected to be a vertical split.
          const nearVertical = Math.min(point.x, width - point.x)
          const nearHorizontal = Math.min(point.y, height - point.y)
          if (nearVertical <= nearHorizontal) onGuideAdd('x', point.x / width)
          else onGuideAdd('y', point.y / height)
        }}
      >
        <Layer name="drawing-image">
          <KonvaImage name="deck-drawing" image={image} width={width} height={height} />
        </Layer>

        <Layer name="cells">
          {cells.map((cell) => (
            <Rect
              key={cell.code}
              name={`cell-${cell.code}`}
              x={cell.x * width}
              y={cell.y * height}
              width={cell.w * width}
              height={cell.h * height}
              fill={cellColors?.[cell.code] ?? PLAIN_FILL}
              opacity={cellColors?.[cell.code] ? STAGE_FILL_OPACITY : 1}
              stroke="rgba(255, 0, 0, 0.6)"
              strokeWidth={1}
              onClick={(e: Konva.KonvaEventObject<MouseEvent>) =>
                onCellClick?.(cell.code, e.evt.shiftKey || e.evt.metaKey || e.evt.ctrlKey)
              }
              onTap={() => onCellClick?.(cell.code, false)}
            />
          ))}
        </Layer>

        <Layer name="selection" listening={false}>
          {cells
            .filter((cell) => selected.has(cell.code))
            .map((cell) => (
              <Rect
                key={cell.code}
                name={`selection-${cell.code}`}
                x={cell.x * width}
                y={cell.y * height}
                width={cell.w * width}
                height={cell.h * height}
                fill={SELECTION_OVERLAY_FILL}
                stroke={SELECTION_STROKE}
                strokeWidth={3}
              />
            ))}
        </Layer>

        <Layer name="guides">
          {guides.map((guide, index) => (
            <Line
              key={`${guide.axis}-${index}`}
              name={`guide-${guide.axis}-${index}`}
              points={
                guide.axis === 'x'
                  ? [guide.pos * width, 0, guide.pos * width, height]
                  : [0, guide.pos * height, width, guide.pos * height]
              }
              stroke="#1677ff"
              strokeWidth={2}
              /**
               * A 14 px grab band that tapers to nothing at every crossing, so a
               * pointer near an intersection belongs to whichever guide's line is
               * nearer — see guideHitProfile for why that is the rule.
               *
               * hitStrokeWidth is deliberately NOT set alongside this. Konva's
               * drawHit uses `hitFunc() || sceneFunc()` (konva/lib/Shape.js), so
               * with a hitFunc present a hitStrokeWidth is dead configuration
               * that reads like the thing doing the work.
               */
              hitFunc={(ctx: Konva.Context, shape: Konva.Shape) => {
                const along = guide.axis === 'x' ? height : width
                const perpendicular =
                  guide.axis === 'x' ? guide.pos * width : guide.pos * height
                const crossings = (guide.axis === 'x' ? yGuides : xGuides).map((g) =>
                  guide.axis === 'x' ? g.pos * height : g.pos * width,
                )
                const profile = guideHitProfile(along, crossings, GUIDE_HIT_WIDTH / 2)
                if (profile.length < 2) return

                // One polygon: down the +offset side of the profile, back up the
                // -offset side. Where the profile pinches to zero the two sides
                // meet at a point, joining two lobes that a nonzero-winding fill
                // paints as two regions — which is exactly the intended shape.
                const lineTo = (at: number, offset: number) => {
                  if (guide.axis === 'x') ctx.lineTo(perpendicular + offset, at)
                  else ctx.lineTo(at, perpendicular + offset)
                }
                ctx.beginPath()
                if (guide.axis === 'x') {
                  ctx.moveTo(perpendicular + profile[0][1], profile[0][0])
                } else {
                  ctx.moveTo(profile[0][0], perpendicular + profile[0][1])
                }
                for (const [at, halfWidth] of profile.slice(1)) lineTo(at, halfWidth)
                for (const [at, halfWidth] of [...profile].reverse()) lineTo(at, -halfWidth)
                ctx.closePath()
                ctx.fillStrokeShape(shape)
              }}
              draggable={Boolean(onGuideMove)}
              dragBoundFunc={(p) => (guide.axis === 'x' ? { x: p.x, y: 0 } : { x: 0, y: p.y })}
              onDragEnd={(e: Konva.KonvaEventObject<DragEvent>) => {
                if (!onGuideMove) return
                const node = e.target
                const next =
                  guide.axis === 'x'
                    ? (guide.pos * width + node.x()) / width
                    : (guide.pos * height + node.y()) / height
                node.position({ x: 0, y: 0 })
                onGuideMove(index, Math.min(1, Math.max(0, next)))
              }}
            />
          ))}
        </Layer>
      </Stage>
    </div>
  )
}
