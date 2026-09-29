import { useEffect, useState } from 'react'

/**
 * A filter bar of more than one control holds a draft (FLT-02): changing a
 * control changes only `draft`; the screen reads `applied`, which moves to
 * the draft on `apply` (Tìm, or Enter in a text field of the bar) and back to
 * the defaults on `reset` (Đặt lại), both at once. The first load applies the
 * defaults without a click.
 *
 * `apply(value)` takes the value to apply when the caller has settled the
 * draft first -- a Sàn the draft project does not have resets to Tất cả sàn
 * -- and the draft becomes that value too. `version` counts every apply and
 * reset, so a pager can go back to page 1 on each even when nothing changed.
 *
 * A bar with ONE control does not use this: it keeps applying on change.
 */
export function useDraftFilters<T extends object>(defaults: T) {
  const [draft, setDraftState] = useState<T>(defaults)
  const [applied, setApplied] = useState<T>(defaults)
  const [version, setVersion] = useState(0)

  const setDraft = (next: Partial<T> | ((current: T) => T)) =>
    setDraftState((current) => (typeof next === 'function' ? next(current) : { ...current, ...next }))

  const apply = (value: T = draft) => {
    setDraftState(value)
    setApplied(value)
    setVersion((n) => n + 1)
  }

  const reset = () => {
    setDraftState(defaults)
    setApplied(defaults)
    setVersion((n) => n + 1)
  }

  return { draft, setDraft, applied, apply, reset, version }
}

/**
 * The options a draft control needs for a project the screen has not loaded
 * (FLT-02: dependent options follow the DRAFT -- another project in the
 * draft brings its own Sàn). Null while loading, or without a project; a
 * failed read leaves it null, and the control offers only its "Tất cả" entry.
 * `load` must be stable (a module-level function): it is an effect dependency.
 */
export function useProjectOptions<T>(projectId: string | null, load: (projectId: string) => Promise<T>): T | null {
  const [loaded, setLoaded] = useState<{ projectId: string; options: T } | null>(null)

  useEffect(() => {
    if (projectId === null) return
    let cancelled = false
    load(projectId)
      .then((options) => {
        if (!cancelled) setLoaded({ projectId, options })
      })
      .catch(() => {
        // Options only: the bar still offers Tất cả, and Tìm loads the real data.
      })
    return () => {
      cancelled = true
    }
  }, [projectId, load])

  return loaded !== null && loaded.projectId === projectId ? loaded.options : null
}
