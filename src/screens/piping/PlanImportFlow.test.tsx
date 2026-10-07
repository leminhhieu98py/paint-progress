import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { ParseResult } from '../../domain/piping/imports'
import { renderApp } from '../../test/renderApp'
import { PlanImportFlow } from './PlanImportFlow'

vi.mock('../../lib/piping/xlsx', () => ({
  readWorkbookRows: async () => [{ name: 'Plan', rows: [] }],
}))
vi.mock('../../lib/projectReport', () => ({ downloadWorkbook: vi.fn() }))

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
    await userEvent.upload(
      document.querySelector('input[type="file"]') as HTMLInputElement,
      new File(['x'], 'insu.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    )
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
})
