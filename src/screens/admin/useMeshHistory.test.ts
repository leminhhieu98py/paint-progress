import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useMeshHistory } from './useMeshHistory'
import type { MeshCell } from '../../domain/types'

const cell = (code: string): MeshCell => ({ code, x: 0, y: 0, w: 1, h: 1, areaM2: 1 })
const codes = (cells: MeshCell[]) => cells.map((c) => c.code)

describe('useMeshHistory', () => {
  it('steps back to the mesh a commit replaced', () => {
    const { result } = renderHook(() => useMeshHistory([cell('R1C1')]))
    act(() => result.current.commit([cell('R1C1'), cell('R1C2')]))
    expect(codes(result.current.cells)).toEqual(['R1C1', 'R1C2'])

    act(() => { result.current.undo() })
    expect(codes(result.current.cells)).toEqual(['R1C1'])
  })

  it('steps forward again, so an accidental undo is not itself destructive', () => {
    const { result } = renderHook(() => useMeshHistory([cell('R1C1')]))
    act(() => result.current.commit([cell('R1C2')]))
    act(() => { result.current.undo() })
    act(() => { result.current.redo() })
    expect(codes(result.current.cells)).toEqual(['R1C2'])
  })

  it('drops the redo stack once a new edit is committed', () => {
    // Otherwise redo restores a mesh that branches off a history the admin has
    // already left -- it would put back bays that never existed beside the ones
    // they have just drawn.
    const { result } = renderHook(() => useMeshHistory([cell('A')]))
    act(() => result.current.commit([cell('B')]))
    act(() => { result.current.undo() })
    act(() => result.current.commit([cell('C')]))
    act(() => { expect(result.current.redo()).toBe(false) })
    expect(codes(result.current.cells)).toEqual(['C'])
  })

  it('says so when there is nothing to step to, rather than silently doing nothing', () => {
    const { result } = renderHook(() => useMeshHistory([cell('A')]))
    act(() => { expect(result.current.undo()).toBe(false) })
    act(() => { expect(result.current.redo()).toBe(false) })
    expect(codes(result.current.cells)).toEqual(['A'])
  })

  it('records no step for a reset, because a load is not an edit', () => {
    // The re-read after a failed write goes through here. Offering to undo back
    // past it would offer to restore a mesh the database never held.
    const { result } = renderHook(() => useMeshHistory([cell('A')]))
    act(() => result.current.reset([cell('B')]))
    act(() => { expect(result.current.undo()).toBe(false) })
    expect(codes(result.current.cells)).toEqual(['B'])
  })

  it('makes a written mesh the new floor', () => {
    const { result } = renderHook(() => useMeshHistory([cell('A')]))
    act(() => result.current.commit([cell('B')]))
    act(() => { result.current.clearHistory() })
    act(() => { expect(result.current.undo()).toBe(false) })
    expect(codes(result.current.cells)).toEqual(['B'])
  })
})
