import { useRef, useState } from 'react'
import type { MeshCell } from '../../domain/types'

/**
 * The bay mesh, and the two stacks that let the admin take a step back.
 *
 * Split out of DeckEditor because it is the one part of that screen with a
 * shape of its own: a value, and two stacks that only ever move between each
 * other. Everything else there is about the deck -- what to detect, what to
 * confirm, what to write -- and reads this the way it would read any other
 * piece of state.
 *
 * The stacks are refs, not state. Nothing on screen renders from them (there is
 * no undo BUTTON -- the gesture is Cmd+Z), and holding them in state would
 * re-render the whole mesh on every commit for a value nobody displays.
 */
export interface MeshHistory {
  cells: MeshCell[]
  /** Replaces the mesh and pushes what it replaced onto the undo stack. */
  commit: (next: MeshCell[]) => void
  /**
   * Replaces the mesh WITHOUT recording a step.
   *
   * For loads and for the re-read after a failed write: those are not edits the
   * admin made, and offering to undo back past one would offer to restore a
   * mesh the database never held.
   */
  reset: (next: MeshCell[]) => void
  undo: () => boolean
  redo: () => boolean
  /**
   * Throws both stacks away.
   *
   * Called after a successful write: the written set is the new floor. Undoing
   * past a save would put the screen back to a mesh the database no longer
   * holds, with no way to tell from looking.
   */
  clearHistory: () => void
}

export function useMeshHistory(initial: MeshCell[] = []): MeshHistory {
  const [cells, setCells] = useState<MeshCell[]>(initial)
  const past = useRef<MeshCell[][]>([])
  const future = useRef<MeshCell[][]>([])

  return {
    cells,
    commit: (next) => {
      past.current = [...past.current, cells]
      future.current = []
      setCells(next)
    },
    reset: (next) => setCells(next),
    undo: () => {
      const previous = past.current.at(-1)
      if (!previous) return false
      past.current = past.current.slice(0, -1)
      future.current = [cells, ...future.current]
      setCells(previous)
      return true
    },
    redo: () => {
      const next = future.current[0]
      if (!next) return false
      future.current = future.current.slice(1)
      past.current = [...past.current, cells]
      setCells(next)
      return true
    },
    clearHistory: () => {
      past.current = []
      future.current = []
    },
  }
}
