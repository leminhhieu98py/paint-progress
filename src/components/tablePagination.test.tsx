import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ConfigProvider, Table } from 'antd'
import viVN from 'antd/locale/vi_VN'
import { describe, expect, it } from 'vitest'
import { PAGE_SIZES, tablePagination, useTablePagination } from './tablePagination'

const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `r${i}`, name: `Row ${i}` }))
const COLUMNS = [{ title: 'Tên', dataIndex: 'name' }]

const renderTable = (n: number) =>
  render(<Table rowKey="id" dataSource={rows(n)} columns={COLUMNS} pagination={tablePagination(n)} />)

describe('tablePagination', () => {
  it('is off for a table of ten rows or fewer', () => {
    expect(tablePagination(0)).toBe(false)
    expect(tablePagination(10)).toBe(false)
  })

  it('pages 10 at a time from the eleventh row, with 10 / 20 / 50 / 100 on offer', () => {
    const config = tablePagination(11)
    expect(config).not.toBe(false)
    expect(config).toMatchObject({
      defaultPageSize: 10,
      pageSizeOptions: [10, 20, 50, 100],
      showSizeChanger: true,
    })
    expect(PAGE_SIZES).toEqual([10, 20, 50, 100])
  })

  it('shows no pager under ten rows', () => {
    const { container } = renderTable(10)
    expect(container.querySelectorAll('.ant-table-tbody .ant-table-row')).toHaveLength(10)
    expect(container.querySelector('.ant-pagination')).toBeNull()
  })

  it('shows a pager with a size changer at eleven rows, ten of them on the first page', () => {
    const { container } = renderTable(11)
    expect(container.querySelectorAll('.ant-table-tbody .ant-table-row')).toHaveLength(10)
    expect(container.querySelector('.ant-pagination')).not.toBeNull()
    expect(container.querySelector('.ant-pagination-options')).not.toBeNull()
  })

  it('speaks Vietnamese under the app locale and sits bottom-right', () => {
    // The locale App.tsx wraps every screen in; the pager text comes from it.
    const { container, getByTitle } = render(
      <ConfigProvider locale={viVN}>
        <Table rowKey="id" dataSource={rows(11)} columns={COLUMNS} pagination={tablePagination(11)} />
      </ConfigProvider>,
    )
    expect(getByTitle('10 / trang')).toBeInTheDocument()
    const pager = container.querySelector('.ant-table-pagination')
    expect(pager).toHaveClass('ant-pagination-end')
    expect(pager?.previousElementSibling).toHaveClass('ant-table')
  })
})

/** A table whose rows are narrowed by `filter`, paged through the hook. */
function Filtered({ n, filter }: { n: number; filter: string }) {
  const data = rows(n).filter((r) => r.name.includes(filter))
  return <Table rowKey="id" dataSource={data} columns={COLUMNS} pagination={useTablePagination(data.length, filter)} />
}

describe('useTablePagination', () => {
  it('pages like tablePagination and is off at ten rows or fewer', () => {
    const { container, rerender } = render(<Filtered n={10} filter="" />)
    expect(container.querySelector('.ant-pagination')).toBeNull()
    rerender(<Filtered n={25} filter="" />)
    expect(container.querySelectorAll('.ant-table-tbody .ant-table-row')).toHaveLength(10)
    expect(container.querySelector('.ant-pagination-options')).not.toBeNull()
  })

  it('goes back to page 1 when the filter changes', async () => {
    const { rerender } = render(<Filtered n={40} filter="" />)
    await userEvent.click(screen.getByTitle('3'))
    expect(screen.getByText('Row 20')).toBeInTheDocument()
    // "Row 1" matches Row 1 and Row 10-19: eleven rows, two pages.
    rerender(<Filtered n={40} filter="Row 1" />)
    expect(screen.getByText('Row 1')).toBeInTheDocument()
    expect(screen.getByTitle('1')).toHaveClass('ant-pagination-item-active')
  })

  it('keeps the page while the filter stays the same', async () => {
    const { rerender } = render(<Filtered n={40} filter="" />)
    await userEvent.click(screen.getByTitle('3'))
    rerender(<Filtered n={40} filter="" />)
    expect(screen.getByTitle('3')).toHaveClass('ant-pagination-item-active')
  })
})
