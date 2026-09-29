import { Select } from 'antd'
import { fullOptionsProps, searchSelectProps } from '../../components/searchSelect'
import { ALL, resolveCoat, type KpiFilters } from './kpiFilters'

/**
 * The KPI controls of the filter bar, after Dự án (FLT-01): Sàn, then Công
 * đoạn. Unlabelled on screen, each named by its aria-label. A new deck starts
 * its coats over, so a coat the deck does not have is never left selected.
 */
export function KpiFilterControls({
  decks,
  coats,
  value,
  onChange,
  block = false,
}: {
  decks: { id: string; name: string }[]
  /** The Công đoạn options of the chosen deck, from `kpiCoatOptions`. */
  coats: { value: string; label: string }[]
  value: KpiFilters
  onChange: (next: KpiFilters) => void
  /** Each control full width, as the phone's sheet stacks them (FLT-04). */
  block?: boolean
}) {
  return (
    <>
      <Select
        aria-label="Sàn"
        {...searchSelectProps}
        {...fullOptionsProps}
        style={{ width: block ? '100%' : 220 }}
        value={value.deckId}
        onChange={(deckId: string) => onChange({ deckId, coat: ALL })}
        options={[{ value: ALL, label: 'Tất cả sàn' }, ...decks.map((d) => ({ value: d.id, label: d.name }))]}
      />
      <Select
        aria-label="Công đoạn"
        {...searchSelectProps}
        {...fullOptionsProps}
        style={{ width: block ? '100%' : 240 }}
        value={resolveCoat(value.coat, coats)}
        onChange={(coat: string) => onChange({ ...value, coat })}
        options={[{ value: ALL, label: 'Tất cả công đoạn' }, ...coats]}
      />
    </>
  )
}
