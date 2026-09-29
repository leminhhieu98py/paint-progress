import { Select } from 'antd'
import { searchSelectProps } from './searchSelect'

export interface ProjectOption {
  id: string
  name: string
  code: string
}

/**
 * The `Dự án` control of a filter bar (FLT-01): searchable (UI-02), named by
 * its aria-label rather than a label above it, `name (code)` per option.
 */
export function ProjectSelect({
  projects,
  value,
  onChange,
}: {
  projects: ProjectOption[]
  value: string | null
  onChange: (projectId: string) => void
}) {
  return (
    <Select
      aria-label="Dự án"
      {...searchSelectProps}
      style={{ width: 260 }}
      value={value ?? undefined}
      placeholder="Chọn dự án"
      options={projects.map((p) => ({ value: p.id, label: `${p.name} (${p.code})` }))}
      onChange={(v: string) => onChange(v)}
    />
  )
}
