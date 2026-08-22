import Konva from 'konva'
import { Image as KonvaImage, Layer, Line, Rect, Stage } from 'react-konva'
import useImage from 'use-image'
import type { Guide, MeshCell } from '../../domain/types'

const SELECTED_FILL = 'rgba(22, 119, 255, 0.45)'
const PLAIN_FILL = 'rgba(0, 0, 0, 0.04)'
/**
 * Cells are filled at this opacity so the beams and grid labels underneath stay
 * readable — the drawing is what the operator recognises, not our overlay.
 */
const STAGE_FILL_OPACITY = 0.45

export interface DrawingCanvasProps {
  imageUrl: string
  imageW: number
  imageH: number
  guides: Omit<Guide, 'id'>[]
  cells: MeshCell[]
  selectedCodes: string[]
  /** Colour per cell code; a code absent from the map renders unfilled. */
  cellColors?: Record<string, string>
  onGuideMove?: (index: number, pos: number) => void
  onGuideAdd?: (axis: 'x' | 'y', pos: number) => void
  onCellClick?: (code: string, additive: boolean) => void
  width?: number
}

export function DrawingCanvas({
  imageUrl,
  imageW,
  imageH,
  guides,
  cells,
  selectedCodes,
  cellColors,
  onGuideMove,
  onGuideAdd,
  onCellClick,
  width = 900,
}: DrawingCanvasProps) {
  const [image] = useImage(imageUrl)
  const scale = width / imageW
  const height = imageH * scale
  const selected = new Set(selectedCodes)

  const fillFor = (code: string) => {
    if (selected.has(code)) return SELECTED_FILL
    const color = cellColors?.[code]
    return color ?? PLAIN_FILL
  }

  return (
    <Stage
      name="drawing"
      width={width}
      height={height}
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
            fill={fillFor(cell.code)}
            opacity={cellColors?.[cell.code] ? STAGE_FILL_OPACITY : 1}
            stroke="rgba(255, 0, 0, 0.6)"
            strokeWidth={1}
            onClick={(e: Konva.KonvaEventObject<MouseEvent>) =>
              onCellClick?.(cell.code, e.evt.shiftKey || e.evt.metaKey || e.evt.ctrlKey)
            }
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
  )
}
