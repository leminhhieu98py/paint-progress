import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { DrawingCanvas } from './DrawingCanvas'

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
      onMouseUp={(domEvt: React.MouseEvent) =>
        (props.onDragEnd as ((e: unknown) => void) | undefined)?.({
          target: {
            x: () => domEvt.clientX,
            y: () => domEvt.clientY,
            position: () => undefined,
          },
        })
      }
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

  it('marks the selected cells distinctly from the unselected ones', () => {
    render(
      <DrawingCanvas
        imageUrl="u" imageW={2000} imageH={1600} guides={guides} cells={cells} selectedCodes={['R1C1']}
      />,
    )
    const selected = screen.getByTestId('rect:cell-R1C1').getAttribute('data-fill')
    const plain = screen.getByTestId('rect:cell-R1C2').getAttribute('data-fill')
    expect(selected).not.toBe(plain)
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
        selectedCodes={[]} width={1000}
      />,
    )
    // R1C2 sits at x = 0.5 of a 1000px-wide stage.
    expect(screen.getByTestId('rect:cell-R1C2')).toHaveAttribute('data-x', '500')
  })

  it('scales normalized coordinates to the rendered height', () => {
    // Height is derived (imageH * (width / imageW)), not passed directly, so
    // this exercises a different line than the width test above — it would
    // not fail if only the x-axis scaling broke.
    const cellsWithVerticalOffset = [{ code: 'R2C1', x: 0, y: 0.5, w: 1, h: 0.5, areaM2: 320 }]
    render(
      <DrawingCanvas
        imageUrl="u" imageW={2000} imageH={1600} guides={guides} cells={cellsWithVerticalOffset}
        selectedCodes={[]} width={1000}
      />,
    )
    // height = imageH * (width / imageW) = 1600 * (1000 / 2000) = 800; y = 0.5 * 800 = 400.
    expect(screen.getByTestId('rect:cell-R2C1')).toHaveAttribute('data-y', '400')
  })

  describe('double-click axis tie-break', () => {
    // A 1000x1000 stage (imageW === imageH, width === 1000) makes the
    // vertical-edge distance and horizontal-edge distance directly
    // comparable in the same units, so the boundary can be pinned exactly.
    const renderSquareStage = (onGuideAdd: (axis: 'x' | 'y', pos: number) => void) =>
      render(
        <DrawingCanvas
          imageUrl="u" imageW={1000} imageH={1000} guides={[]} cells={[]}
          selectedCodes={[]} width={1000} onGuideAdd={onGuideAdd}
        />,
      )

    it('adds a vertical guide when strictly closer to a vertical edge', () => {
      const onGuideAdd = vi.fn()
      renderSquareStage(onGuideAdd)
      // (100, 500): 100 from the left edge vs. 500 from the top — vertical wins.
      fireEvent.doubleClick(screen.getByTestId('stage:drawing'), { clientX: 100, clientY: 500 })
      expect(onGuideAdd).toHaveBeenCalledWith('x', 0.1)
    })

    it('adds a horizontal guide when strictly closer to a horizontal edge', () => {
      const onGuideAdd = vi.fn()
      renderSquareStage(onGuideAdd)
      // (500, 100): 500 from the left edge vs. 100 from the top — horizontal wins.
      fireEvent.doubleClick(screen.getByTestId('stage:drawing'), { clientX: 500, clientY: 100 })
      expect(onGuideAdd).toHaveBeenCalledWith('y', 0.1)
    })

    it('breaks an exact tie in favour of the vertical (x) axis', () => {
      const onGuideAdd = vi.fn()
      renderSquareStage(onGuideAdd)
      // (500, 500): equidistant (500) from both a vertical and a horizontal
      // edge. This is the boundary itself — if the comparison flipped from
      // `<=` to `<`, this assertion would fail and 'y' would win instead.
      fireEvent.doubleClick(screen.getByTestId('stage:drawing'), { clientX: 500, clientY: 500 })
      expect(onGuideAdd).toHaveBeenCalledWith('x', 0.5)
    })
  })

  describe('guide drag clamp', () => {
    // width === imageW === imageH === 1000 keeps the pixel/normalized math 1:1.
    const renderWithGuide = (onGuideMove: (index: number, pos: number) => void, pos: number) =>
      render(
        <DrawingCanvas
          imageUrl="u" imageW={1000} imageH={1000}
          guides={[{ axis: 'x' as const, pos, offsetMm: 0 }]} cells={[]}
          selectedCodes={[]} width={1000} onGuideMove={onGuideMove}
        />,
      )

    it('clamps a drag that would push the guide past 1 back to 1', () => {
      const onGuideMove = vi.fn()
      renderWithGuide(onGuideMove, 0.9)
      // (0.9 * 1000 + 500) / 1000 = 1.4 — past the top of the 0..1 range.
      fireEvent.mouseUp(screen.getByTestId('line:guide-x-0'), { clientX: 500, clientY: 0 })
      expect(onGuideMove).toHaveBeenCalledWith(0, 1)
    })

    it('clamps a drag that would push the guide past 0 back to 0', () => {
      const onGuideMove = vi.fn()
      renderWithGuide(onGuideMove, 0.1)
      // (0.1 * 1000 + -500) / 1000 = -0.4 — past the bottom of the 0..1 range.
      fireEvent.mouseUp(screen.getByTestId('line:guide-x-0'), { clientX: -500, clientY: 0 })
      expect(onGuideMove).toHaveBeenCalledWith(0, 0)
    })

    it('reports an in-range drag unclamped', () => {
      const onGuideMove = vi.fn()
      renderWithGuide(onGuideMove, 0.5)
      // (0.5 * 1000 + 100) / 1000 = 0.6 — safely inside 0..1.
      fireEvent.mouseUp(screen.getByTestId('line:guide-x-0'), { clientX: 100, clientY: 0 })
      expect(onGuideMove).toHaveBeenCalledWith(0, 0.6)
    })
  })
})
