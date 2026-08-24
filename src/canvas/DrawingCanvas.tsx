import { Button, Space } from 'antd'
import Konva from 'konva'
import { useEffect, useRef, useState } from 'react'
import { Image as KonvaImage, Layer, Line, Rect, Stage, Text } from 'react-konva'
import useImage from 'use-image'
import type { Guide, MeshCell } from '../domain/types'
import {
  clampStagePan, clampZoom, cropFromDrag, GUIDE_HIT_WIDTH, guideHitProfile,
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
 * The crop box's stroke — antd cyan-7, chosen the same way SELECTION_STROKE was:
 * it is outside the stage palette (yellow #fadb14, grey #bfbfbf, green #52c41a,
 * blue #1677ff, purple #722ed1), away from the guides' own blue, and away from
 * the cell grid's red border and the magenta selection cue. The crop is drawn
 * over a sheet that may already carry all of those at once.
 */
const CROP_STROKE = '#08979c'

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
  planLabels,
  panZoom = false,
  cropRect,
  onGuideMove,
  onGuideAdd,
  onCellClick,
  onCropDraw,
  onGuideClick,
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
   * Planned date range per cell CODE. A code present here gets a dashed outline
   * and its label drawn over the cell; a code absent gets nothing. Spec §8.1's
   * "Show plan" toggle.
   */
  planLabels?: Record<string, string>
  /**
   * Pan by dragging, zoom by the buttons or the wheel. Off by default: the
   * admin editor drags guides, and it has never had (or wanted) a viewport of
   * its own. Spec §8.1 requires it for the GS screen, where the drawing is
   * bigger than the tablet.
   */
  panZoom?: boolean
  /**
   * The deck's own rectangle on the sheet, normalized 0..1, drawn so the admin
   * can see what the detector will be looking at. Rendered whenever it is set,
   * in crop mode or out of it.
   */
  cropRect?: { x: number; y: number; w: number; h: number } | null
  onGuideMove?: (index: number, pos: number) => void
  onGuideAdd?: (axis: 'x' | 'y', pos: number) => void
  onCellClick?: (code: string, additive: boolean) => void
  /**
   * Present = crop mode: one drag on the drawing reports the region it
   * enclosed. Its presence, not a separate flag, is what puts the canvas in
   * crop mode — so there is no way to be in the mode with nothing listening,
   * or to have a listener that the mode ignores.
   *
   * While it is set, guides do not drag and cells do not select: on a detected
   * deck a guide sits under the pointer almost everywhere, and grabbing one
   * instead of drawing the box moves an mm-chain axis, which silently rewrites
   * every cell area on the deck.
   */
  onCropDraw?: (rect: { x: number; y: number; w: number; h: number }) => void
  /**
   * Present = clicking a guide reports its index, so the screen above can
   * delete it. Guides stop dragging while it is set: a click that moved a pixel
   * would drag instead of delete, and a dragged guide rewrites the mm chain on
   * its axis.
   *
   * This exists because no single sensitivity is right everywhere on a real
   * deck -- secondary steel clears the bar a real beam needs, and the admin
   * reported that no slider position satisfied the whole sheet. Being generous
   * with the slider and clicking off the few wrong lines is the only way to
   * reach the exact grid.
   */
  onGuideClick?: (index: number) => void
}) {
  const [image] = useImage(imageUrl)
  const containerRef = useRef<HTMLDivElement>(null)
  const [measuredWidth, setMeasuredWidth] = useState(0)
  const stageRef = useRef<Konva.Stage>(null)
  const [zoom, setZoom] = useState(MIN_ZOOM)
  /** The crop gesture in progress, in stage px. `null` between gestures. */
  const [cropDrag, setCropDrag] = useState<{ from: Konva.Vector2d; to: Konva.Vector2d } | null>(null)

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

  const cropping = Boolean(onCropDraw)
  const width = measuredWidth > 0 ? measuredWidth : FALLBACK_STAGE_WIDTH
  const scale = width / imageW
  const height = imageH * scale
  const selected = new Set(selectedCodes)
  const xGuides = guides.filter((g) => g.axis === 'x')
  const yGuides = guides.filter((g) => g.axis === 'y')

  /**
   * How far along its own axis a guide is drawn: from the first to the last
   * guide of the OTHER axis -- the deck's own extent, which is where the beams
   * are.
   *
   * Not the crop. The crop is a box the admin dragged with a margin round the
   * deck, and a line ruled out to it reads as a claim about the margin, the
   * title block and whatever else the box caught. It is also exactly what the
   * mesh covers: `buildMeshFromGuides` only ever makes cells BETWEEN guides, so
   * clipping here draws the grid the cells actually form and nothing more.
   *
   * Falls back to the whole drawing while an axis has fewer than two guides,
   * since there is no extent to speak of yet -- that is the state a fresh deck
   * starts in, and a guide has to be visible for the admin to drag it.
   */
  const guideSpan = (axis: 'x' | 'y') => {
    const across = axis === 'x' ? yGuides : xGuides
    const extent = axis === 'x' ? height : width
    if (across.length < 2) return { from: 0, to: extent }
    const positions = across.map((g) => g.pos)
    return { from: Math.min(...positions) * extent, to: Math.max(...positions) * extent }
  }

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

  /**
   * The crop rubber-band. `getPointerPosition` is stage-relative in screen px
   * and does not divide out the stage's scale, which is right here: crop mode
   * is admin-only and the admin editor never zooms (`panZoom` is off there, so
   * `zoom` stays at MIN_ZOOM = 1). A zoomable crop would have to read
   * `getRelativePointerPosition` instead.
   */
  const cropHandlers = cropping
    ? {
        onMouseDown: (e: Konva.KonvaEventObject<MouseEvent>) => {
          const point = e.target.getStage()?.getPointerPosition()
          if (point) setCropDrag({ from: point, to: point })
        },
        onMouseMove: (e: Konva.KonvaEventObject<MouseEvent>) => {
          const point = e.target.getStage()?.getPointerPosition()
          // Only while a gesture is live: without the guard every idle mouse
          // move over the drawing would re-render the whole stage.
          if (point) setCropDrag((drag) => (drag ? { ...drag, to: point } : null))
        },
        onMouseUp: (e: Konva.KonvaEventObject<MouseEvent>) => {
          const point = e.target.getStage()?.getPointerPosition() ?? cropDrag?.to
          setCropDrag(null)
          if (!cropDrag || !point) return
          // A misfire (a click, or a drag too small to be a deck) reports
          // nothing rather than committing a region that would make every
          // fraction pass -- see cropFromDrag.
          const rect = cropFromDrag(cropDrag.from, point, width, height)
          if (rect) onCropDraw?.(rect)
        },
      }
    : {}
  const cropBand = cropDrag ? cropFromDrag(cropDrag.from, cropDrag.to, width, height) : null

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
        draggable={panZoom && !cropping}
        dragBoundFunc={(pos) => clampStagePan(pos, width, height, zoom)}
        {...cropHandlers}
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

        <Layer name="cells" listening={!cropping}>
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
              onClick={(e: Konva.KonvaEventObject<MouseEvent>) => {
                if (cropping) return
                onCellClick?.(cell.code, e.evt.shiftKey || e.evt.metaKey || e.evt.ctrlKey)
              }}
              onTap={() => {
                if (cropping) return
                onCellClick?.(cell.code, false)
              }}
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

        <Layer name="plan" listening={false}>
          {cells
            .filter((cell) => planLabels?.[cell.code] !== undefined)
            .map((cell) => (
              <Rect
                key={`plan-${cell.code}`}
                name={`plan-${cell.code}`}
                x={cell.x * width}
                y={cell.y * height}
                width={cell.w * width}
                height={cell.h * height}
                stroke="#000000"
                strokeWidth={2}
                dash={[6, 4]}
              />
            ))}
          {cells
            .filter((cell) => planLabels?.[cell.code] !== undefined)
            .map((cell) => (
              <Text
                key={`plan-label-${cell.code}`}
                name={`plan-label-${cell.code}`}
                x={cell.x * width}
                y={cell.y * height + cell.h * height / 2 - 6}
                width={cell.w * width}
                align="center"
                text={planLabels?.[cell.code] ?? ''}
                fontSize={12}
                fill="#000000"
              />
            ))}
        </Layer>

        <Layer name="guides" listening={!cropping}>
          {guides.map((guide, index) => (
            <Line
              key={`${guide.axis}-${index}`}
              name={`guide-${guide.axis}-${index}`}
              points={
                guide.axis === 'x'
                  ? [guide.pos * width, guideSpan('x').from, guide.pos * width, guideSpan('x').to]
                  : [guideSpan('y').from, guide.pos * height, guideSpan('y').to, guide.pos * height]
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
                // Measured from the drawn line's own start, not from the stage's
                // edge: a clipped guide's grab band has to sit on the part of
                // the line that exists.
                const span = guideSpan(guide.axis)
                const perpendicular =
                  guide.axis === 'x' ? guide.pos * width : guide.pos * height
                const crossings = (guide.axis === 'x' ? yGuides : xGuides)
                  .map((g) => (guide.axis === 'x' ? g.pos * height : g.pos * width) - span.from)
                const profile = guideHitProfile(span.to - span.from, crossings, GUIDE_HIT_WIDTH / 2)
                if (profile.length < 2) return

                // One polygon: down the +offset side of the profile, back up the
                // -offset side. Where the profile pinches to zero the two sides
                // meet at a point, joining two lobes that a nonzero-winding fill
                // paints as two regions — which is exactly the intended shape.
                const lineTo = (at: number, offset: number) => {
                  if (guide.axis === 'x') ctx.lineTo(perpendicular + offset, span.from + at)
                  else ctx.lineTo(span.from + at, perpendicular + offset)
                }
                ctx.beginPath()
                if (guide.axis === 'x') {
                  ctx.moveTo(perpendicular + profile[0][1], span.from + profile[0][0])
                } else {
                  ctx.moveTo(span.from + profile[0][0], perpendicular + profile[0][1])
                }
                for (const [at, halfWidth] of profile.slice(1)) lineTo(at, halfWidth)
                for (const [at, halfWidth] of [...profile].reverse()) lineTo(at, -halfWidth)
                ctx.closePath()
                ctx.fillStrokeShape(shape)
              }}
              draggable={Boolean(onGuideMove) && !cropping && !onGuideClick}
              onClick={() => onGuideClick?.(index)}
              onTap={() => onGuideClick?.(index)}
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

        {/*
          Above every other layer and out of the hit graph: it is a cue, not a
          target, and the gesture that draws it is handled on the stage itself.
        */}
        <Layer name="crop" listening={false}>
          {cropRect && (
            <Rect
              name="crop-region"
              x={cropRect.x * width}
              y={cropRect.y * height}
              width={cropRect.w * width}
              height={cropRect.h * height}
              stroke={CROP_STROKE}
              strokeWidth={2}
              dash={[10, 6]}
            />
          )}
          {cropBand && (
            <Rect
              name="crop-band"
              x={cropBand.x * width}
              y={cropBand.y * height}
              width={cropBand.w * width}
              height={cropBand.h * height}
              stroke={CROP_STROKE}
              strokeWidth={2}
              dash={[4, 4]}
            />
          )}
        </Layer>
      </Stage>
    </div>
  )
}
