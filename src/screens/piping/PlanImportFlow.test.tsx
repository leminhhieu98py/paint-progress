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
      rows: [{ id: 'a' }], fileName: 'insu.xlsx', summary: { sheet: 'Plan', warnings: 2 }, mode: 'replace',
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
    expect(preview).toHaveBeenCalledWith([{ id: 'a' }], 'replace')
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

  it('offers the template as an icon action named Tải file mẫu, and Nhập Plan as text', async () => {
    renderFlow()
    const template = screen.getByRole('button', { name: 'Tải file mẫu' })
    expect(template).toHaveClass('ant-btn-icon-only')
    expect(template).toHaveTextContent('')
    await userEvent.click(template)
    await waitFor(() => expect(download).toHaveBeenCalledWith(expect.any(Blob), 'Mau.xlsx'))
    expect(screen.getByRole('button', { name: /Nhập Plan/ })).toHaveTextContent('Nhập Plan')
  })

  it('offers no mode switch unless the caller asks for one', async () => {
    renderFlow()
    await pick()
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).queryByRole('radio', { name: 'Update Plan' })).toBeNull()
  })
})

/** RV8-5: Plan replaces, Update Plan merges; the preview follows the mode picked. */
describe('PlanImportFlow: Plan | Update Plan', () => {
  const UPDATE = {
    added: 1, changed: 2, unchanged: 0,
    lines: [{ key: 'u', change: 'changed' as const, label: '02/10/2026', from: '5', to: '6' }],
  }
  const byMode = (mode: string) => (mode === 'update' ? UPDATE : { ...PREVIEW, removed: 3 })
  const radio = (dialog: HTMLElement, name: string) => within(dialog).getByRole('radio', { name })

  it('opens on Plan, and Update Plan recomputes the preview, says what it does and commits the merge', async () => {
    const parse = vi.fn(() => parsedOf([{ id: 'a' }]))
    const preview = vi.fn((_rows: Row[], mode: string) => byMode(mode))
    const props = renderFlow({ modes: true, parse, preview })
    await pick()
    const dialog = await screen.findByRole('dialog')
    expect(radio(dialog, 'Plan')).toBeChecked()
    expect(within(dialog).getByText('Xoá Plan cũ, thay bằng file (kể cả ô trống)')).toBeInTheDocument()
    expect(within(dialog).getAllByTestId('key-facts')[0]).toHaveTextContent('3 xoá')
    expect(within(dialog).getByRole('button', { name: 'Thay thế Plan' })).toBeInTheDocument()

    await userEvent.click(within(dialog).getByText('Update Plan', { selector: '.ant-segmented-item-label' }))
    await waitFor(() => expect(radio(dialog, 'Update Plan')).toBeChecked())
    expect(parse).toHaveBeenLastCalledWith(expect.any(Array), 'update')
    expect(preview).toHaveBeenLastCalledWith([{ id: 'a' }], 'update')
    expect(within(dialog).getByText('Chỉ cập nhật ngày/spool có dữ liệu trong file, giữ nguyên phần còn lại'))
      .toBeInTheDocument()
    // No removal in an update: the count is not even offered.
    expect(within(dialog).getAllByTestId('key-facts')[0]).not.toHaveTextContent('xoá')
    expect(within(dialog).getByText('02/10/2026').closest('tr')).toHaveTextContent(/Sửa.*5.*6/)
    const consequences = within(within(dialog).getByRole('list', { name: 'Hệ quả' })).getAllByRole('listitem')
    expect(consequences[0]).toHaveTextContent('Manpower Plan được cập nhật theo 1 dòng của file, phần còn lại giữ nguyên.')

    await userEvent.click(within(dialog).getByRole('button', { name: 'Update Plan' }))
    await waitFor(() => expect(props.commit).toHaveBeenCalledWith({
      rows: [{ id: 'a' }], fileName: 'plan.xlsx', summary: { sheet: 'Plan', warnings: 0, mode: 'update' }, mode: 'update',
    }))
    expect(props.onImported).toHaveBeenCalled()
  })

  it('writes the replace mode into the log summary', async () => {
    const props = renderFlow({ modes: true })
    await pick()
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Thay thế Plan' }))
    await waitFor(() => expect(props.commit).toHaveBeenCalledWith({
      rows: [{ id: 'a' }], fileName: 'plan.xlsx', summary: { sheet: 'Plan', warnings: 0, mode: 'replace' }, mode: 'replace',
    }))
  })

  it('offers the switch on a file Plan refuses, and previews it as Update Plan', async () => {
    const parse = vi.fn((_sheets: unknown, mode: string) => (mode === 'update'
      ? parsedOf([{ id: 'a' }])
      : { ...parsedOf([]), errors: [{ row: 3, message: 'Thiếu Plan Qty' }] }))
    renderFlow({ modes: true, parse, preview: (_rows, mode) => byMode(mode) })
    await pick()
    const errors = await screen.findByRole('dialog')
    expect(within(errors).getByText('Thiếu Plan Qty')).toBeInTheDocument()
    await userEvent.click(within(errors).getByText('Update Plan', { selector: '.ant-segmented-item-label' }))
    expect(await screen.findByText('Xem trước Manpower Plan')).toBeInTheDocument()
    const dialog = screen.getAllByRole('dialog').at(-1) as HTMLElement
    expect(radio(dialog, 'Update Plan')).toBeChecked()
  })

  it('shows the warnings of the preview in place of the file ones when it gives them', async () => {
    renderFlow({
      modes: true,
      parse: () => ({ ...parsedOf([{ id: 'a' }]), warnings: [{ row: 2, message: 'Trùng trong file' }] }),
      preview: () => ({ ...UPDATE, warnings: [{ row: null, message: 'SpoolNo "A" có 2 spool sau khi cập nhật' }] }),
    })
    await pick()
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('SpoolNo "A" có 2 spool sau khi cập nhật')).toBeInTheDocument()
    expect(within(dialog).queryByText('Dòng 2: Trùng trong file')).toBeNull()
  })
})

/** RV8-6: the same flow imports an Actual file, labelled by its props; an overwrite is confirmed first. */
describe('PlanImportFlow: Import Actual', () => {
  const ACTUAL = {
    planLabel: 'Reinstatement Actual',
    templateLabel: 'Tải file mẫu Actual',
    importText: 'Import Actual',
    okText: 'Import Actual',
    leadLine: (rows: number) => `Ghi Actual của ${rows} ngày trong file, ngày không có trong file giữ nguyên.`,
  }

  it('names its template, its button, its preview and its confirm by the props, and writes on confirm', async () => {
    const props = renderFlow({ ...ACTUAL, preview: () => ({ ...PREVIEW, removed: undefined }) })
    await userEvent.click(screen.getByRole('button', { name: 'Tải file mẫu Actual' }))
    await waitFor(() => expect(download).toHaveBeenCalledWith(expect.any(Blob), 'Mau.xlsx'))
    expect(screen.getByRole('button', { name: /Import Actual/ })).toHaveTextContent('Import Actual')
    await pick()
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Xem trước Reinstatement Actual')).toBeInTheDocument()
    expect(within(dialog).queryByRole('radio')).toBeNull()
    expect(within(dialog).getAllByTestId('key-facts')[0]).not.toHaveTextContent('xoá')
    expect(within(within(dialog).getByRole('list', { name: 'Hệ quả' })).getAllByRole('listitem')[0])
      .toHaveTextContent('Ghi Actual của 1 ngày trong file, ngày không có trong file giữ nguyên.')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Import Actual' }))
    await waitFor(() => expect(props.commit).toHaveBeenCalledWith({
      rows: [{ id: 'a' }], fileName: 'plan.xlsx', summary: { sheet: 'Plan', warnings: 0 }, mode: 'replace',
    }))
    expect(await screen.findByText('Đã import Reinstatement Actual')).toBeInTheDocument()
  })

  it('confirms an overwrite in a second dialog that names the count, without a typed word, and writes once', async () => {
    const props = renderFlow({
      ...ACTUAL,
      preview: () => ({ ...PREVIEW, removed: undefined, overwrites: ['Ghi đè 2 ngày đã có số liệu'] }),
    })
    await pick()
    const preview = await screen.findByRole('dialog')
    await userEvent.click(within(preview).getByRole('button', { name: 'Import Actual' }))
    expect(props.commit).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.getAllByRole('dialog')).toHaveLength(2))
    const confirm = screen.getAllByRole('dialog').at(-1) as HTMLElement
    expect(within(confirm).getByText('Ghi đè Reinstatement Actual?')).toBeInTheDocument()
    expect(within(confirm).getByText('Ghi đè 2 ngày đã có số liệu')).toBeInTheDocument()
    expect(within(confirm).queryByRole('textbox')).toBeNull()
    await userEvent.dblClick(within(confirm).getByRole('button', { name: 'Import Actual' }))
    await waitFor(() => expect(props.onImported).toHaveBeenCalledTimes(1))
    expect(props.commit).toHaveBeenCalledTimes(1)
  })
})

describe('PlanImportFlow: switching back', () => {
  it('drops a slow Update Plan preview when Plan is picked again before it lands', async () => {
    let land: (p: unknown) => void = () => {}
    const preview = vi.fn((_rows: Row[], mode: string) => (mode === 'update'
      ? new Promise((resolve) => { land = resolve })
      : PREVIEW)) as PlanImportFlowProps<Row>['preview']
    renderFlow({ modes: true, preview })
    await pick()
    const dialog = await screen.findByRole('dialog')
    const label = (name: string) => within(dialog).getByText(name, { selector: '.ant-segmented-item-label' })
    await userEvent.click(label('Update Plan'))
    await userEvent.click(label('Plan'))
    land({ added: 9, changed: 0, unchanged: 0, lines: [] })
    await waitFor(() => expect(within(dialog).getByRole('radio', { name: 'Plan' })).toBeChecked())
    expect(within(dialog).getAllByTestId('key-facts')[0]).toHaveTextContent('1 thêm')
    expect(within(dialog).getByRole('button', { name: 'Thay thế Plan' })).toBeEnabled()
  })
})
