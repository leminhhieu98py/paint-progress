import { Select } from 'antd'
import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { searchSelectProps } from '../../components/searchSelect'
import { APP_BASE_PATH } from '../../config'
import { cachedProjectList, cachedProjectName, projectListFor } from './fieldProjects'
import { FIELD_SECTIONS, fieldSectionOf } from './fieldSections'

/**
 * `Dự án`, the first control of every field filter bar (GS-07): the projects
 * this account can open -- RLS answers the one read with a foreman's
 * memberships and a viewer's every project (0034) -- searchable (UI-02), named
 * by its aria-label (FLT-01). An account on one project still sees it, with
 * one option, so the bar reads the same for everyone.
 *
 * Choosing is navigation, not a filter: it opens the same page of the chosen
 * project at once, and the page remounts on the new id, so no draft of the
 * old project's filters is carried across.
 *
 * The list is kept for the session (fieldProjects), because every field page
 * and every project switch mounts this anew. A failed read leaves the project
 * on screen, which is on the route: by the name the screen already read when
 * it has one, else by its id.
 */
export function FieldProjectSelect({ projectId, width = 260 }: {
  projectId: string
  width?: number | string
}) {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [projectList, setProjectList] = useState(cachedProjectList)
  const [reading, setReading] = useState(() => cachedProjectList()?.some((p) => p.id === projectId) !== true)

  useEffect(() => {
    if (cachedProjectList()?.some((p) => p.id === projectId)) return
    let cancelled = false
    // Nothing cached yet, or a cached list without the project on screen
    // (created since, M-1b): projectListFor re-reads once, then settles.
    projectListFor(projectId)
      .then((rows) => {
        if (!cancelled) setProjectList(rows)
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setReading(false)
      })
    return () => {
      cancelled = true
    }
  }, [projectId])

  const options = (projectList ?? []).map((p) => ({ value: p.id, label: p.name }))
  const listed = options.some((o) => o.value === projectId)
  const section = fieldSectionOf(pathname) ?? FIELD_SECTIONS[0]

  return (
    <Select
      aria-label="Dự án"
      {...searchSelectProps}
      style={{ width, maxWidth: '100%' }}
      value={projectId}
      loading={reading && !listed}
      onChange={(id: string) => {
        if (id !== projectId) navigate(`${APP_BASE_PATH}/gs/${id}${section.suffix}`)
      }}
      options={listed
        ? options
        : [{ value: projectId, label: cachedProjectName(projectId) ?? projectId }, ...options]}
    />
  )
}
