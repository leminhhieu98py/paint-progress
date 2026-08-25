import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DrawingCanvas } from './DrawingCanvas'

// Simulates the one piece of Konva node state that the drag-clamp reset
// exists to guard: a dragged node's `.x()`/`.y()` report its position
// relative to where it was last explicitly set via `.position()` — Konva
// never reverts this on its own once a drag ends. `dragOffsets` tracks that
// leftover per node by name, so a second drag's `clientX`/`clientY` (the
// pointer's movement *during that gesture*) lands on top of whatever the
// previous drag left behind, exactly as real Konva would report it, unless
// the component calls `.position({ x: 0, y: 0 })` to clear it — which is
// what `positionSpy` lets the tests assert on directly, and what resetting
// `dragOffsets` models. This is a deliberately narrow, hand-built state
// model of one specific Konva behavior, not a claim of general Konva
// fidelity — see the task report for what it does and does not establish.
const { positionSpy, dragOffsets } = vi.hoisted(() => ({
  positionSpy: vi.fn(),
  dragOffsets: new Map<string, { x: number; y: number }>(),
}))

// `react-konva` renders to a canvas, which jsdom does not implement, so every
// Konva node is replaced by a plain `div` carrying its props as data
// attributes. `onClick` and `onDblClick` are wired to fire with the same
// event shape the real `Konva.KonvaEventObject` exposes — `{ evt }` holding
// the native mouse event for clicks, `{ target: { getStage() } }` for the
// stage's double-click — which is the only part of each event the component
// reads. Without the `{ evt }` wrapping the component's own `e.evt.shiftKey`
// read throws against a bare DOM event; see the RED run in the task report.
// A guide's drag end is wired to `onMouseUp` rather than the real `onDragEnd`:
// this jsdom version has no `DragEvent` constructor at all (confirmed via a
// standalone jsdom probe), so `fireEvent.dragEnd`'s `clientX`/`clientY` are
// silently dropped and the handler reads NaN. `mouseup` is not what Konva
// actually fires — Konva's own drag system runs on canvas pointer tracking,
// not HTML5 drag-and-drop, so nothing here is standing in for a jsdom gap
// Konva itself has — it is only the delivery vehicle this test uses to invoke
// the component's onDragEnd callback with test-controlled coordinates.
vi.mock('react-konva', () => {
  // The one shape of Konva event the component's pointer handlers read: a
  // target that can reach the stage's current pointer position. The crop
  // rubber-band and the guide-adding double-click both go through this.
  const konvaPointer = (domEvt: { clientX: number; clientY: number }) => ({
    target: {
      getStage: () => ({
        getPointerPosition: () => ({ x: domEvt.clientX, y: domEvt.clientY }),
      }),
    },
    // Konva always hands the native event through as `evt`, and the component
    // reads the modifier keys off it to tell one gesture from another. A
    // stand-in without it does not just lose the modifiers -- the handler
    // throws on the first one it reads, and the gesture never starts.
    evt: domEvt,
  })
  const node = (name: string) => (props: Record<string, unknown>) => (
    <div
      data-testid={`${name}:${String(props.name ?? '')}`}
      data-x={String(props.x ?? '')}
      data-y={String(props.y ?? '')}
      data-fill={String(props.fill ?? '')}
      data-opacity={String(props.opacity ?? '')}
      // width/height/hitFunc are read by the container-sizing and guide-grab-area
      // tests. jsdom has no canvas, so a hitFunc can only be observed as
      // "present"; what it actually paints is asserted on guideHitProfile in
      // canvasView.test.ts, which is where the geometry lives.
      data-width={String(props.width ?? '')}
      data-height={String(props.height ?? '')}
      data-hashitfunc={String(typeof props.hitFunc === 'function')}
      data-scalex={String(props.scaleX ?? '')}
      data-draggable={String(props.draggable ?? '')}
      data-text={String(props.text ?? '')}
      data-dash={String(props.dash ?? '')}
      // A guide's drawn extent -- the crop-clipping tests read the endpoints.
      data-points={Array.isArray(props.points) ? props.points.join(',') : ''}
      // `listening` cannot be observed behaviourally here: with react-konva
      // mocked away there is no hit graph, so a layer that swallows pointer
      // events looks identical to one that does not. Exposing the prop lets a
      // test at least discriminate the regression -- see the non-listening
      // layers test below for why that particular regression matters.
      data-listening={String(props.listening ?? '')}
      // Probes the stage's own drag clamp with a position far outside any
      // sane viewport, at the CURRENT width/height/zoom the component computed
      // -- not a hardcoded stand-in for them. This is what lets the pan tests
      // below assert the real clamped boundary numbers instead of only "a
      // dragBoundFunc was passed", which would still pass if it clamped to the
      // wrong bounds or used stale zoom.
      data-dragboundx={String(
        typeof props.dragBoundFunc === 'function'
          ? (props.dragBoundFunc as (p: { x: number; y: number }) => { x: number; y: number })({
              x: -5000,
              y: -5000,
            }).x
          : '',
      )}
      data-dragboundy={String(
        typeof props.dragBoundFunc === 'function'
          ? (props.dragBoundFunc as (p: { x: number; y: number }) => { x: number; y: number })({
              x: -5000,
              y: -5000,
            }).y
          : '',
      )}
      onClick={(domEvt: React.MouseEvent) =>
        (props.onClick as ((e: unknown) => void) | undefined)?.({ evt: domEvt })
      }
      onDoubleClick={(domEvt: React.MouseEvent) =>
        (props.onDblClick as ((e: unknown) => void) | undefined)?.(konvaPointer(domEvt))
      }
      onMouseDown={(domEvt: React.MouseEvent) =>
        (props.onMouseDown as ((e: unknown) => void) | undefined)?.(konvaPointer(domEvt))
      }
      onMouseMove={(domEvt: React.MouseEvent) =>
        (props.onMouseMove as ((e: unknown) => void) | undefined)?.(konvaPointer(domEvt))
      }
      onWheel={(domEvt: React.WheelEvent) =>
        (props.onWheel as ((e: unknown) => void) | undefined)?.({ evt: domEvt })
      }
      onMouseUp={(domEvt: React.MouseEvent) => {
        const nodeName = String(props.name ?? '')
        const leftover = dragOffsets.get(nodeName) ?? { x: 0, y: 0 }
        const x = leftover.x + domEvt.clientX
        const y = leftover.y + domEvt.clientY
        dragOffsets.set(nodeName, { x, y })
        ;(props.onDragEnd as ((e: unknown) => void) | undefined)?.({
          target: {
            x: () => x,
            y: () => y,
            position: (p: { x: number; y: number }) => {
              dragOffsets.set(nodeName, p)
              positionSpy(p)
            },
          },
        })
        // Distinct from onDragEnd above: the stage carries no onDragEnd, and a
        // guide carries no onMouseUp, so each node runs exactly one of the two
        // -- the crop gesture ends here, a guide drag ends above.
        ;(props.onMouseUp as ((e: unknown) => void) | undefined)?.(konvaPointer(domEvt))
      }}
    >
      {props.children as never}
    </div>
  )
  return {
    Stage: node('stage'), Layer: node('layer'), Rect: node('rect'),
    Line: node('line'), Image: node('image'), Text: node('text'),
  }
})

vi.mock('use-image', () => ({ default: () => [undefined, 'loaded'] }))

const guides = [
  { axis: 'x' as const, pos: 0, offsetMm: 0 },
  { axis: 'x' as const, pos: 0.5, offsetMm: 10000 },
  { axis: 'x' as const, pos: 1, offsetMm: 20000 },
  { axis: 'y' as const, pos: 0, offsetMm: 0 },
  { axis: 'y' as const, pos: 1, offsetMm: 16000 },
]

const cells = [
  { code: 'R1C1', x: 0, y: 0, w: 0.5, h: 1, areaM2: 160 },
  { code: 'R1C2', x: 0.5, y: 0, w: 0.5, h: 1, areaM2: 160 },
]

beforeEach(() => {
  positionSpy.mockClear()
  dragOffsets.clear()
})

describe('DrawingCanvas', () => {

  it('renders one rect per cell', () => {
    render(
      <DrawingCanvas imageUrl="u" imageW={2000} imageH={1600} cells={cells} selectedCodes={[]} />,
    )
    expect(screen.getByTestId('rect:cell-R1C1')).toBeInTheDocument()
    expect(screen.getByTestId('rect:cell-R1C2')).toBeInTheDocument()
  })

  it('fills a cell with its assigned colour', () => {
    render(
      <DrawingCanvas
        imageUrl="u" imageW={2000} imageH={1600} cells={cells}
        selectedCodes={[]} cellColors={{ R1C1: '#52c41a' }}
      />,
    )
    expect(screen.getByTestId('rect:cell-R1C1')).toHaveAttribute('data-fill', '#52c41a')
  })

  it('renders a coloured cell at partial opacity so the drawing stays visible underneath', () => {
    render(
      <DrawingCanvas
        imageUrl="u" imageW={2000} imageH={1600} cells={cells}
        selectedCodes={[]} cellColors={{ R1C1: '#52c41a' }}
      />,
    )
    // Cells are filled at partial opacity, not solid — the beams and grid
    // labels underneath must stay readable through the overlay.
    expect(screen.getByTestId('rect:cell-R1C1')).toHaveAttribute('data-opacity', '0.45')
  })

  it('renders an unfilled cell at full opacity', () => {
    render(
      <DrawingCanvas imageUrl="u" imageW={2000} imageH={1600} cells={cells} selectedCodes={[]} />,
    )
    expect(screen.getByTestId('rect:cell-R1C1')).toHaveAttribute('data-opacity', '1')
  })

  it('keeps a selected cell\'s own stage colour and adds a selection overlay', () => {
    render(
      <DrawingCanvas
        imageUrl="u" imageW={2000} imageH={1600} cells={cells} selectedCodes={['R1C1']}
        cellColors={{ R1C1: '#52c41a' }}
      />,
    )
    // Selection is an overlay, not a fill swap: the cell keeps its own stage
    // colour so the information Phase 4's zone grouping depends on survives
    // selection.
    expect(screen.getByTestId('rect:cell-R1C1')).toHaveAttribute('data-fill', '#52c41a')
    // A selected cell gains a dedicated overlay node; an unselected one does not.
    expect(screen.getByTestId('rect:selection-R1C1')).toBeInTheDocument()
    expect(screen.queryByTestId('rect:selection-R1C2')).not.toBeInTheDocument()
  })

  it('reports a cell click with its code', async () => {
    const onCellClick = vi.fn()
    render(
      <DrawingCanvas
        imageUrl="u" imageW={2000} imageH={1600} cells={cells}
        selectedCodes={[]} onCellClick={onCellClick}
      />,
    )
    await userEvent.click(screen.getByTestId('rect:cell-R1C2'))
    expect(onCellClick).toHaveBeenCalledWith('R1C2', false)
  })

  it.each([
    ['metaKey', { metaKey: true }],
    ['ctrlKey', { ctrlKey: true }],
  ] as const)('reports additive=true when %s is held', (_name, modifier) => {
    const onCellClick = vi.fn()
    render(
      <DrawingCanvas
        imageUrl="u" imageW={2000} imageH={1600} cells={cells}
        selectedCodes={[]} onCellClick={onCellClick}
      />,
    )
    fireEvent.click(screen.getByTestId('rect:cell-R1C2'), modifier)
    expect(onCellClick).toHaveBeenCalledWith('R1C2', true)
  })

  it('lets a Shift-click alone: it is the tail of a band, not a selection', () => {
    // The browser fires a click after every drag, and Konva hands it to the
    // shape under the pointer. A Shift-band that ended over a bay was being
    // overwritten by that bay -- the band selected a block and the click
    // collapsed it to one, which read as "Shift-drag does not work".
    const onCellClick = vi.fn()
    render(
      <DrawingCanvas
        imageUrl="u" imageW={2000} imageH={1600} cells={cells}
        selectedCodes={[]} onCellClick={onCellClick}
      />,
    )
    fireEvent.click(screen.getByTestId('rect:cell-R1C2'), { shiftKey: true })
    expect(onCellClick).not.toHaveBeenCalled()
  })

  it('scales normalized coordinates to the rendered width', () => {
    render(
      <DrawingCanvas
        imageUrl="u" imageW={2000} imageH={1600} cells={cells}
        selectedCodes={[]}
      />,
    )
    // R1C2 sits at x = 0.5 of the fallback width: jsdom reports clientWidth 0, so the component falls back to FALLBACK_STAGE_WIDTH (900).
    expect(screen.getByTestId('rect:cell-R1C2')).toHaveAttribute('data-x', '450')
  })

  it('scales normalized coordinates to the rendered height', () => {
    // Height is derived (imageH * (width / imageW)), not passed directly, so
    // this exercises a different line than the width test above — it would
    // not fail if only the x-axis scaling broke.
    const cellsWithVerticalOffset = [{ code: 'R2C1', x: 0, y: 0.5, w: 1, h: 0.5, areaM2: 320 }]
    render(
      <DrawingCanvas
        imageUrl="u" imageW={2000} imageH={1600} cells={cellsWithVerticalOffset}
        selectedCodes={[]}
      />,
    )
    // height = imageH * (width / imageW) = 1600 * (900 / 2000) = 720 at the 900px fallback width; y = 0.5 * 720 = 360.
    expect(screen.getByTestId('rect:cell-R2C1')).toHaveAttribute('data-y', '360')
  })



  describe('container sizing', () => {
    // jsdom reports clientWidth 0 for every element and implements no
    // ResizeObserver, so both have to be installed per test. Both are restored
    // by the afterEach below -- leaving a global clientWidth of 640 behind would
    // silently retune every other test in this file.
    let restoreClientWidth: (() => void) | null = null

    const stubClientWidth = (px: number) => {
      const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')
      Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
        configurable: true,
        get: () => px,
      })
      restoreClientWidth = () => {
        if (original) Object.defineProperty(HTMLElement.prototype, 'clientWidth', original)
        else delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth
      }
    }

    afterEach(() => {
      restoreClientWidth?.()
      restoreClientWidth = null
      delete (globalThis as unknown as Record<string, unknown>).ResizeObserver
    })

    it('sizes the stage to its container instead of a fixed width', () => {
      // The defect: a 900px stage inside a 636px container, overflowing rather
      // than scaling. 640 is not 900, so this fails against the unfixed
      // component -- which is the whole point of stubbing a width at all.
      stubClientWidth(640)
      render(
        <DrawingCanvas
          imageUrl="u" imageW={2000} imageH={1600} cells={cells}
          selectedCodes={[]}
        />,
      )
      expect(screen.getByTestId('stage:drawing')).toHaveAttribute('data-width', '640')
    })

    it('derives the height from the container width and the image aspect ratio', () => {
      stubClientWidth(640)
      render(
        <DrawingCanvas
          imageUrl="u" imageW={2000} imageH={1600} cells={cells}
          selectedCodes={[]}
        />,
      )
      // 1600 * (640 / 2000) = 512. Catches a height that keeps scaling off the
      // old constant while only the width follows the container.
      expect(screen.getByTestId('stage:drawing')).toHaveAttribute('data-height', '512')
    })

    it('re-measures when the container is resized', () => {
      // A tablet rotation is the case this exists for. The double enforces the
      // one constraint that matters: the callback fires only when something
      // triggers it, and only for an element that was actually observed -- a
      // stub that called back immediately and unconditionally would let a
      // measure-once implementation pass.
      const observed: Element[] = []
      let trigger: (() => void) | null = null
      class FakeResizeObserver {
        constructor(callback: () => void) { trigger = callback }
        observe(el: Element) { observed.push(el) }
        disconnect() { trigger = null }
      }
      ;(globalThis as unknown as Record<string, unknown>).ResizeObserver = FakeResizeObserver

      stubClientWidth(640)
      render(
        <DrawingCanvas
          imageUrl="u" imageW={2000} imageH={1600} cells={cells}
          selectedCodes={[]}
        />,
      )
      expect(screen.getByTestId('stage:drawing')).toHaveAttribute('data-width', '640')
      expect(observed).toHaveLength(1)

      restoreClientWidth?.()
      restoreClientWidth = null
      stubClientWidth(320)
      act(() => { trigger?.() })

      expect(screen.getByTestId('stage:drawing')).toHaveAttribute('data-width', '320')
    })

    it('falls back to a usable width when the container measures zero', () => {
      // Every other test in this file relies on this fallback, so it is pinned
      // rather than left implicit.
      render(
        <DrawingCanvas
          imageUrl="u" imageW={2000} imageH={1600} cells={cells}
          selectedCodes={[]}
        />,
      )
      expect(screen.getByTestId('stage:drawing')).toHaveAttribute('data-width', '900')
    })
  })


  describe('pan and zoom', () => {
    it('is off unless asked for, so the admin editor is unchanged', () => {
      render(
        <DrawingCanvas
          imageUrl="u" imageW={2000} imageH={1600} cells={cells}
          selectedCodes={[]}
        />,
      )
      expect(screen.getByTestId('stage:drawing')).toHaveAttribute('data-draggable', 'false')
      expect(screen.queryByRole('button', { name: 'Phóng to' })).not.toBeInTheDocument()
    })

    it('makes the stage draggable and offers zoom controls when enabled', () => {
      render(
        <DrawingCanvas
          imageUrl="u" imageW={2000} imageH={1600} cells={cells}
          selectedCodes={[]} panZoom
        />,
      )
      expect(screen.getByTestId('stage:drawing')).toHaveAttribute('data-draggable', 'true')
      expect(screen.getByRole('button', { name: 'Phóng to' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Thu nhỏ' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Vừa khung' })).toBeInTheDocument()
    })

    it('zooms in by one step per press and caps at the maximum', async () => {
      render(
        <DrawingCanvas
          imageUrl="u" imageW={2000} imageH={1600} cells={cells}
          selectedCodes={[]} panZoom
        />,
      )
      expect(screen.getByTestId('stage:drawing')).toHaveAttribute('data-scalex', '1')

      await userEvent.click(screen.getByRole('button', { name: 'Phóng to' }))
      expect(screen.getByTestId('stage:drawing')).toHaveAttribute('data-scalex', '1.5')

      // Seven more presses would reach 5 unclamped; MAX_ZOOM is 4.
      for (let i = 0; i < 7; i += 1) {
        await userEvent.click(screen.getByRole('button', { name: 'Phóng to' }))
      }
      expect(screen.getByTestId('stage:drawing')).toHaveAttribute('data-scalex', '4')
    })

    it('will not zoom out below fit-to-container', async () => {
      render(
        <DrawingCanvas
          imageUrl="u" imageW={2000} imageH={1600} cells={cells}
          selectedCodes={[]} panZoom
        />,
      )
      await userEvent.click(screen.getByRole('button', { name: 'Thu nhỏ' }))
      expect(screen.getByTestId('stage:drawing')).toHaveAttribute('data-scalex', '1')
    })

    it('returns to fit-to-container', async () => {
      render(
        <DrawingCanvas
          imageUrl="u" imageW={2000} imageH={1600} cells={cells}
          selectedCodes={[]} panZoom
        />,
      )
      await userEvent.click(screen.getByRole('button', { name: 'Phóng to' }))
      await userEvent.click(screen.getByRole('button', { name: 'Phóng to' }))
      expect(screen.getByTestId('stage:drawing')).toHaveAttribute('data-scalex', '2')

      await userEvent.click(screen.getByRole('button', { name: 'Vừa khung' }))
      expect(screen.getByTestId('stage:drawing')).toHaveAttribute('data-scalex', '1')
    })

    it('wires the current viewport size and zoom into the stage drag clamp, not stale or hardcoded ones', async () => {
      // jsdom reports clientWidth 0, so width falls back to 900 and height to
      // 1600 * (900 / 2000) = 720 -- the same numbers clampStagePan's own unit
      // tests use, so the boundary below is directly comparable to them.
      render(
        <DrawingCanvas
          imageUrl="u" imageW={2000} imageH={1600} cells={cells}
          selectedCodes={[]} panZoom
        />,
      )
      // At fit-to-container zoom there is nothing off-screen, so even a wildly
      // out-of-range drag target ({-5000, -5000}) must clamp back to {0, 0}.
      // A test that only checked "a dragBoundFunc prop exists" would still
      // pass if it clamped to the wrong bounds entirely.
      expect(screen.getByTestId('stage:drawing')).toHaveAttribute('data-dragboundx', '0')
      expect(screen.getByTestId('stage:drawing')).toHaveAttribute('data-dragboundy', '0')

      const zoomIn = screen.getByRole('button', { name: 'Phóng to' })
      await userEvent.click(zoomIn)
      await userEvent.click(zoomIn)
      expect(screen.getByTestId('stage:drawing')).toHaveAttribute('data-scalex', '2')

      // At zoom 2 the content is 1800 x 1440 in the 900 x 720 viewport, so the
      // furthest the drawing may be dragged is -900 / -720 -- exactly the
      // clampStagePan(_, 900, 720, 2) case in canvasView.test.ts. Matching
      // those literals here proves the component feeds its real measured
      // size and live zoom state into the same function, not a copy of it.
      expect(screen.getByTestId('stage:drawing')).toHaveAttribute('data-dragboundx', '-900')
      expect(screen.getByTestId('stage:drawing')).toHaveAttribute('data-dragboundy', '-720')
    })

    it('zooms in on wheel-up by the finer wheel step', () => {
      render(
        <DrawingCanvas
          imageUrl="u" imageW={2000} imageH={1600} cells={cells}
          selectedCodes={[]} panZoom
        />,
      )
      fireEvent.wheel(screen.getByTestId('stage:drawing'), { deltaY: -100 })
      // WHEEL_ZOOM_STEP is 0.25, finer than a button's 0.5 -- a wheel emits many
      // events per gesture, so a coarser step would overshoot fast.
      expect(screen.getByTestId('stage:drawing')).toHaveAttribute('data-scalex', '1.25')
    })

    it('is a no-op on wheel-down at the minimum zoom, not a drift past it', () => {
      render(
        <DrawingCanvas
          imageUrl="u" imageW={2000} imageH={1600} cells={cells}
          selectedCodes={[]} panZoom
        />,
      )
      expect(screen.getByTestId('stage:drawing')).toHaveAttribute('data-scalex', '1')
      fireEvent.wheel(screen.getByTestId('stage:drawing'), { deltaY: 100 })
      // clampZoom pins this at MIN_ZOOM. A test that only asserted "still 1"
      // would look identical whether the handler clamped correctly or threw
      // away the event entirely -- the point of this test, paired with the
      // wheel-up one above, is that the SAME handler does react to input and
      // still cannot be pushed past the boundary.
      expect(screen.getByTestId('stage:drawing')).toHaveAttribute('data-scalex', '1')
    })

    it('is a no-op on wheel-up at the maximum zoom, not a drift past it', () => {
      render(
        <DrawingCanvas
          imageUrl="u" imageW={2000} imageH={1600} cells={cells}
          selectedCodes={[]} panZoom
        />,
      )
      const stage = screen.getByTestId('stage:drawing')
      for (let i = 0; i < 20; i += 1) fireEvent.wheel(stage, { deltaY: -100 })
      expect(stage).toHaveAttribute('data-scalex', '4')
      fireEvent.wheel(stage, { deltaY: -100 })
      expect(stage).toHaveAttribute('data-scalex', '4')
    })

    it('ignores the wheel entirely when pan/zoom is off, so admin scrolling is unaffected', () => {
      render(
        <DrawingCanvas
          imageUrl="u" imageW={2000} imageH={1600} cells={cells}
          selectedCodes={[]}
        />,
      )
      fireEvent.wheel(screen.getByTestId('stage:drawing'), { deltaY: -100 })
      expect(screen.getByTestId('stage:drawing')).toHaveAttribute('data-scalex', '1')
    })
  })

  describe('plan overlay', () => {
    it('draws a dashed outline and the date range on a planned cell', () => {
      render(
        <DrawingCanvas
          imageUrl="u" imageW={2000} imageH={1600} cells={cells}
          selectedCodes={[]}
          planLabels={{ R1C1: '13/08 – 19/08' }}
        />,
      )
      expect(screen.getByTestId('rect:plan-R1C1')).toHaveAttribute('data-dash', '6,4')
      expect(screen.getByTestId('text:plan-label-R1C1')).toHaveAttribute('data-text', '13/08 – 19/08')
    })

    it('leaves an unplanned cell alone', () => {
      // Catches an overlay drawn over every cell, which on a deck with one zone
      // would annotate the whole drawing as planned.
      render(
        <DrawingCanvas
          imageUrl="u" imageW={2000} imageH={1600} cells={cells}
          selectedCodes={[]}
          planLabels={{ R1C1: '13/08 – 19/08' }}
        />,
      )
      expect(screen.queryByTestId('rect:plan-R1C2')).toBeNull()
    })

    it('draws no overlay at all when no plan is supplied', () => {
      render(
        <DrawingCanvas
          imageUrl="u" imageW={2000} imageH={1600} cells={cells}
          selectedCodes={[]}
        />,
      )
      expect(screen.queryByTestId('rect:plan-R1C1')).toBeNull()
    })
  })
  it('keeps the selection and plan layers out of the hit graph', () => {
    // The overlays draw on top of every cell. If either one listened, it would
    // absorb the tap that records progress -- and ticking a bay is the only
    // thing the GS screen does, so an overlay in front of it removes the app's
    // entire function while looking completely normal.
    //
    // Asserted as a prop rather than by clicking through the overlay: with
    // react-konva mocked there is no hit graph to click through, so a
    // behavioural test here would pass either way. Deliberately narrow, and on
    // the browser checklist for real verification.
    render(
      <DrawingCanvas
        imageUrl="i.png"
        imageW={100}
        imageH={100}
       
        cells={[{ code: 'R1C1', x: 0, y: 0, w: 1, h: 1, areaM2: 10 }]}
        selectedCodes={['R1C1']}
        planLabels={{ R1C1: '13/08 – 19/08' }}
      />,
    )
    expect(screen.getByTestId('layer:selection')).toHaveAttribute('data-listening', 'false')
    expect(screen.getByTestId('layer:plan')).toHaveAttribute('data-listening', 'false')
  })


  describe('crop mode', () => {
    // The stage is 900 wide (jsdom measures 0, so the fallback applies) and
    // 720 tall (1600 * 900/2000), so 90,72 -> 450,432 is x 0.1 y 0.1 w 0.4 h 0.5.
    const cropProps = {
      imageUrl: 'u', imageW: 2000, imageH: 1600, guides, cells, selectedCodes: [] as string[],
    }

    it('draws the committed crop region', () => {
      render(<DrawingCanvas {...cropProps} cropRect={{ x: 0.1, y: 0.1, w: 0.4, h: 0.5 }} />)
      const region = screen.getByTestId('rect:crop-region')
      expect(region).toHaveAttribute('data-x', '90')
      expect(region).toHaveAttribute('data-y', '72')
      expect(region).toHaveAttribute('data-width', '360')
      expect(region).toHaveAttribute('data-height', '360')
    })







    it('reports a drag as one bay when the screen is drawing bays', () => {
      // The same gesture, the other meaning. 90,72 -> 180,144 is a twentieth of
      // the drawing, which is a bay -- and well under the floor a crop has to
      // clear, so a mode that shared the crop's floor would refuse every bay.
      const onCellDraw = vi.fn()
      render(<DrawingCanvas {...cropProps} onCellDraw={onCellDraw} />)
      const stage = screen.getByTestId('stage:drawing')
      fireEvent.mouseDown(stage, { clientX: 90, clientY: 72 })
      fireEvent.mouseMove(stage, { clientX: 180, clientY: 144 })
      fireEvent.mouseUp(stage, { clientX: 180, clientY: 144 })
      expect(onCellDraw).toHaveBeenCalledWith({ x: 0.1, y: 0.1, w: 0.1, h: 0.1 })
    })

    it('does not select a cell with the gesture that drew a bay', () => {
      // Bays are drawn over the same pixels the existing bays occupy, so
      // without this the drag that adds a bay also selects whatever it started
      // on -- and the next tap on "Xoá ô đã chọn" takes that one away.
      const onCellClick = vi.fn()
      render(<DrawingCanvas {...cropProps} onCellClick={onCellClick} onCellDraw={vi.fn()} />)
      fireEvent.click(screen.getByTestId('rect:cell-R1C1'))
      expect(onCellClick).not.toHaveBeenCalled()
    })

    it('reports a Shift-drag as a band to select with', () => {
      // Armed by the modifier, gesture by gesture, rather than by a mode: it
      // costs nothing when the admin is not using it and takes nothing away
      // from whichever mode they are in.
      const onSelectDraw = vi.fn()
      const onCropDraw = vi.fn()
      render(<DrawingCanvas {...cropProps} onCropDraw={onCropDraw} onSelectDraw={onSelectDraw} />)
      const stage = screen.getByTestId('stage:drawing')
      fireEvent.mouseDown(stage, { clientX: 90, clientY: 72, shiftKey: true })
      fireEvent.mouseMove(stage, { clientX: 450, clientY: 432, shiftKey: true })
      fireEvent.mouseUp(stage, { clientX: 450, clientY: 432, shiftKey: true })
      expect(onSelectDraw).toHaveBeenCalledWith({ x: 0.1, y: 0.1, w: 0.4, h: 0.5 })
      expect(onCropDraw).not.toHaveBeenCalled()
    })

    it('keeps the gesture it started as, even if the key is let go mid-drag', () => {
      // Reading the modifier again at the end would let a finger lifted early
      // turn a band into a crop -- replacing the deck's whole cell set with
      // whatever the band happened to cover.
      const onSelectDraw = vi.fn()
      const onCropDraw = vi.fn()
      render(<DrawingCanvas {...cropProps} onCropDraw={onCropDraw} onSelectDraw={onSelectDraw} />)
      const stage = screen.getByTestId('stage:drawing')
      fireEvent.mouseDown(stage, { clientX: 90, clientY: 72, shiftKey: true })
      fireEvent.mouseUp(stage, { clientX: 450, clientY: 432 })
      expect(onSelectDraw).toHaveBeenCalledTimes(1)
      expect(onCropDraw).not.toHaveBeenCalled()
    })

    it('swallows the click a finished band leaves behind, even without Shift', () => {
      // The modifier can be let go before the mouse is, and then the trailing
      // click carries none -- so the Shift guard alone would miss it. Measured
      // on the real app, one drag is: mousedown, mousemove x3, mouseup, click.
      const onCellClick = vi.fn()
      const onSelectDraw = vi.fn()
      render(
        <DrawingCanvas {...cropProps} onCellClick={onCellClick} onSelectDraw={onSelectDraw} />,
      )
      const stage = screen.getByTestId('stage:drawing')
      fireEvent.mouseDown(stage, { clientX: 90, clientY: 72, shiftKey: true })
      fireEvent.mouseUp(stage, { clientX: 450, clientY: 432 })
      expect(onSelectDraw).toHaveBeenCalledTimes(1)

      fireEvent.click(screen.getByTestId('rect:cell-R1C1'))
      expect(onCellClick).not.toHaveBeenCalled()
    })

    it('says which gesture the drawing is waiting for with the pointer', () => {
      // The modes look alike: the same drawing, the same drag. The pointer is
      // the only thing on screen that says which one a drag is about to be.
      const plain = render(<DrawingCanvas {...cropProps} />)
      expect((plain.container.firstChild as HTMLElement).style.cursor).toBe('')
      plain.unmount()

      const cropping = render(<DrawingCanvas {...cropProps} onCropDraw={vi.fn()} />)
      expect((cropping.container.firstChild as HTMLElement).style.cursor).toBe('crosshair')
      cropping.unmount()

      const drawing = render(<DrawingCanvas {...cropProps} onCellDraw={vi.fn()} />)
      expect((drawing.container.firstChild as HTMLElement).style.cursor).toBe('copy')
    })

    it('draws no crop region when there is none', () => {
      render(<DrawingCanvas {...cropProps} />)
      expect(screen.queryByTestId('rect:crop-region')).not.toBeInTheDocument()
    })

    it('reports the dragged region', () => {
      const onCropDraw = vi.fn()
      render(<DrawingCanvas {...cropProps} onCropDraw={onCropDraw} />)
      const stage = screen.getByTestId('stage:drawing')
      fireEvent.mouseDown(stage, { clientX: 90, clientY: 72 })
      fireEvent.mouseMove(stage, { clientX: 450, clientY: 432 })
      fireEvent.mouseUp(stage, { clientX: 450, clientY: 432 })
      expect(onCropDraw).toHaveBeenCalledWith({ x: 0.1, y: 0.1, w: 0.4, h: 0.5 })
    })

    it('reports a drag that starts and ends inside one render', () => {
      // Found by driving the real app: an automated drag lost its crop about
      // half the time. The handlers read the gesture out of React state, so a
      // mousedown and mouseup batched into the same commit left the mouseup
      // looking at the state from BEFORE the mousedown -- no gesture, no crop.
      // A human's drag spans several frames and hides this; a fast flick on a
      // tablet does not.
      const onCropDraw = vi.fn()
      render(<DrawingCanvas {...cropProps} onCropDraw={onCropDraw} />)
      const stage = screen.getByTestId('stage:drawing')
      // One act() for both events: React batches them, so nothing this
      // component sets in the first handler is visible to the second.
      act(() => {
        stage.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 90, clientY: 72 }))
        stage.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 450, clientY: 432 }))
      })
      expect(onCropDraw).toHaveBeenCalledWith({ x: 0.1, y: 0.1, w: 0.4, h: 0.5 })
    })

    it('does not re-commit the last gesture on a release it never saw start', () => {
      // A pointer pressed outside the canvas and released inside sends a bare
      // mouseup. If the finished gesture were still on record it would be
      // committed a second time, replacing the crop the admin just drew with
      // the one before it.
      const onCropDraw = vi.fn()
      render(<DrawingCanvas {...cropProps} onCropDraw={onCropDraw} />)
      const stage = screen.getByTestId('stage:drawing')
      fireEvent.mouseDown(stage, { clientX: 90, clientY: 72 })
      fireEvent.mouseUp(stage, { clientX: 450, clientY: 432 })
      fireEvent.mouseUp(stage, { clientX: 700, clientY: 600 })
      expect(onCropDraw).toHaveBeenCalledTimes(1)
    })

    it('shows the band being dragged before it is committed', () => {
      render(<DrawingCanvas {...cropProps} onCropDraw={vi.fn()} />)
      const stage = screen.getByTestId('stage:drawing')
      fireEvent.mouseDown(stage, { clientX: 90, clientY: 72 })
      fireEvent.mouseMove(stage, { clientX: 450, clientY: 432 })
      // Without this the admin drags blind and finds out what they selected
      // only from the detection result.
      const band = screen.getByTestId('rect:crop-band')
      expect(band).toHaveAttribute('data-x', '90')
      expect(band).toHaveAttribute('data-width', '360')
      fireEvent.mouseUp(stage, { clientX: 450, clientY: 432 })
      expect(screen.queryByTestId('rect:crop-band')).not.toBeInTheDocument()
    })

    it('ignores a click that never became a drag', () => {
      const onCropDraw = vi.fn()
      render(<DrawingCanvas {...cropProps} onCropDraw={onCropDraw} />)
      const stage = screen.getByTestId('stage:drawing')
      fireEvent.mouseDown(stage, { clientX: 300, clientY: 200 })
      fireEvent.mouseUp(stage, { clientX: 300, clientY: 200 })
      expect(onCropDraw).not.toHaveBeenCalled()
    })



    it('does not select a cell with the gesture that drew the crop', () => {
      const onCellClick = vi.fn()
      render(<DrawingCanvas {...cropProps} onCellClick={onCellClick} onCropDraw={vi.fn()} />)
      fireEvent.click(screen.getByTestId('rect:cell-R1C1'))
      expect(onCellClick).not.toHaveBeenCalled()
    })
  })

})
