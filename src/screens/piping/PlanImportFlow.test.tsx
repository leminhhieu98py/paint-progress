import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ParseResult } from '../../domain/piping/imports'
import { renderApp } from '../../test/renderApp'
import { PlanImportFlow, type PlanImportFlowProps } from './PlanImportFlow'

const read = vi.hoisted(() => vi.fn())
vi.mock('../../lib/piping/xlsx', () => ({
  readWorkbookRows: (file: unknown) => read(file),
}))
const download = vi.hoisted(() => vi.fn())
vi.mock('../../lib/projectReport', () => ({ downloadWorkbook: (...a: unknown[]) => download(...a) }))

type Row = { id: string }

const parsedOf = (rows: Row[]): ParseResult<Row> => ({
  sheetName: 'Plan', rows, rowCount: rows.length, errors: [], warnings: [],
})

const PREVIEW = {
  added: 1, changed: 0, removed: 0, unchanged: 0,
  lines: [{ key: 'a', change: 'added' as const, label: '01/10/2026', from: null, to: '5' }],
}

function renderFlow(over: Partial<PlanImportFlowProps<Row>> = {}) {
  const props: PlanImportFlowProps<Row> = {
    planLabel: 'Manpower Plan',
    templateName: 'Mau.xlsx',
    buildTemplate: async () => new Blob(['t']),
    parse: () => parsedOf([{ id: 'a' }]),
    preview: () => PREVIEW,
    lineHeader: 'Ngày',
    commit: vi.fn().mockResolvedValue(undefined),
    onImported: vi.fn(),
    ...over,
  }
  renderApp(<PlanImportFlow<Row> {...props} />)
  return props
}

const fileInput = () => document.querySelector('input[type="file"]') as HTMLInputElement
const pick = (name = 'plan.xlsx') => userEvent.upload(
  fileInput(),
  new File(['x'], name, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
)

beforeEach(() => {
  read.mockReset()
  read.mockResolvedValue([{ name: 'Plan', rows: [] }])
  download.mockReset()
})

/**
 * The shared flow's own surface, beyond what the Reinstatement panel's suite
 * drives: parse warnings (which never block) and the caller's consequences,
 * for the Manpower and Insulation imports that produce them.
 */
describe('PlanImportFlow', () => {
  it('shows the warnings and the caller consequences, and still imports on confirm', async () => {
    const parsed: ParseResult<{ id: string }> = {
      sheetName: 'Plan',
      rows: [{ id: 'a' }],
      rowCount: 1,
      errors: [],
      warnings: [{ row: 4, message: 'SpoolNo trùng' }, { row: null, message: 'Thiếu cột LineNo' }],
    }
    const commit = vi.fn().mockResolvedValue(undefined)
    const onImported = vi.fn()
    renderApp(
      <PlanImportFlow<{ id: string }>
        planLabel="Insulation Plan"
        templateName="Mau.xlsx"
        buildTemplate={async () => new Blob()}
        parse={() => parsed}
        preview={() => ({
          added: 0, changed: 0, removed: 1, unchanged: 0,
          lines: [{ key: 's1', change: 'removed', label: 'SP-1', from: 'có', to: null }],
          consequences: ['1 spool bị xoá cùng ngày thực tế của nó.'],
        })}
        lineHeader="SpoolNo"
        lineAlign="left"
        commit={commit}
        onImported={onImported}
      />,
    )
    await pick('insu.xlsx')
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('2 cảnh báo')).toBeInTheDocument()
    expect(within(dialog).getByText('Dòng 4: SpoolNo trùng')).toBeInTheDocument()
    expect(within(dialog).getByText('Thiếu cột LineNo')).toBeInTheDocument()
    const consequences = within(within(dialog).getByRole('list', { name: 'Hệ quả' })).getAllByRole('listitem')
    expect(consequences.map((li) => li.textContent)).toEqual([
      'Insulation Plan hiện tại được thay toàn bộ bằng 1 dòng của file.',
      '1 spool bị xoá cùng ngày thực tế của nó.',
      'Lần import được ghi vào lịch sử import.',
    ])
    await userEvent.click(within(dialog).getByRole('button', { name: 'Thay thế Plan' }))
    await waitFor(() => expect(commit).toHaveBeenCalledWith({
      rows: [{ id: 'a' }], fileName: 'insu.xlsx', summary: { sheet: 'Plan', warnings: 2 },
    }))
    expect(onImported).toHaveBeenCalled()
  })

  it('flags a line and says the caller dangers in the danger tone, with a danger confirm', async () => {
    renderFlow({
      preview: () => ({
        added: 0, changed: 0, removed: 1, unchanged: 0,
        lines: [{ key: 'r', change: 'removed', label: 'SP-2', from: 'L1', to: null, flag: 'có Actual' }],
        consequences: ['1 spool không có trong file bị xoá.'],
        dangers: ['1 spool bị xoá cùng ngày Actual đã nhập: SP-2.'],
      }),
    })
    await pick()
    const dialog = await screen.findByRole('dialog')
    const row = within(dialog).getByText('SP-2').closest('tr') as HTMLElement
    // The flag reads as a loss, not as the row's own Xoá pill (warn).
    expect(within(row).getByText('có Actual')).toHaveStyle({ color: '#B42318' })
    const danger = within(within(dialog).getByRole('list', { name: 'Hệ quả' }))
      .getByText('1 spool bị xoá cùng ngày Actual đã nhập: SP-2.')
    expect(danger).toHaveStyle({ color: '#B42318' })
    expect(within(dialog).getByRole('button', { name: /Thay thế Plan/ })).toHaveClass('ant-btn-dangerous')
  })

  it('asks to type XOÁ before a replace that deletes actuals, and replaces once', async () => {
    const props = renderFlow({
      preview: () => ({ ...PREVIEW, dangers: ['1 spool bị xoá cùng ngày Actual đã nhập: SP-2.'] }),
    })
    await pick()
    const preview = await screen.findByRole('dialog')
    await userEvent.click(within(preview).getByRole('button', { name: /Thay thế Plan/ }))
    // The click alone writes nothing: a second dialog names the loss and wants XOÁ typed.
    expect(props.commit).not.toHaveBeenCalled()
    const box = await screen.findByLabelText('Gõ XOÁ để xác nhận')
    const confirm = screen.getAllByRole('dialog').at(-1) as HTMLElement
    expect(within(confirm).getByText('1 spool bị xoá cùng ngày Actual đã nhập: SP-2.')).toBeInTheDocument()
    const ok = within(confirm).getByRole('button', { name: /Thay thế Plan/ })
    expect(ok).toBeDisabled()
    await userEvent.type(box, 'XOÁ')
    await userEvent.dblClick(ok)
    await waitFor(() => expect(props.onImported).toHaveBeenCalledTimes(1))
    expect(props.commit).toHaveBeenCalledTimes(1)
  })

  it('waits for a preview the caller computes asynchronously', async () => {
    const preview = vi.fn().mockResolvedValue({ ...PREVIEW, added: 3 })
    renderFlow({ preview })
    await pick()
    const dialog = await screen.findByRole('dialog')
    await waitFor(() => expect(within(dialog).getAllByTestId('key-facts')[0]).toHaveTextContent('3 thêm'))
    expect(preview).toHaveBeenCalledWith([{ id: 'a' }])
  })

  it('refuses the file when the preview cannot be computed, and writes nothing', async () => {
    const props = renderFlow({ preview: () => Promise.reject(new Error('Mất kết nối')) })
    await pick()
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Mất kết nối')).toBeInTheDocument()
    expect(props.commit).not.toHaveBeenCalled()
  })

  it('lists 200 warnings at most, then says how many more', async () => {
    const warnings = Array.from({ length: 205 }, (_, i) => ({ row: i + 2, message: `Cảnh báo ${i + 1}` }))
    renderFlow({ parse: () => ({ ...parsedOf([{ id: 'a' }]), warnings }) })
    await pick()
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Dòng 201: Cảnh báo 200')).toBeInTheDocument()
    expect(within(dialog).queryByText('Dòng 202: Cảnh báo 201')).toBeNull()
    expect(within(dialog).getByText('và 5 cảnh báo khác')).toBeInTheDocument()
  })

  it('keeps the confirm plain when there is no danger', async () => {
    renderFlow()
    await pick()
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('button', { name: /Thay thế Plan/ })).not.toHaveClass('ant-btn-dangerous')
  })

  it('refuses a file with no data rows as an error and writes nothing', async () => {
    const props = renderFlow({ parse: () => parsedOf([]) })
    await pick()
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Không import được plan.xlsx')).toBeInTheDocument()
    expect(within(dialog).getByText('File không có dòng dữ liệu nào')).toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: 'Thay thế Plan' })).toBeNull()
    expect(props.commit).not.toHaveBeenCalled()
  })

  it('replaces once however often Thay thế Plan is hit while the replace runs', async () => {
    let finish: () => void = () => {}
    const commit = vi.fn(() => new Promise<void>((resolve) => { finish = resolve }))
    const props = renderFlow({ commit })
    await pick()
    const dialog = await screen.findByRole('dialog')
    // Two native clicks in one task, outside act: the second lands before the
    // button's loading state has blocked clicks (antd syncs it in an effect).
    const confirm = within(dialog).getByRole('button', { name: /Thay thế Plan/ })
    confirm.click()
    confirm.click()
    expect(commit).toHaveBeenCalledTimes(1)
    finish()
    await waitFor(() => expect(props.onImported).toHaveBeenCalledTimes(1))
    expect(commit).toHaveBeenCalledTimes(1)
  })

  it('takes no second file while the first is being read', async () => {
    let finish: (sheets: unknown) => void = () => {}
    read.mockImplementation(() => new Promise((resolve) => { finish = resolve }))
    renderFlow()
    await pick()
    await waitFor(() => expect(fileInput()).toBeDisabled())
    finish([{ name: 'Plan', rows: [] }])
    await screen.findByRole('dialog')
    expect(fileInput()).not.toBeDisabled()
  })

  it('offers the template as an icon action named Tải file mẫu, and Import Plan as text', async () => {
    renderFlow()
    const template = screen.getByRole('button', { name: 'Tải file mẫu' })
    expect(template).toHaveClass('ant-btn-icon-only')
    expect(template).toHaveTextContent('')
    await userEvent.click(template)
    await waitFor(() => expect(download).toHaveBeenCalledWith(expect.any(Blob), 'Mau.xlsx'))
    expect(screen.getByRole('button', { name: /Import Plan/ })).toHaveTextContent('Import Plan')
  })
})
