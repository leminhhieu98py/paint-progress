import { HolderOutlined } from '@ant-design/icons'
import { useRef } from 'react'
import { palette, visuallyHidden } from '../../../theme'

/** The list with the row at `from` moved to `to`. */
export function moveRow<T>(rows: readonly T[], from: number, to: number): T[] {
  const next = [...rows]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next
}

/** The sort a row added at the end takes. */
export function nextSort(rows: ReadonlyArray<{ sort: number }>): number {
  return rows.reduce((max, r) => Math.max(max, r.sort), 0) + 1
}

/**
 * Drag-to-reorder for a table's rows (ORD-01), as the stage list does it: the
 * whole row is the drag target, a handle column says so, and the order is
 * reported on drop. A ref, not state, for the dragged row: dragover fires on
 * every pixel and nothing renders from it.
 */
export function useRowDrag(onMove: (from: number, to: number) => void, enabled: boolean) {
  const dragging = useRef<number | null>(null)
  const onRow = (_row: unknown, index?: number) => ({
    draggable: enabled,
    onDragStart: () => { dragging.current = index ?? null },
    // Without preventDefault the browser refuses the drop.
    onDragOver: (e: { preventDefault: () => void }) => e.preventDefault(),
    onDrop: () => {
      const from = dragging.current
      dragging.current = null
      const to = index ?? 0
      if (from !== null && from !== to) onMove(from, to)
    },
  })
  const handleColumn = {
    title: <span style={visuallyHidden}>Kéo để sắp xếp</span>,
    key: 'handle',
    align: 'center' as const,
    width: 34,
    render: () => <HolderOutlined style={{ color: palette.iconMuted, cursor: enabled ? 'grab' : 'not-allowed' }} />,
  }
  return { onRow, handleColumn }
}
