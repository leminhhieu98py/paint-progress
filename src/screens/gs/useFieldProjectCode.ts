import { useEffect, useState } from 'react'
import { cachedProjectCode, projectListFor } from './fieldProjects'

/**
 * The code of the project on screen (e.g. DEMO), which leads the phone's
 * one-line filter summary (FLT-04, M2): short, so the filters after it stay
 * on the line, where the full name pushed them off. The session's one project
 * list (fieldProjects) answers it -- the read the Dự án switch makes, shared,
 * not a second one. Undefined until it is known, or after a failed read.
 */
export function useFieldProjectCode(projectId: string | null): string | undefined {
  const [, setRead] = useState(0)

  useEffect(() => {
    if (projectId === null || cachedProjectCode(projectId) !== undefined) return
    let cancelled = false
    projectListFor(projectId)
      .then(() => {
        if (!cancelled) setRead((n) => n + 1)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [projectId])

  return projectId === null ? undefined : cachedProjectCode(projectId)
}
