import type { TablePaginationConfig } from 'antd'

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
