import { Button, Space } from 'antd'
import Konva from 'konva'
import { useEffect, useRef, useState } from 'react'
import { Image as KonvaImage, Layer, Rect, Stage, Text } from 'react-konva'
import useImage from 'use-image'
import type { MeshCell } from '../domain/types'
import {
  clampStagePan, clampZoom, cropFromDrag,
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
 * blue #1677ff, purple #722ed1), away from the cell grid's red border and the
 * magenta selection cue. The crop is drawn over a sheet that may already carry
 * all of those at once.
 */
const CROP_STROKE = '#08979c'

/**
 * The shortest side a drawn bay's drag may describe, as a fraction of the
 * drawing. Well under a bay, so the floor only ever rejects a click or a
 * twitch; whether the result is a usable bay is `drawnCell`'s to say.
 */
const MIN_DRAWN_FRACTION = 0.004

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
  cells,
  selectedCodes,
  cellColors,
  planLabels,
  panZoom = false,
  cropRect,
  onCellClick,
  onCropDraw,
  onCellDraw,
  onSelectDraw,
}: {
  imageUrl: string
  imageW: number
  imageH: number
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
   * admin editor has never had (or wanted) a viewport of its own. Spec §8.1
   * requires it for the GS screen, where the drawing is bigger than the
   * tablet.
   */
  panZoom?: boolean
  /**
   * The deck's own rectangle on the sheet, normalized 0..1, drawn so the admin
   * can see what the detector will be looking at. Rendered whenever it is set,
   * in crop mode or out of it.
   */
  cropRect?: { x: number; y: number; w: number; h: number } | null
  onCellClick?: (code: string, additive: boolean) => void
  /**
   * Present = crop mode: one drag on the drawing reports the region it
   * enclosed. Its presence, not a separate flag, is what puts the canvas in
   * crop mode — so there is no way to be in the mode with nothing listening,
   * or to have a listener that the mode ignores.
   *
   * While it is set, cells do not select: the box is drawn over the same
   * pixels the cells occupy, so a drag that started on a cell would select it
   * instead of drawing the region.
   */
  onCropDraw?: (rect: { x: number; y: number; w: number; h: number }) => void
  /**
   * Present = draw-a-bay mode: the same drag, reported as one bay rather than
   * as the region to detect in. Mutually exclusive with `onCropDraw` -- the
   * screen above offers one mode or the other, never both -- and it uses a much
   * smaller floor, because a bay is a fraction of the size of a deck.
   */
  onCellDraw?: (rect: { x: number; y: number; w: number; h: number }) => void
  /**
   * Present = a drag started with Shift held reports the band it swept, so the
   * screen above can select what is under it.
   *
   * Not a mode, unlike the two above: it is armed by the modifier, gesture by
   * gesture, so it costs the admin nothing when they are not using it and takes
   * nothing away from whichever mode they are in.
   */
  onSelectDraw?: (rect: { x: number; y: number; w: number; h: number }) => void
}) {
  const [image] = useImage(imageUrl)
  const containerRef = useRef<HTMLDivElement>(null)
  const [measuredWidth, setMeasuredWidth] = useState(0)
  const stageRef = useRef<Konva.Stage>(null)
  const [zoom, setZoom] = useState(MIN_ZOOM)
  /**
   * The crop gesture in progress, in stage px. `null` between gestures.
   *
   * Held in a ref, with state only mirroring it so the rubber band can render.
   * The handlers below must not read the gesture out of state: a mousedown and
   * mouseup that land in the same React commit -- a fast flick, or any automated
   * drag -- leave the mouseup's closure looking at the state from before the
   * mousedown, so the gesture is silently dropped. Found by driving the real
   * app, where an automated drag lost its crop about half the time.
   */
  const cropDragRef = useRef<{ from: Konva.Vector2d; to: Konva.Vector2d } | null>(null)
  /** Which of the three gestures the live drag is, fixed at its mousedown. */
  const gestureRef = useRef<'crop' | 'cell' | 'select' | null>(null)
  const [cropDrag, setCropDrag] = useState<
    { from: Konva.Vector2d; to: Konva.Vector2d; kind: 'crop' | 'cell' | 'select' } | null
  >(null)

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

  const drawingCell = Boolean(onCellDraw)
  // One gesture, three meanings. The two modes take the drawing out of
  // selection; a Shift-band does not, because it IS selection.
  const cropping = Boolean(onCropDraw) || drawingCell
  const banding = cropping || Boolean(onSelectDraw)
  const width = measuredWidth > 0 ? measuredWidth : FALLBACK_STAGE_WIDTH
  const scale = width / imageW
  const height = imageH * scale
  const selected = new Set(selectedCodes)
  /**
   * Zoom is React state, pan is Konva's own.
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
  const cropHandlers = banding
    ? {
        onMouseDown: (e: Konva.KonvaEventObject<MouseEvent>) => {
          const point = e.target.getStage()?.getPointerPosition()
          if (!point) return
          // Which gesture this is, decided once at the start and carried to the
          // end. Reading the modifier again at mouseup would let a key released
          // mid-drag change what the drag meant.
          const kind = e.evt.shiftKey && onSelectDraw ? 'select' : drawingCell ? 'cell' : 'crop'
          if (kind !== 'select' && !cropping) return
          gestureRef.current = kind
          cropDragRef.current = { from: point, to: point }
          // The kind travels with the state mirror as well as with the ref: the
          // band renders from state, and a ref read during render is a value
          // React has no way to re-render for.
          setCropDrag({ ...cropDragRef.current, kind })
        },
        onMouseMove: (e: Konva.KonvaEventObject<MouseEvent>) => {
          const point = e.target.getStage()?.getPointerPosition()
          // Only while a gesture is live: without the guard every idle mouse
          // move over the drawing would re-render the whole stage.
          if (!point || !cropDragRef.current) return
          cropDragRef.current = { ...cropDragRef.current, to: point }
          setCropDrag((live) => (live ? { ...live, to: point } : live))
        },
        onMouseUp: (e: Konva.KonvaEventObject<MouseEvent>) => {
          const drag = cropDragRef.current
          const point = e.target.getStage()?.getPointerPosition() ?? drag?.to
          cropDragRef.current = null
          setCropDrag(null)
          if (!drag || !point) return
          // A misfire (a click, or a drag too small to be a deck) reports
          // nothing rather than committing a region that would make every
          // fraction pass -- see cropFromDrag.
          const kind = gestureRef.current
          gestureRef.current = null
          const rect = cropFromDrag(
            drag.from, point, width, height,
            kind === 'crop' ? undefined : MIN_DRAWN_FRACTION,
          )
          if (!rect) return
          if (kind === 'select') onSelectDraw?.(rect)
          else if (kind === 'cell') onCellDraw?.(rect)
          else if (kind === 'crop') onCropDraw?.(rect)
        },
      }
    : {}
  const cropBand = cropDrag
    ? cropFromDrag(
      cropDrag.from, cropDrag.to, width, height,
      cropDrag.kind === 'crop' ? undefined : MIN_DRAWN_FRACTION,
    )
    : null

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
                // Shift is the rubber band's modifier now; Ctrl/Cmd is the one
                // that adds a bay to a selection one at a time.
                onCellClick?.(cell.code, e.evt.metaKey || e.evt.ctrlKey)
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
