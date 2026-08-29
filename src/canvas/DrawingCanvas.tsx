import { ExpandOutlined, MinusOutlined, PlusOutlined } from '@ant-design/icons'
import { Button, Space } from 'antd'
import Konva from 'konva'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Image as KonvaImage, Layer, Line, Rect, Stage, Text } from 'react-konva'
import useImage from 'use-image'
import type { MeshCell } from '../domain/types'
import {
  clampStagePan, clampZoom, boxFromDrag, fitLabelFontSize,
  MIN_LABEL_FONT_SIZE, MIN_ZOOM, WHEEL_ZOOM_STEP, ZOOM_STEP,
} from './canvasView'
import { createHatchPattern } from './hatchPattern'

const PLAIN_FILL = '#0000000A'
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
 * The cue is the app's accent teal at 14% over a solid accent stroke. Selection
 * only ever happens in the geometry editor, where cells carry no stage colour
 * at all, so it has nothing to compete with; a saturated out-of-palette colour
 * was louder than the job needs. The stroke is what identifies the selection —
 * the fill only groups a run of cells so a band reads as one shape.
 */
const SELECTION_OVERLAY_FILL = '#0A817524'
const SELECTION_STROKE = '#0A8175'

/**
 * The crop box's stroke — antd cyan-7. It is outside the stage palette (yellow
 * #fadb14, grey #bfbfbf, green #52c41a, blue #1677ff, purple #722ed1), away
 * from the cell grid's red border, and cool enough against the accent-teal
 * selection to stay distinct from it. The crop is drawn over a sheet that may
 * already carry all of those at once.
 */
const CROP_STROKE = '#08979c'

/**
 * The shortest side a drawn bay's drag may describe, as a fraction of the
 * drawing. Well under a bay, so the floor only ever rejects a click or a
 * twitch; whether the result is a usable bay is `drawnCell`'s to say.
 */
const MIN_DRAWN_FRACTION = 0.004

/**
 * The corner flag on a bay that carries a note.
 *
 * antd's orange-6, and the only place it appears on a drawing. The five stage
 * colours, the zone palette, the red bay border and the magenta selection cue
 * all sit elsewhere in the wheel, so a flag cannot be mistaken for a coat.
 */
const NOTE_MARKER_FILL = '#F97316'

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
  hatchedCodes,
  markedCodes,
  planLabels,
  panZoom = false,
  zoom: zoomProp,
  onZoomChange,
  showZoomControls = true,
  onCellClick,
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
   * Cell codes drawn with a diagonal hatch over their fill.
   *
   * The second channel for "not done yet". Once bays are coloured by ZONE
   * rather than by coat, done and not-done are the same fill and the drawing
   * stops answering the question it exists for. Solid means the bay has
   * reached the coat being looked at; hatched means it has not.
   *
   * Kept separate from `cellColors` rather than encoded into it, because the
   * two are independent: any colour can be hatched or not, and a lens that
   * merged them would need a colour per (zone × state) pair.
   */
  hatchedCodes?: string[]
  /**
   * Cell codes that get a small corner flag.
   *
   * One meaning only, and it is "there is something written here": a bay whose
   * foreman left a note. Deliberately not a second colour channel -- the fill
   * is already carrying the coat or the zone, and the hatch is carrying done
   * versus not -- so this is a shape, in the one colour nothing else on the
   * drawing uses.
   */
  markedCodes?: string[]
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
   * The zoom, when the screen above owns it.
   *
   * Uncontrolled by default, which is what every single-canvas screen wants.
   * The split view in A3.4 is the case that needs it: two canvases free to sit
   * at different scales are not a comparison of one coat against another.
   */
  zoom?: number
  /** Fired with the clamped value whenever a gesture or a button changes it. */
  onZoomChange?: (zoom: number) => void
  /**
   * The floating -- / % / + / fit group over the top-right of the canvas.
   *
   * Turned off by a parent that renders the same controls itself, which is what
   * a shared zoom across two canvases has to do: one control, not one per
   * canvas each claiming to be the zoom.
   */
  showZoomControls?: boolean
  /**
   * Present = draw-a-bay mode: the same drag, reported as one bay rather than
   * as the region to detect in. Mutually exclusive with `onCropDraw` -- the
   * screen above offers one mode or the other, never both -- and it uses a much
   * smaller floor, because a bay is a fraction of the size of a deck.
   */
  onCellClick?: (code: string, additive: boolean) => void
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
  const [ownZoom, setOwnZoom] = useState(MIN_ZOOM)
  const zoom = zoomProp ?? ownZoom
  /**
   * Whether Shift is down right now, so the stage can stop advertising a pan it
   * will refuse. Window-level and cleared on blur: a Shift held while the window
   * loses focus never sends its keyup, and the canvas would be stuck refusing to
   * pan until the next press.
   */
  const [shiftHeld, setShiftHeld] = useState(false)
  useEffect(() => {
    if (!panZoom || !onSelectDraw) return
    const down = (e: KeyboardEvent) => { if (e.key === 'Shift') setShiftHeld(true) }
    const up = (e: KeyboardEvent) => { if (e.key === 'Shift') setShiftHeld(false) }
    const clear = () => setShiftHeld(false)
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', clear)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', clear)
    }
  }, [panZoom, onSelectDraw])
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
  const dragRef = useRef<{ from: Konva.Vector2d; to: Konva.Vector2d } | null>(null)
  /** Which of the three gestures the live drag is, fixed at its mousedown. */
  const gestureRef = useRef<'cell' | 'select' | null>(null)
  /**
   * Set for as long as the click that follows a finished drag takes to arrive.
   *
   * The browser fires `click` after every `mouseup`, and Konva hands it to the
   * shape under the pointer. Without this, a Shift-band that ended over a bay
   * was immediately overwritten by that bay being clicked -- the band selected
   * a block and the trailing click collapsed it to one. Measured on the real
   * app: mousedown, mousemove x3, mouseup, click.
   */
  /*
    Built once per mount, not per bay: this is one 8x8 tile shared by every
    hatched Rect on the drawing, and a deck has up to a couple of hundred.
  */
  const hatchPattern = useMemo(() => createHatchPattern(), [])
  const hatched = useMemo(() => new Set(hatchedCodes ?? []), [hatchedCodes])
  const marked = useMemo(() => new Set(markedCodes ?? []), [markedCodes])

  const swallowClickRef = useRef(false)
  const [drag, setDrag] = useState<
    { from: Konva.Vector2d; to: Konva.Vector2d; kind: 'cell' | 'select' } | null
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
  // One gesture, two meanings. Drawing a bay takes the drawing out of
  // selection; a Shift-band does not, because it IS selection.
  const banding = drawingCell || Boolean(onSelectDraw)
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
    // Written locally whether or not a parent owns the value: a controlled
    // parent that ignores the callback would otherwise leave the canvas frozen
    // with no sign why, and when it does honour it the two agree anyway.
    setOwnZoom(clamped)
    onZoomChange?.(clamped)
    const stage = stageRef.current
    if (stage) {
      stage.position(clampStagePan({ x: stage.x(), y: stage.y() }, width, height, clamped))
    }
  }

  /**
   * The rubber-band, read in the STAGE's own coordinates.
   *
   * `getPointerPosition` reports screen px relative to the stage element and
   * divides out neither the zoom nor the pan. That was fine while the only
   * banding canvas was the deck editor, which never zooms -- and it broke the
   * moment the progress panel put a band on a pan-and-zoom canvas: the admin
   * recorded a selection landing a hand's width up and left of the cursor,
   * because the band is drawn in stage coordinates while the pointer was being
   * read in screen ones.
   *
   * `getRelativePointerPosition` applies the stage's inverse transform, so the
   * two agree again at any zoom and any pan. The comment this replaces predicted
   * exactly this failure; it is here now.
   */
  const pointerIn = (e: Konva.KonvaEventObject<MouseEvent>) =>
    e.target.getStage()?.getRelativePointerPosition() ?? null

  /** The font a bay's plan label can carry, or null when it can carry none. */
  const planFont = (cell: MeshCell) => fitLabelFontSize(
    planLabels?.[cell.code] ?? '',
    cell.w * width,
    cell.h * height,
  )

  const dragHandlers = banding
    ? {
        onMouseDown: (e: Konva.KonvaEventObject<MouseEvent>) => {
          const point = pointerIn(e)
          if (!point) return
          // Which gesture this is, decided once at the start and carried to the
          // end. Reading the modifier again at mouseup would let a key released
          // mid-drag change what the drag meant.
          const kind = e.evt.shiftKey && onSelectDraw ? 'select' : drawingCell ? 'cell' : null
          if (!kind) return
          gestureRef.current = kind
          dragRef.current = { from: point, to: point }
          // The kind travels with the state mirror as well as with the ref: the
          // band renders from state, and a ref read during render is a value
          // React has no way to re-render for.
          setDrag({ ...dragRef.current, kind })
        },
        onMouseMove: (e: Konva.KonvaEventObject<MouseEvent>) => {
          const point = pointerIn(e)
          // Only while a gesture is live: without the guard every idle mouse
          // move over the drawing would re-render the whole stage.
          if (!point || !dragRef.current) return
          dragRef.current = { ...dragRef.current, to: point }
          setDrag((live) => (live ? { ...live, to: point } : live))
        },
        onMouseUp: (e: Konva.KonvaEventObject<MouseEvent>) => {
          const drag = dragRef.current
          const point = pointerIn(e) ?? drag?.to
          dragRef.current = null
          setDrag(null)
          if (!drag || !point) return
          // A misfire (a click, or a drag too small to be a deck) reports
          // nothing rather than committing a region that would make every
          // fraction pass -- see boxFromDrag.
          const kind = gestureRef.current
          gestureRef.current = null
          const rect = boxFromDrag(drag.from, point, width, height, MIN_DRAWN_FRACTION)
          if (!rect) return
          // Before the callback, so a re-render triggered by it cannot land
          // between the flag and the click it is there to swallow.
          swallowClickRef.current = true
          setTimeout(() => { swallowClickRef.current = false }, 0)
          if (kind === 'select') onSelectDraw?.(rect)
          else onCellDraw?.(rect)
        },
      }
    : {}
  /**
   * The pointer this mode asks for. Crop and band both sweep a rectangle;
   * drawing a bay adds one, which is what the OS's own "copy" pointer means
   * everywhere else.
   */
  const cursor = drawingCell ? 'copy' : ''

  /**
   * Makes the browser look at the pointer again after the mode changed.
   *
   * Chrome decides which pointer to draw from its last hit-test, and it only
   * runs another one when the mouse moves. The modes here are switched with a
   * key -- I turns drawing bays on and off -- and a key does not move the
   * mouse, so the old pointer stayed on screen over a canvas that had already
   * changed mode. Reported after the first fix: the + would not go away.
   *
   * Turning pointer-events off and on changes what is under the pointer, which
   * is a thing Chrome does re-hit-test for. The read in between is what stops
   * the two writes being coalesced into no change at all. It runs on a mode
   * change only, never during a gesture.
   */
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    el.style.pointerEvents = 'none'
    void el.offsetWidth
    el.style.pointerEvents = ''
  }, [cursor])

  const dragBand = drag
    ? boxFromDrag(drag.from, drag.to, width, height, MIN_DRAWN_FRACTION)
    : null

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        position: 'relative',
        cursor: cursor || undefined,
      }}
    >
      {panZoom && showZoomControls && (
        /*
          A compact floating group, as the prototypes have it, rather than three
          full-width text buttons sitting over the drawing they are meant to
          serve. The buttons carry no `size`: they inherit controlHeight from
          whichever theme is above them, which is 38px on the admin's laptop and
          48px on the foreman's tablet -- the one component, sized correctly for
          both surfaces without knowing which it is on.

          The labels move to aria-label. They are still the accessible names, so
          nothing that reaches these by name -- a screen reader or a test -- can
          tell the difference.
        */
        <Space
          size={4}
          style={{
            position: 'absolute',
            top: 12,
            right: 12,
            zIndex: 1,
            background: '#FFFFFFF0',
            border: '1px solid #F0F4F8',
            borderRadius: 12,
            padding: 5,
          }}
        >
          <Button aria-label="Thu nhỏ" icon={<MinusOutlined />} onClick={() => applyZoom(zoom - ZOOM_STEP)} />
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              minWidth: 52,
              fontSize: 12,
              fontWeight: 600,
              color: '#4A5A6B',
            }}
          >
            {`${Math.round(zoom * 100)}%`}
          </span>
          <Button aria-label="Phóng to" icon={<PlusOutlined />} onClick={() => applyZoom(zoom + ZOOM_STEP)} />
          <Button aria-label="Vừa khung" icon={<ExpandOutlined />} onClick={() => applyZoom(MIN_ZOOM)} />
        </Space>
      )}
      <Stage
        name="drawing"
        width={width}
        height={height}
        ref={stageRef}
        scaleX={zoom}
        scaleY={zoom}
        // Shift belongs to the band, never to the pan. Without this the stage's
        // own drag starts first and swallows the gesture, so band-select was
        // simply dead on any canvas with panZoom on -- which is why it worked in
        // the deck editor (panZoom off) and not on the progress screen.
        //
        // `shiftHeld` is what makes it VISIBLE: draggable=false stops the cursor
        // promising a pan the canvas is not going to perform. The onDragStart
        // stop below is what makes it CORRECT -- it reads the modifier off the
        // gesture itself, so a Shift pressed after the listener missed it (the
        // window lost focus mid-key, say) still cannot pan.
        draggable={panZoom && !drawingCell && !(shiftHeld && Boolean(onSelectDraw))}
        onDragStart={(e: Konva.KonvaEventObject<DragEvent>) => {
          if (onSelectDraw && (e.evt as unknown as MouseEvent)?.shiftKey) {
            e.target.stopDrag()
          }
        }}
        dragBoundFunc={(pos) => clampStagePan(pos, width, height, zoom)}
        {...dragHandlers}
        /*
          One event, two gestures, told apart by ctrlKey.

          Every browser reports a trackpad PINCH as a wheel event with
          ctrlKey set -- the user is not holding Ctrl, the OS synthesises it --
          and that is also what Ctrl/Cmd + wheel produces on a mouse. So one
          branch serves the pinch and the mouse user's fast zoom alike.

          A plain wheel is a SCROLL: two fingers on a trackpad, or the wheel on
          a mouse. It used to zoom, which meant an admin trying to look further
          down a drawing rescaled it instead, on every gesture. deltaX is
          honoured too, so a sideways two-finger swipe pans sideways.

          The pan is written straight onto the Konva node rather than through
          state: the position already lives there (the stage is `draggable`),
          and mirroring it into React would re-render the whole mesh on every
          wheel tick.
        */
        onWheel={(e: Konva.KonvaEventObject<WheelEvent>) => {
          if (!panZoom) return
          e.evt.preventDefault()
          if (e.evt.ctrlKey || e.evt.metaKey) {
            applyZoom(zoom + (e.evt.deltaY < 0 ? WHEEL_ZOOM_STEP : -WHEEL_ZOOM_STEP))
            return
          }
          const stage = stageRef.current
          if (!stage) return
          stage.position(
            clampStagePan(
              { x: stage.x() - e.evt.deltaX, y: stage.y() - e.evt.deltaY },
              width,
              height,
              zoom,
            ),
          )
        }}
      >
        <Layer name="drawing-image">
          <KonvaImage name="deck-drawing" image={image} width={width} height={height} />
        </Layer>

        <Layer name="cells" listening={!drawingCell}>
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
              stroke="#FF000099"
              strokeWidth={1}
              onClick={(e: Konva.KonvaEventObject<MouseEvent>) => {
                if (drawingCell || swallowClickRef.current) return
                // Shift belongs to the band, so a click carrying it is the tail
                // of one, not a selection. Two guards rather than one: the flag
                // catches a band whose Shift was let go before the mouse, and
                // this catches a Shift-click the flag never saw.
                if (e.evt.shiftKey) return
                // Ctrl/Cmd is what adds a bay to a selection one at a time.
                onCellClick?.(cell.code, e.evt.metaKey || e.evt.ctrlKey)
              }}
              onTap={() => {
                if (drawingCell) return
                onCellClick?.(cell.code, false)
              }}
            />
          ))}
        </Layer>

        {/*
          Hatching is its own layer above the fills and below the selection
          overlay. On the cells layer it would have to be a sibling Rect per
          bay, which doubles that layer's hit graph for something nobody can
          click; `listening={false}` here keeps every tap landing on the bay
          underneath.
        */}
        <Layer name="hatch" listening={false}>
          {hatchPattern !== null &&
            cells
              .filter((cell) => hatched.has(cell.code))
              .map((cell) => (
                <Rect
                  key={cell.code}
                  name={`hatch-${cell.code}`}
                  x={cell.x * width}
                  y={cell.y * height}
                  width={cell.w * width}
                  height={cell.h * height}
                  /*
                    Konva types this as HTMLImageElement, but at runtime it goes
                    straight to ctx.createPattern, which takes any
                    CanvasImageSource -- a canvas among them. Generating a real
                    <img> from toDataURL instead would make the pattern load
                    asynchronously, and Konva does not redraw on image load, so
                    the first paint of every deck would come up unhatched.
                  */
                  fillPatternImage={hatchPattern as unknown as HTMLImageElement}
                  fillPatternRepeat="repeat"
                />
              ))}
        </Layer>

        {/* Its own layer, above the hatch and below the selection overlay, and
            non-listening so the flag never swallows the tap that opens it. */}
        <Layer name="markers" listening={false}>
          {cells
            .filter((cell) => marked.has(cell.code))
            .map((cell) => {
              const right = (cell.x + cell.w) * width
              const top = cell.y * height
              // Sized against the bay, not fixed: a 7px flag is invisible on a
              // large bay and covers a small one.
              const size = Math.max(5, Math.min(10, cell.w * width * 0.28))
              return (
                <Line
                  key={cell.code}
                  name={`note-${cell.code}`}
                  points={[right - size, top, right, top, right, top + size]}
                  closed
                  fill={NOTE_MARKER_FILL}
                />
              )
            })}
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
                y={cell.y * height + cell.h * height / 2 - (planFont(cell) ?? 0) / 2}
                width={cell.w * width}
                align="center"
                // Sized to the bay. Fixed at 12 before, which is why a date
                // range spilled across three neighbouring bays on a dense deck.
                // A bay too small to carry its label legibly gets none: the
                // zone list beside the drawing still names it, and an
                // unreadable overlap costs the plan underneath for nothing.
                text={planFont(cell) === null ? '' : planLabels?.[cell.code] ?? ''}
                fontSize={planFont(cell) ?? MIN_LABEL_FONT_SIZE}
                fill="#000000"
              />
            ))}
        </Layer>


        {/*
          Above every other layer and out of the hit graph: it is a cue, not a
          target, and the gesture that draws it is handled on the stage itself.
        */}
        <Layer name="drag-band-layer" listening={false}>
          {dragBand && (
            <Rect
              name="drag-band"
              x={dragBand.x * width}
              y={dragBand.y * height}
              width={dragBand.w * width}
              height={dragBand.h * height}
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
