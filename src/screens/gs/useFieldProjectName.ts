import { useEffect, useState } from 'react'
import { cachedProjectName, projectListFor } from './fieldProjects'

/**
 * The name of the project on screen, for the phone's one-line filter summary
 * (FLT-04), where the Dự án switch sits in the closed sheet. The session's
 * one project list (fieldProjects) answers it -- the read the switch makes,
 * shared, not a second one. Undefined until it is known, or after a failed
 * read.
 */
export function useFieldProjectName(projectId: string | null): string | undefined {
  const [, setRead] = useState(0)

  useEffect(() => {
    if (projectId === null || cachedProjectName(projectId) !== undefined) return
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

  return projectId === null ? undefined : cachedProjectName(projectId)
}
