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
 * draft brings its own Sàn).
 *
 * `options` is what was read for `projectId`, null while loading, without a
 * project, or after a failed read; `error` is that failure's message, for the
 * screen to show and to settle the draft against "nothing" rather than carry
 * the old project's choice across. `loading` is true while that read is in flight: the bar's Tìm waits
 * for it, so a draft is never applied against options that have not arrived.
 * `cached(id)` answers from every project read so far, so the screen can keep
 * showing a project's options between Tìm and the arrival of its full data.
 * A response that arrives after the project changed is dropped.
 *
 * `load` must be stable (a module-level function): it is an effect dependency.
 */
export function useProjectOptions<T>(projectId: string | null, load: (projectId: string) => Promise<T>) {
  const [read, setRead] = useState<Record<string, T>>({})
  const [failed, setFailed] = useState<{ projectId: string; message: string } | null>(null)
  const known = projectId !== null && Object.prototype.hasOwnProperty.call(read, projectId)

  useEffect(() => {
    if (projectId === null || known) return
    let cancelled = false
    load(projectId)
      .then((options) => {
        if (!cancelled) setRead((r) => ({ ...r, [projectId]: options }))
      })
      .catch((e: unknown) => {
        // Options only: the bar still offers Tất cả, and Tìm loads the real data.
        if (!cancelled) setFailed({ projectId, message: e instanceof Error ? e.message : String(e) })
      })
    return () => {
      cancelled = true
    }
  }, [projectId, known, load])

  return {
    options: known ? read[projectId as string] : null,
    loading: projectId !== null && !known && failed?.projectId !== projectId,
    error: !known && failed !== null && failed.projectId === projectId ? failed.message : null,
    cached: (id: string | null): T | null => (id !== null && Object.prototype.hasOwnProperty.call(read, id) ? read[id] : null),
  }
}

/**
 * The draft reconciled with the options it depends on (FLT-02), IN the draft:
 * a Sàn (or work, or coat) the draft project lacks is cleared, not only hidden,
 * so picking project A, then B, then A again does not bring it back. With
 * `options` null (still loading, or unknown after a failed read) the draft is
 * left as it is: it is never reconciled against options that have not arrived.
 *
 * Called during render; the correction is a state update of the same
 * component, made only when it changes something, so it settles in one pass.
 */
export function settleDraft<T extends object, O>(
  scope: { draft: T; setDraft: (next: T) => void },
  options: O | null,
  settle: (draft: T, options: O) => T,
): T {
  if (options === null) return scope.draft
  const settled = settle(scope.draft, options)
  const changed = (Object.keys(settled) as (keyof T)[]).some((k) => !Object.is(settled[k], scope.draft[k]))
  if (changed) scope.setDraft(settled)
  return settled
}
