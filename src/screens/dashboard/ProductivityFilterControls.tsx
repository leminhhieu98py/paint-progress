import { DatePicker, Select } from 'antd'
import { WORK_SELECT_WIDTH, fullOptionsProps, searchSelectProps } from '../../components/searchSelect'
import { resolveWork, workLabel, type ProductivityFilters } from './productivityFilters'

/**
 * The Năng suất controls of the filter bar, after Dự án (FLT-01): the work
 * (scope), then Sàn, then the dates. Unlabelled on screen, each named by its
 * aria-label. The work is a searchable select (FLT-03), and only appears when
 * there is more than one work.
 */
export function ProductivityFilterControls({
  workNames,
  deckNames,
  value,
  onChange,
  block = false,
}: {
  workNames: string[]
  deckNames: string[]
  value: ProductivityFilters
  onChange: (next: ProductivityFilters) => void
  /** Each control full width, as the phone's sheet stacks them (FLT-04). */
  block?: boolean
}) {
  return (
    <>
      {workNames.length > 1 && (
        <Select
          aria-label="Công việc"
          {...searchSelectProps}
          {...fullOptionsProps}
          style={{ width: block ? '100%' : WORK_SELECT_WIDTH }}
          value={resolveWork(value.work, workNames)}
          onChange={(work: string) => onChange({ ...value, work })}
          options={workNames.map((name) => ({ label: workLabel(name), value: name }))}
        />
      )}
      <Select
        aria-label="Sàn"
        {...searchSelectProps}
        {...fullOptionsProps}
        style={{ width: block ? '100%' : 220 }}
        value={value.deck}
        onChange={(deck: string) => onChange({ ...value, deck })}
        options={[{ value: '', label: 'Tất cả sàn' }, ...deckNames.map((name) => ({ value: name, label: name }))]}
      />
      <DatePicker.RangePicker
        allowEmpty={[true, true]}
        format="DD/MM/YYYY"
        placeholder={['Từ ngày', 'Đến ngày']}
        style={block ? { width: '100%' } : undefined}
        value={value.range}
        onCalendarChange={(dates) => onChange({ ...value, range: [dates?.[0] ?? null, dates?.[1] ?? null] })}
      />
    </>
  )
}
