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
      onClick={(domEvt: React.MouseEvent) =>
        (props.onClick as ((e: unknown) => void) | undefined)?.({ evt: domEvt })
      }
      onDoubleClick={(domEvt: React.MouseEvent) =>
        (props.onDblClick as ((e: unknown) => void) | undefined)?.({
          target: {
            getStage: () => ({
              getPointerPosition: () => ({ x: domEvt.clientX, y: domEvt.clientY }),
            }),
          },
        })
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
      }}
    >
      {props.children as never}
    </div>
  )
  return { Stage: node('stage'), Layer: node('layer'), Rect: node('rect'), Line: node('line'), Image: node('image') }
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
  it('renders one line per guide', () => {
    render(
      <DrawingCanvas imageUrl="u" imageW={2000} imageH={1600} guides={guides} cells={[]} selectedCodes={[]} />,
    )
    expect(screen.getAllByTestId(/^line:guide-/)).toHaveLength(5)
  })

  it('renders one rect per cell', () => {
    render(
      <DrawingCanvas imageUrl="u" imageW={2000} imageH={1600} guides={guides} cells={cells} selectedCodes={[]} />,
    )
    expect(screen.getByTestId('rect:cell-R1C1')).toBeInTheDocument()
    expect(screen.getByTestId('rect:cell-R1C2')).toBeInTheDocument()
  })

  it('fills a cell with its assigned colour', () => {
    render(
      <DrawingCanvas
        imageUrl="u" imageW={2000} imageH={1600} guides={guides} cells={cells}
        selectedCodes={[]} cellColors={{ R1C1: '#52c41a' }}
      />,
    )
    expect(screen.getByTestId('rect:cell-R1C1')).toHaveAttribute('data-fill', '#52c41a')
  })

  it('renders a coloured cell at partial opacity so the drawing stays visible underneath', () => {
    render(
      <DrawingCanvas
        imageUrl="u" imageW={2000} imageH={1600} guides={guides} cells={cells}
        selectedCodes={[]} cellColors={{ R1C1: '#52c41a' }}
      />,
    )
    // Cells are filled at partial opacity, not solid — the beams and grid
    // labels underneath must stay readable through the overlay.
    expect(screen.getByTestId('rect:cell-R1C1')).toHaveAttribute('data-opacity', '0.45')
  })

  it('renders an unfilled cell at full opacity', () => {
    render(
      <DrawingCanvas imageUrl="u" imageW={2000} imageH={1600} guides={guides} cells={cells} selectedCodes={[]} />,
    )
    expect(screen.getByTestId('rect:cell-R1C1')).toHaveAttribute('data-opacity', '1')
  })

  it('keeps a selected cell\'s own stage colour and adds a selection overlay', () => {
    render(
      <DrawingCanvas
        imageUrl="u" imageW={2000} imageH={1600} guides={guides} cells={cells} selectedCodes={['R1C1']}
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
        imageUrl="u" imageW={2000} imageH={1600} guides={guides} cells={cells}
        selectedCodes={[]} onCellClick={onCellClick}
      />,
    )
    await userEvent.click(screen.getByTestId('rect:cell-R1C2'))
    expect(onCellClick).toHaveBeenCalledWith('R1C2', false)
  })

  it.each([
    ['shiftKey', { shiftKey: true }],
    ['metaKey', { metaKey: true }],
    ['ctrlKey', { ctrlKey: true }],
  ] as const)('reports additive=true when %s is held', (_name, modifier) => {
    const onCellClick = vi.fn()
    render(
      <DrawingCanvas
        imageUrl="u" imageW={2000} imageH={1600} guides={guides} cells={cells}
        selectedCodes={[]} onCellClick={onCellClick}
      />,
    )
    fireEvent.click(screen.getByTestId('rect:cell-R1C2'), modifier)
    expect(onCellClick).toHaveBeenCalledWith('R1C2', true)
  })

  it('scales normalized coordinates to the rendered width', () => {
    render(
      <DrawingCanvas
        imageUrl="u" imageW={2000} imageH={1600} guides={guides} cells={cells}
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
        imageUrl="u" imageW={2000} imageH={1600} guides={guides} cells={cellsWithVerticalOffset}
        selectedCodes={[]}
      />,
    )
    // height = imageH * (width / imageW) = 1600 * (900 / 2000) = 720 at the 900px fallback width; y = 0.5 * 720 = 360.
    expect(screen.getByTestId('rect:cell-R2C1')).toHaveAttribute('data-y', '360')
  })

  describe('double-click axis tie-break', () => {
    // A square drawing (imageW === imageH) makes the rendered stage square
    // too (900x900, the fixed stage width): the vertical-edge distance and
    // horizontal-edge distance are directly comparable in the same units, so
    // the boundary can be pinned exactly. Click coordinates below are 0.9x
    // what they would be against a 1000-wide stage, so the resulting
    // fractions land on the same clean 0.1 / 0.5 values either way.
    const renderSquareStage = (onGuideAdd: (axis: 'x' | 'y', pos: number) => void) =>
      render(
        <DrawingCanvas
          imageUrl="u" imageW={1000} imageH={1000} guides={[]} cells={[]}
          selectedCodes={[]} onGuideAdd={onGuideAdd}
        />,
      )

    it('adds a vertical guide when strictly closer to a vertical edge', () => {
      const onGuideAdd = vi.fn()
      renderSquareStage(onGuideAdd)
      // (90, 450): 90 from the left edge vs. 450 from the top — vertical wins.
      fireEvent.doubleClick(screen.getByTestId('stage:drawing'), { clientX: 90, clientY: 450 })
      expect(onGuideAdd).toHaveBeenCalledWith('x', 0.1)
    })

    it('adds a horizontal guide when strictly closer to a horizontal edge', () => {
      const onGuideAdd = vi.fn()
      renderSquareStage(onGuideAdd)
      // (450, 90): 450 from the left edge vs. 90 from the top — horizontal wins.
      fireEvent.doubleClick(screen.getByTestId('stage:drawing'), { clientX: 450, clientY: 90 })
      expect(onGuideAdd).toHaveBeenCalledWith('y', 0.1)
    })

    it('breaks an exact tie in favour of the vertical (x) axis', () => {
      const onGuideAdd = vi.fn()
      renderSquareStage(onGuideAdd)
      // (450, 450): equidistant from both a vertical and a horizontal edge on
      // a 900-wide stage. This is the boundary itself -- if the comparison
      // flipped from `<=` to `<`, this assertion would fail and 'y' would
      // win instead.
      fireEvent.doubleClick(screen.getByTestId('stage:drawing'), { clientX: 450, clientY: 450 })
      expect(onGuideAdd).toHaveBeenCalledWith('x', 0.5)
    })
  })

  describe('guide drag clamp', () => {
    // imageW === imageH keeps height === width (900, the fixed stage width),
    // so the pixel/normalized math is 1:1 on this square stage.
    const renderWithGuide = (onGuideMove: (index: number, pos: number) => void, pos: number) =>
      render(
        <DrawingCanvas
          imageUrl="u" imageW={1000} imageH={1000}
          guides={[{ axis: 'x' as const, pos, offsetMm: 0 }]} cells={[]}
          selectedCodes={[]} onGuideMove={onGuideMove}
        />,
      )

    it('clamps a drag that would push the guide past 1 back to 1', () => {
      const onGuideMove = vi.fn()
      renderWithGuide(onGuideMove, 0.9)
      // (0.9 * 900 + 450) / 900 = 1.4 — past the top of the 0..1 range.
      fireEvent.mouseUp(screen.getByTestId('line:guide-x-0'), { clientX: 450, clientY: 0 })
      expect(onGuideMove).toHaveBeenCalledWith(0, 1)
    })

    it('clamps a drag that would push the guide past 0 back to 0', () => {
      const onGuideMove = vi.fn()
      renderWithGuide(onGuideMove, 0.1)
      // (0.1 * 900 + -450) / 900 = -0.4 — past the bottom of the 0..1 range.
      fireEvent.mouseUp(screen.getByTestId('line:guide-x-0'), { clientX: -450, clientY: 0 })
      expect(onGuideMove).toHaveBeenCalledWith(0, 0)
    })

    it('reports an in-range drag unclamped', () => {
      const onGuideMove = vi.fn()
      renderWithGuide(onGuideMove, 0.5)
      // (0.5 * 900 + 90) / 900 = 0.6 — safely inside 0..1.
      fireEvent.mouseUp(screen.getByTestId('line:guide-x-0'), { clientX: 90, clientY: 0 })
      expect(onGuideMove).toHaveBeenCalledWith(0, 0.6)
    })

    it('resets the dragged node so offsets do not accumulate across drags', () => {
      // Konva does not revert a dragged node's position on its own. Without
      // this reset, drag N's leftover offset gets added again in drag N+1 --
      // the guide drifts by the accumulated delta every time, silently
      // changing every cell area derived from it (guides determine cell
      // areas, and cell areas determine every reported percentage).
      const onGuideMove = vi.fn()
      renderWithGuide(onGuideMove, 0.5)
      fireEvent.mouseUp(screen.getByTestId('line:guide-x-0'), { clientX: 90, clientY: 0 })
      expect(positionSpy).toHaveBeenCalledWith({ x: 0, y: 0 })
    })

    it('does not let a second drag compound the first drag\'s leftover offset', () => {
      const onGuideMove = vi.fn()
      const { rerender } = renderWithGuide(onGuideMove, 0.5)

      // First drag: pointer moves +90px. (0.5 * 900 + 90) / 900 = 0.6.
      fireEvent.mouseUp(screen.getByTestId('line:guide-x-0'), { clientX: 90, clientY: 0 })
      expect(onGuideMove).toHaveBeenNthCalledWith(1, 0, 0.6)

      // The real consumer (Task 8's DeckEditor) applies that update and
      // re-renders with the guide at its new position -- simulate that.
      rerender(
        <DrawingCanvas
          imageUrl="u" imageW={1000} imageH={1000}
          guides={[{ axis: 'x' as const, pos: 0.6, offsetMm: 0 }]} cells={[]}
          selectedCodes={[]} onGuideMove={onGuideMove}
        />,
      )

      // Second drag: pointer moves +90px again -- the same size step as the
      // first. The second reported position must be exactly one more step
      // past the first (0.7), not further from it than the first step was
      // from the start (0.6 -> 0.7 is a 0.1 step, same as 0.5 -> 0.6). If the
      // reset above were missing, the first drag's leftover 90px would still
      // be sitting on the node, and this would report 0.8 instead -- the
      // guide drifting by twice the intended step.
      fireEvent.mouseUp(screen.getByTestId('line:guide-x-0'), { clientX: 90, clientY: 0 })
      expect(onGuideMove).toHaveBeenNthCalledWith(2, 0, 0.7)
    })
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
          imageUrl="u" imageW={2000} imageH={1600} guides={guides} cells={cells}
          selectedCodes={[]}
        />,
      )
      expect(screen.getByTestId('stage:drawing')).toHaveAttribute('data-width', '640')
    })

    it('derives the height from the container width and the image aspect ratio', () => {
      stubClientWidth(640)
      render(
        <DrawingCanvas
          imageUrl="u" imageW={2000} imageH={1600} guides={guides} cells={cells}
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
          imageUrl="u" imageW={2000} imageH={1600} guides={guides} cells={cells}
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
          imageUrl="u" imageW={2000} imageH={1600} guides={guides} cells={cells}
          selectedCodes={[]}
        />,
      )
      expect(screen.getByTestId('stage:drawing')).toHaveAttribute('data-width', '900')
    })
  })

  describe('guide grab target', () => {
    it('gives every guide a custom hit area', () => {
      // jsdom has no canvas, so the hitFunc cannot be executed here; the
      // geometry it paints is asserted directly on guideHitProfile in
      // canvasView.test.ts. What this catches is the hitFunc being dropped from
      // the Line entirely, which returns the grab target to the 2 px stroke the
      // browser session found unusable and hands intersections back to z-order.
      render(
        <DrawingCanvas
          imageUrl="u" imageW={2000} imageH={1600} guides={guides} cells={cells}
          selectedCodes={[]}
          onGuideMove={() => {}}
        />,
      )
      expect(screen.getByTestId('line:guide-x-1')).toHaveAttribute('data-hashitfunc', 'true')
      expect(screen.getByTestId('line:guide-y-3')).toHaveAttribute('data-hashitfunc', 'true')
    })
  })
})
