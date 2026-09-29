import { DatePicker, Select } from 'antd'
import { WORK_SELECT_WIDTH, searchSelectProps } from '../../components/searchSelect'
import { resolveWork, type ProductivityFilters } from './productivityFilters'

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
}: {
  workNames: string[]
  deckNames: string[]
  value: ProductivityFilters
  onChange: (next: ProductivityFilters) => void
}) {
  return (
    <>
      {workNames.length > 1 && (
        <Select
          aria-label="Công việc"
          {...searchSelectProps}
          style={{ width: WORK_SELECT_WIDTH }}
          value={resolveWork(value.work, workNames)}
          onChange={(work: string) => onChange({ ...value, work })}
          options={workNames.map((name) => ({ label: name === '' ? '(không rõ công việc)' : name, value: name }))}
        />
      )}
      <Select
        aria-label="Sàn"
        {...searchSelectProps}
        style={{ width: 220 }}
        value={value.deck}
        onChange={(deck: string) => onChange({ ...value, deck })}
        options={[{ value: '', label: 'Tất cả sàn' }, ...deckNames.map((name) => ({ value: name, label: name }))]}
      />
      <DatePicker.RangePicker
        allowEmpty={[true, true]}
        format="DD/MM/YYYY"
        placeholder={['Từ ngày', 'Đến ngày']}
        value={value.range}
        onCalendarChange={(dates) => onChange({ ...value, range: [dates?.[0] ?? null, dates?.[1] ?? null] })}
      />
    </>
  )
}
