import { useEffect, useState } from 'react'

/** An answer, with the read it answers: a later reload is pending until its own answer lands. */
type Loaded<T> = { projectId: string; refreshKey: number; attempt: number; read: unknown } & ({ data: T } | { error: string })

/**
 * A Piping panel's own data (`PipingPanelProps`: a panel owns its reads): read
 * on mount, when the project changes, when Cấu hình bumps `refreshKey`, and on
 * `reload` (after a write, or Thử lại). The last answer for the same project
 * stays on screen while a re-read runs (`loading` says one runs, so an empty
 * answer is not taken for the final one); another project's never shows.
 * `read` must be stable (a module function or a memoised callback).
 */
export function usePanelData<T>(projectId: string, refreshKey: number, read: (projectId: string) => Promise<T>) {
  const [loaded, setLoaded] = useState<Loaded<T> | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    read(projectId)
      .then((data) => {
        if (!cancelled) setLoaded({ projectId, refreshKey, attempt, read, data })
      })
      .catch((e: Error) => {
        if (!cancelled) setLoaded({ projectId, refreshKey, attempt, read, error: e.message })
      })
    return () => {
      cancelled = true
    }
  }, [projectId, refreshKey, read, attempt])

  const current = loaded !== null && loaded.projectId === projectId ? loaded : null
  const answered = current !== null && current.refreshKey === refreshKey && current.attempt === attempt && current.read === read
  return {
    /** Null until the first answer for this project, and after a failed read. */
    data: current !== null && 'data' in current ? current.data : null,
    error: current !== null && 'error' in current ? current.error : null,
    /** True while a read runs, the first one included, until its answer lands. */
    loading: !answered,
    reload: () => setAttempt((n) => n + 1),
  }
}
