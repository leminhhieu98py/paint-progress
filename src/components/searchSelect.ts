import { createElement, type ReactNode } from 'react'
import { Grid, type SelectProps } from 'antd'
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

/**
 * The work switch's width, one on every screen (FLT-03): wide enough for the
 * longest work name in use (Giàn giáo, Tháo giáo) with room to grow, since the
 * works are a list that gets longer, not two fixed positions.
 */
export const WORK_SELECT_WIDTH = 180

const SCREEN_LESS_GUTTERS = 'calc(100vw - 32px)'
const optionRender = (option: { label?: ReactNode }) =>
  createElement('span', { style: { whiteSpace: 'normal', overflowWrap: 'anywhere' } }, option.label)
const WIDE_OPTIONS = {
  popupMatchSelectWidth: false,
  styles: { popup: { root: { maxWidth: SCREEN_LESS_GUTTERS } } },
  optionRender,
} satisfies SelectProps

/**
 * The class every popup of `searchSelectProps` carries. `index.css` places it
 * on a phone -- the screen less 16 px a side -- by a media query, so a Select
 * in a dialog, which spreads no hook, sits like a page's (M6b).
 */
export const SELECT_POPUP_CLASS = 'pp-select-popup'

/**
 * Spread onto every Select. It also reads its options in full (M6): the popup
 * is at least the select's width and grows to the longest option, up to the
 * screen less 16 px a side, and a longer one wraps instead of ellipsising.
 * `useFullOptionsProps`, spread after it, adds the phone's placement.
 */
export const searchSelectProps = {
  showSearch: true,
  optionFilterProp: 'label',
  filterOption: (input: string, option?: SearchableOption) => matchesSearch(searchKeyOf(option), input),
  notFoundContent: NOT_FOUND_TEXT,
  ...WIDE_OPTIONS,
  classNames: { popup: { root: SELECT_POPUP_CLASS } },
} satisfies SelectProps

/**
 * A phone's popup (M3): the screen less 16 px a side, wherever its select
 * sits. Aligned to a select near an edge, the popup flipped or shifted flush
 * against the screen's edge; the trigger lets the popup's own style win over
 * the position it works out.
 */
const PHONE_OPTIONS = {
  ...WIDE_OPTIONS,
  styles: { popup: { root: { left: 16, right: 'auto', width: SCREEN_LESS_GUTTERS, maxWidth: SCREEN_LESS_GUTTERS } } },
} satisfies SelectProps

/**
 * A select whose options read in full, spread after `searchSelectProps`: its
 * popup is at least the select's width (rc-select stretches `minWidth` when
 * `popupMatchSelectWidth` is false) and grows to the longest option, up to
 * the screen less 16 px a side; on a phone (under 768 px) it spans exactly
 * that, wherever the select sits. `searchSelectProps` already carries the
 * first half (M6); this adds the phone's placement, for the field bars and
 * sheets and every work select.
 */
export function useFullOptionsProps() {
  return Grid.useBreakpoint().md ? WIDE_OPTIONS : PHONE_OPTIONS
}
