import { useEffect, useState } from 'react'

type Loaded<T> = { projectId: string; data: T } | { projectId: string; error: string }

/**
 * A Piping panel's own data (`PipingPanelProps`: a panel owns its reads): read
 * on mount, when the project changes, when Cấu hình bumps `refreshKey`, and on
 * `reload` (after a write, or Thử lại). The last answer for the same project
 * stays on screen while a re-read runs; another project's never shows. `read`
 * must be stable (a module function or a memoised callback).
 */
export function usePanelData<T>(projectId: string, refreshKey: number, read: (projectId: string) => Promise<T>) {
  const [loaded, setLoaded] = useState<Loaded<T> | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    read(projectId)
      .then((data) => {
        if (!cancelled) setLoaded({ projectId, data })
      })
      .catch((e: Error) => {
        if (!cancelled) setLoaded({ projectId, error: e.message })
      })
    return () => {
      cancelled = true
    }
  }, [projectId, refreshKey, read, attempt])

  const current = loaded !== null && loaded.projectId === projectId ? loaded : null
  return {
    /** Null until the first answer for this project, and after a failed read. */
    data: current !== null && 'data' in current ? current.data : null,
    error: current !== null && 'error' in current ? current.error : null,
    reload: () => setAttempt((n) => n + 1),
  }
}
