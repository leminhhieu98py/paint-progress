import { useState } from 'react'

/**
 * What a filter bar has applied (RV7-3): every control applies as it changes,
 * with no draft, no Đặt lại and no Tìm. The first load applies `initial`
 * without a click -- the defaults, or the filters a field page was opened on
 * by a project switch (I-1).
 *
 * `apply(next)` merges a change into what is applied. `version` counts every
 * apply, so a pager can go back to page 1 on each even when nothing changed.
 * `replace(value)` puts a value in place without counting: the correction the
 * options make (`settleFilters`), not a change of the user's.
 */
export function useAppliedFilters<T extends object>(initial: T) {
  const [applied, setApplied] = useState<T>(initial)
  const [version, setVersion] = useState(0)

  const apply = (next: Partial<T>) => {
    setApplied((current) => ({ ...current, ...next }))
    setVersion((n) => n + 1)
  }

  return { applied, apply, replace: setApplied, version }
}

/**
 * The applied filters reconciled with the options they depend on, IN what is
 * applied: a Sàn (or work, or coat) the project lacks is cleared, not only
 * hidden, so picking project A, then B, then A again does not bring it back.
 * With `options` null (still loading, or unknown after a failed read) the
 * filters are left as they are: they are never reconciled against options
 * that have not arrived.
 *
 * Called during render; the correction is a state update of the same
 * component, made only when it changes something, so it settles in one pass.
 */
export function settleFilters<T extends object, O>(
  scope: { applied: T; replace: (next: T) => void },
  options: O | null,
  settle: (applied: T, options: O) => T,
): T {
  if (options === null) return scope.applied
  const settled = settle(scope.applied, options)
  const changed = (Object.keys(settled) as (keyof T)[]).some((k) => !Object.is(settled[k], scope.applied[k]))
  if (changed) scope.replace(settled)
  return settled
}
