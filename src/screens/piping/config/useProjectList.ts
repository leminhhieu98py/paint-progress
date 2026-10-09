import { useEffect, useState } from 'react'

type ListState<T> = { rows: T[] } | { error: string } | null

/**
 * One of the project's lists in Cấu hình (groups, columns, import log): read
 * on mount and on `reload`, the last answer kept on screen while a re-read
 * runs, and settable for an optimistic reorder. `read` must be stable (a
 * module function).
 */
export function useProjectList<T>(projectId: string, read: (projectId: string) => Promise<T[]>) {
  const [state, setState] = useState<ListState<T>>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    read(projectId)
      .then((rows) => {
        if (!cancelled) setState({ rows })
      })
      .catch((e: Error) => {
        if (!cancelled) setState({ error: e.message })
      })
    return () => {
      cancelled = true
    }
  }, [projectId, read, attempt])

  return {
    rows: state !== null && 'rows' in state ? state.rows : null,
    error: state !== null && 'error' in state ? state.error : null,
    setRows: (rows: T[]) => setState({ rows }),
    reload: () => setAttempt((n) => n + 1),
  }
}
