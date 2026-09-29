import { createElement, type ReactNode } from 'react'
import type { SelectProps } from 'antd'
import { matchesSearch } from '../lib/search'

/**
 * Every Select in the app can be searched by typing (UI-02).
 *
 * Spread these onto an antd `Select`. antd's own search compares the typed
 * text with the option label byte for byte, so "cuong" would never find
 * "Cường"; `matchesSearch` folds both sides the way a person types on a site
 * tablet. `optionFilterProp` is still named so antd's accessibility hints and
 * any caller that drops `filterOption` keep looking at the label, not at a
 * uuid value.
 */
export const NOT_FOUND_TEXT = 'Không có kết quả'

type SearchableOption = {
  label?: ReactNode
  value?: string | number | null
  /** Plain text to search when the label is a ReactNode. */
  searchKey?: string
}

/** The text a search runs against: `searchKey`, else a textual label, else the value. */
export function searchKeyOf(option: SearchableOption | undefined): string {
  if (option === undefined) return ''
  if (typeof option.searchKey === 'string') return option.searchKey
  const { label } = option
  if (typeof label === 'string' || typeof label === 'number') return String(label)
  return option.value === undefined || option.value === null ? '' : String(option.value)
}

export const searchSelectProps = {
  showSearch: true,
  optionFilterProp: 'label',
  filterOption: (input: string, option?: SearchableOption) => matchesSearch(searchKeyOf(option), input),
  notFoundContent: NOT_FOUND_TEXT,
} satisfies SelectProps

/**
 * The work switch's width, one on every screen (FLT-03): wide enough for the
 * longest work name in use (Giàn giáo, Tháo giáo) with room to grow, since the
 * works are a list that gets longer, not two fixed positions.
 */
export const WORK_SELECT_WIDTH = 180

/**
 * A select whose options read in full, spread after `searchSelectProps`: its
 * popup is at least the select's width (rc-select stretches `minWidth` when
 * `popupMatchSelectWidth` is false) and grows to the longest option, up to
 * the screen less 16 px a side; an option longer than that wraps instead of
 * ellipsising. For the field bars and sheets, where a phone's select is
 * narrower than the coat names it offers ("Blast + Co…").
 */
export const fullOptionsProps = {
  popupMatchSelectWidth: false,
  styles: { popup: { root: { maxWidth: 'calc(100vw - 32px)' } } },
  optionRender: (option: { label?: ReactNode }) =>
    createElement('span', { style: { whiteSpace: 'normal', overflowWrap: 'anywhere' } }, option.label),
} satisfies SelectProps
