import type { TablePaginationConfig } from 'antd'
import { useState } from 'react'

/** The page sizes a reader can pick from, smallest first; the first is the default. */
export const PAGE_SIZES = [10, 20, 50, 100] as const

/**
 * Pagination for every data table (UI-05), from one place so they all page
 * the same way: `pagination={tablePagination(rows.length)}`.
 *
 * `false` for a table that fits on one page: a pager under ten rows is a
 * control with nothing to do. Tables whose row ORDER is edited in place (drag
 * or arrows) do not use this at all -- antd hands `render` a page-relative
 * index, so a swap on page two would pick the wrong neighbour.
 *
 * The pager text (`/ trang`) comes from the app's antd locale (`vi_VN`).
 */
export function tablePagination(total: number): TablePaginationConfig | false {
  if (total <= PAGE_SIZES[0]) return false
  return {
    defaultPageSize: PAGE_SIZES[0],
    pageSizeOptions: [...PAGE_SIZES],
    showSizeChanger: true,
    size: 'small',
    position: ['bottomRight'],
  }
}

/** What a table is narrowed by, as one comparable value: a search, a toggle, `a|b` for several. */
export type PaginationResetKey = string | number | boolean | null

/**
 * `tablePagination` for a table whose rows a filter, search or toggle narrows
 * (UI-06): the pager goes back to page 1 whenever `resetKey` changes.
 *
 * antd only clamps an uncontrolled page to the last one, so a search typed on
 * page 3 left the reader on page 2 of the matches with the first ten hidden,
 * and clearing it jumped back to page 3. Controlled here instead. The reset
 * happens during render, React's pattern for state derived from a prop, so
 * the stale page never reaches the screen for a frame.
 */
export function useTablePagination(total: number, resetKey: PaginationResetKey): TablePaginationConfig | false {
  const [page, setPage] = useState({ current: 1, pageSize: PAGE_SIZES[0] as number })
  const [seenKey, setSeenKey] = useState(resetKey)
  let current = page.current
  if (!Object.is(seenKey, resetKey)) {
    setSeenKey(resetKey)
    setPage((p) => ({ ...p, current: 1 }))
    current = 1
  }
  const config = tablePagination(total)
  if (config === false) return false
  return {
    ...config,
    current,
    pageSize: page.pageSize,
    onChange: (next, pageSize) => setPage({ current: next, pageSize }),
  }
}
