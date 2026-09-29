import { useEffect, useState } from 'react'

/** How long a search box waits after the last keystroke before it applies (FLT-08). */
export const SEARCH_DEBOUNCE_MS = 250

/**
 * `value`, once it has stopped changing for `delay` ms (FLT-08): a search box
 * alone applies as it changes, debounced, so a table is not re-filtered on
 * every keystroke. The box itself shows what is typed at once.
 */
export function useDebouncedValue<T>(value: T, delay: number = SEARCH_DEBOUNCE_MS): T {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return settled
}
