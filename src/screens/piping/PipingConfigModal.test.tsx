import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ManpowerGroup, PipingSettings, Spool, SpoolColumn } from '../../domain/piping/types'
import { renderApp } from '../../test/renderApp'
import { PipingConfigModal } from './PipingConfigModal'

const api = vi.hoisted(() => ({
  updatePipingSettings: vi.fn(),
  disablePiping: vi.fn(),
  listReinstatementEntries: vi.fn(),
  listManpowerGroups: vi.fn(),
  addManpowerGroup: vi.fn(),
  renameManpowerGroup: vi.fn(),
  setManpowerGroupHidden: vi.fn(),
  reorderManpowerGroups: vi.fn(),
  deleteManpowerGroup: vi.fn(),
  listSpoolColumns: vi.fn(),
  addSpoolColumn: vi.fn(),
  renameSpoolColumn: vi.fn(),
  deleteSpoolColumn: vi.fn(),
  reorderSpoolColumns: vi.fn(),
  listSpools: vi.fn(),
  listImportLog: vi.fn(),
}))
vi.mock('../../lib/pipingApi', () => ({
  updatePipingSettings: (...a: unknown[]) => api.updatePipingSettings(...a),
  disablePiping: (...a: unknown[]) => api.disablePiping(...a),
  listReinstatementEntries: (...a: unknown[]) => api.listReinstatementEntries(...a),
  listManpowerGroups: (...a: unknown[]) => api.listManpowerGroups(...a),
  addManpowerGroup: (...a: unknown[]) => api.addManpowerGroup(...a),
  renameManpowerGroup: (...a: unknown[]) => api.renameManpowerGroup(...a),
  setManpowerGroupHidden: (...a: unknown[]) => api.setManpowerGroupHidden(...a),
  reorderManpowerGroups: (...a: unknown[]) => api.reorderManpowerGroups(...a),
  deleteManpowerGroup: (...a: unknown[]) => api.deleteManpowerGroup(...a),
  listSpoolColumns: (...a: unknown[]) => api.listSpoolColumns(...a),
  addSpoolColumn: (...a: unknown[]) => api.addSpoolColumn(...a),
  renameSpoolColumn: (...a: unknown[]) => api.renameSpoolColumn(...a),
  deleteSpoolColumn: (...a: unknown[]) => api.deleteSpoolColumn(...a),
  reorderSpoolColumns: (...a: unknown[]) => api.reorderSpoolColumns(...a),
  listSpools: (...a: unknown[]) => api.listSpools(...a),
  listImportLog: (...a: unknown[]) => api.listImportLog(...a),
}))

const SETTINGS: PipingSettings = {
  projectId: 'p1', enabled: true, weekStartDate: '2026-09-07', totalTestPacks: 1022, lateThresholdDays: 7,
}

const GROUPS: ManpowerGroup[] = [
  { id: 'g1', name: 'Reinstatement', sort: 1, hidden: false },
  { id: 'g2', name: 'Insulation', sort: 2, hidden: true },
  { id: 'g3', name: 'Marking', sort: 3, hidden: false },
]

const COLUMNS: SpoolColumn[] = [
  { id: 'c1', label: 'Area', sort: 1 },
  { id: 'c2', label: 'Ghi chú hiện trường', sort: 2 },
]

const spool = (id: string, extra: Record<string, string>): Spool => ({
  id, seq: 1, spoolNo: id, lineNo: null, insuType: null, drawingNo: null, testPackageNo: null, paintingSystem: null,
  phPlan: null, ihPlan: null, iwPlan: null, phActual: null, ihActual: null, iwActual: null, extra,
})

const onClose = vi.fn()
const onChanged = vi.fn()
const onDisabled = vi.fn()

function renderModal() {
  return renderApp(
    <PipingConfigModal
      projectId="p1"
      projectName="BlockB1_CPPTS"
      settings={SETTINGS}
      onClose={onClose}
      onChanged={onChanged}
      onDisabled={onDisabled}
    />,
  )
}

const config = () => screen.getAllByRole('dialog')[0]
const openTab = (name: string) => userEvent.click(within(config()).getByRole('tab', { name }))
/** The ConsequenceModal on top of Cấu hình. */
const confirmDialog = () => screen.getAllByRole('dialog').at(-1) as HTMLElement
/** Its confirm button, once the spool count behind it has arrived (the button loads until then). */
const readyButton = async (name: string) => {
  const button = within(confirmDialog()).getByRole('button', { name: new RegExp(name) })
  await waitFor(() => expect(button).not.toHaveClass('ant-btn-loading'))
  return button
}
const rowOf = (text: string) => within(config()).getByText(text).closest('tr') as HTMLElement
const dragRow = (from: string, to: string) => {
  fireEvent.dragStart(rowOf(from))
  fireEvent.dragOver(rowOf(to))
  fireEvent.drop(rowOf(to))
}

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset()
  onClose.mockReset()
  onChanged.mockReset()
  onDisabled.mockReset()
  api.listReinstatementEntries.mockResolvedValue([
    { id: 'e1', day: '2026-09-10', qty: 200, createdBy: null, createdAt: null, editedBy: null, editedAt: null },
    { id: 'e2', day: '2026-09-11', qty: 35, createdBy: null, createdAt: null, editedBy: null, editedAt: null },
  ])
  api.updatePipingSettings.mockResolvedValue(undefined)
  api.disablePiping.mockResolvedValue(undefined)
  api.listManpowerGroups.mockResolvedValue(GROUPS)
  api.addManpowerGroup.mockResolvedValue({ id: 'g4', name: 'Hàn', sort: 4, hidden: false })
  api.renameManpowerGroup.mockResolvedValue(undefined)
  api.setManpowerGroupHidden.mockResolvedValue(undefined)
  api.reorderManpowerGroups.mockResolvedValue(undefined)
  api.deleteManpowerGroup.mockResolvedValue(undefined)
  api.listSpoolColumns.mockResolvedValue(COLUMNS)
  api.addSpoolColumn.mockResolvedValue({ id: 'c3', label: 'Khu', sort: 3 })
  api.renameSpoolColumn.mockResolvedValue({ spoolsUpdated: 2 })
  api.deleteSpoolColumn.mockResolvedValue({ spoolsUpdated: 2 })
  api.reorderSpoolColumns.mockResolvedValue(undefined)
  api.listSpools.mockResolvedValue([
    spool('s1', { Area: 'A1' }),
    spool('s2', { Area: 'A2', khu: 'cũ' }),
    spool('s3', { 'Ghi chú hiện trường': 'x' }),
    spool('s4', {}),
  ])
  api.listImportLog.mockResolvedValue([
    {
      id: 'l2', kind: 'spool_plan', fileName: 'cam.xlsx', rowCount: 1250, summary: {}, importedBy: 'u1',
      importedAt: '2026-10-06T03:15:00Z', importedByName: 'Đoàn Linh',
    },
    {
      id: 'l1', kind: 'reinstatement_plan', fileName: 'rein.xlsx', rowCount: 40, summary: {}, importedBy: null,
      importedAt: '2026-10-01T01:00:00Z', importedByName: null,
    },
  ])
})

describe('PipingConfigModal: sections', () => {
  it('holds Thông số, Nhóm nhân lực, Cột thêm của spool and Lịch sử import, with Tắt Piping and Đóng', async () => {
    renderModal()
    expect(within(config()).getAllByRole('tab').map((t) => t.textContent))
      .toEqual(['Thông số', 'Nhóm nhân lực', 'Cột thêm của spool', 'Lịch sử import'])
    expect(within(config()).getByRole('button', { name: 'Tắt Piping' })).toBeInTheDocument()
    await userEvent.click(within(config()).getByRole('button', { name: 'Đóng' }))
    expect(onClose).toHaveBeenCalled()
  })
})

describe('PipingConfigModal: Thông số (spec §2)', () => {
  const field = (label: string) => within(config()).getByLabelText(label)
  const save = () => userEvent.click(within(config()).getByRole('button', { name: 'Lưu thông số' }))

  it('opens on the stored settings and saves the changes', async () => {
    renderModal()
    expect(field('Ngày bắt đầu tuần')).toHaveValue('07/09/2026')
    expect(field('Tổng Test Pack')).toHaveValue('1022')
    expect(field('Ngưỡng trễ (ngày)')).toHaveValue('7')
    await userEvent.clear(field('Ngưỡng trễ (ngày)'))
    await userEvent.type(field('Ngưỡng trễ (ngày)'), '10')
    await save()
    await waitFor(() => expect(api.updatePipingSettings).toHaveBeenCalledWith('p1', {
      weekStartDate: '2026-09-07', totalTestPacks: 1022, lateThresholdDays: 10,
    }))
    expect(onChanged).toHaveBeenCalled()
  })

  it('refuses a threshold over 365 and a fractional total', async () => {
    renderModal()
    await userEvent.clear(field('Ngưỡng trễ (ngày)'))
    await userEvent.type(field('Ngưỡng trễ (ngày)'), '400')
    await save()
    expect(await within(config()).findByText('Ngưỡng trễ phải từ 0 đến 365 ngày')).toBeInTheDocument()
    expect(api.updatePipingSettings).not.toHaveBeenCalled()
  })

  it('warns when the new total is below the Test Packs already entered, and saves only on confirm', async () => {
    renderModal()
    await waitFor(() => expect(api.listReinstatementEntries).toHaveBeenCalledWith('p1'))
    await userEvent.clear(field('Tổng Test Pack'))
    await userEvent.type(field('Tổng Test Pack'), '200')
    await save()
    const warn = await waitFor(() => {
      const d = confirmDialog()
      expect(d).toHaveTextContent('235')
      return d
    })
    expect(api.updatePipingSettings).not.toHaveBeenCalled()
    await userEvent.click(within(warn).getByRole('button', { name: 'Vẫn lưu' }))
    await waitFor(() => expect(api.updatePipingSettings).toHaveBeenCalledWith('p1', {
      weekStartDate: '2026-09-07', totalTestPacks: 200, lateThresholdDays: 7,
    }))
  })

  it('warns when the total is cleared while Test Packs are entered, naming admin edits too', async () => {
    renderModal()
    await waitFor(() => expect(api.listReinstatementEntries).toHaveBeenCalled())
    await userEvent.clear(field('Tổng Test Pack'))
    await save()
    const warn = await waitFor(() => {
      const d = confirmDialog()
      expect(d).toHaveTextContent('235')
      return d
    })
    expect(warn).toHaveTextContent(/admin/)
    expect(api.updatePipingSettings).not.toHaveBeenCalled()
    await userEvent.click(within(warn).getByRole('button', { name: 'Vẫn lưu' }))
    await waitFor(() => expect(api.updatePipingSettings).toHaveBeenCalledWith('p1', {
      weekStartDate: '2026-09-07', totalTestPacks: null, lateThresholdDays: 7,
    }))
  })

  it('names admin edits in the below-total warning too (the cap holds for them, spec §4)', async () => {
    renderModal()
    await waitFor(() => expect(api.listReinstatementEntries).toHaveBeenCalled())
    await userEvent.clear(field('Tổng Test Pack'))
    await userEvent.type(field('Tổng Test Pack'), '100')
    await save()
    await waitFor(() => expect(confirmDialog()).toHaveTextContent(/admin/))
  })

  it('saves without a warning when the total is at least what was entered', async () => {
    renderModal()
    await waitFor(() => expect(api.listReinstatementEntries).toHaveBeenCalled())
    await userEvent.clear(field('Tổng Test Pack'))
    await userEvent.type(field('Tổng Test Pack'), '235')
    await save()
    await waitFor(() => expect(api.updatePipingSettings).toHaveBeenCalled())
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
  })
})

describe('PipingConfigModal: Nhóm nhân lực (spec §5, R-6)', () => {
  beforeEach(async () => {
    renderModal()
    await openTab('Nhóm nhân lực')
    await within(config()).findByText('Marking')
  })

  it('lists every group in order, hidden ones marked', () => {
    expect(within(rowOf('Insulation')).getByText('Đã ẩn')).toBeInTheDocument()
    expect(within(rowOf('Marking')).queryByText('Đã ẩn')).toBeNull()
  })

  it('adds a group at the end', async () => {
    await userEvent.type(within(config()).getByRole('textbox', { name: 'Tên nhóm mới' }), 'Hàn')
    await userEvent.click(within(config()).getByRole('button', { name: 'Thêm nhóm' }))
    await waitFor(() => expect(api.addManpowerGroup).toHaveBeenCalledWith('p1', 'Hàn', 4))
    expect(onChanged).toHaveBeenCalled()
  })

  it('renames a group in its row', async () => {
    await userEvent.click(within(rowOf('Marking')).getByRole('button', { name: 'Đổi tên nhóm' }))
    const input = within(config()).getByRole('textbox', { name: 'Tên nhóm' })
    await userEvent.clear(input)
    await userEvent.type(input, 'Đánh dấu{Enter}')
    await waitFor(() => expect(api.renameManpowerGroup).toHaveBeenCalledWith('g3', 'Đánh dấu'))
  })

  it('cancels a rename with Esc and keeps Cấu hình open', async () => {
    await userEvent.click(within(rowOf('Marking')).getByRole('button', { name: 'Đổi tên nhóm' }))
    const input = within(config()).getByRole('textbox', { name: 'Tên nhóm' })
    await userEvent.type(input, 'x')
    // With the keyCode rc-dialog's own Esc handler reads, as a browser sends it.
    fireEvent.keyDown(input, { key: 'Escape', code: 'Escape', keyCode: 27 })
    expect(within(config()).queryByRole('textbox', { name: 'Tên nhóm' })).toBeNull()
    expect(within(config()).getByText('Marking')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
    expect(api.renameManpowerGroup).not.toHaveBeenCalled()
  })

  it('shows a rename in progress while another write runs, instead of ignoring Enter', async () => {
    api.setManpowerGroupHidden.mockReturnValue(new Promise(() => {}))
    await userEvent.click(within(rowOf('Marking')).getByRole('button', { name: 'Đổi tên nhóm' }))
    await userEvent.click(within(rowOf('Reinstatement')).getByRole('button', { name: 'Ẩn nhóm' }))
    expect(within(config()).getByRole('textbox', { name: 'Tên nhóm' })).toBeDisabled()
    expect(within(config()).getByRole('button', { name: 'Lưu tên nhóm' })).toHaveClass('ant-btn-loading')
  })

  it('adds once on a double Enter', async () => {
    let finish: (g: ManpowerGroup) => void = () => {}
    api.addManpowerGroup.mockReturnValue(new Promise<ManpowerGroup>((resolve) => { finish = resolve }))
    await userEvent.type(within(config()).getByRole('textbox', { name: 'Tên nhóm mới' }), 'Hàn{Enter}{Enter}')
    expect(api.addManpowerGroup).toHaveBeenCalledTimes(1)
    finish({ id: 'g4', name: 'Hàn', sort: 4, hidden: false })
    await waitFor(() => expect(api.listManpowerGroups).toHaveBeenCalledTimes(2))
  })

  it('spins only the control being saved, not Thêm nhóm, during a row write', async () => {
    api.setManpowerGroupHidden.mockReturnValue(new Promise(() => {}))
    await userEvent.type(within(config()).getByRole('textbox', { name: 'Tên nhóm mới' }), 'Hàn')
    await userEvent.click(within(rowOf('Marking')).getByRole('button', { name: 'Ẩn nhóm' }))
    expect(within(config()).getByRole('button', { name: 'Thêm nhóm' })).not.toHaveClass('ant-btn-loading')
  })

  it('hides a shown group and shows a hidden one', async () => {
    await userEvent.click(within(rowOf('Marking')).getByRole('button', { name: 'Ẩn nhóm' }))
    await waitFor(() => expect(api.setManpowerGroupHidden).toHaveBeenCalledWith('g3', true))
    await userEvent.click(within(rowOf('Insulation')).getByRole('button', { name: 'Hiện lại nhóm' }))
    await waitFor(() => expect(api.setManpowerGroupHidden).toHaveBeenCalledWith('g2', false))
  })

  it('saves the drag order on drop, with the whole list, hidden groups included (ORD-01)', async () => {
    dragRow('Marking', 'Reinstatement')
    await waitFor(() => expect(api.reorderManpowerGroups).toHaveBeenCalledWith('p1', ['g3', 'g1', 'g2']))
  })

  it('reloads the list when a reorder is refused', async () => {
    api.reorderManpowerGroups.mockRejectedValue(new Error('Danh sách đã thay đổi, hãy tải lại trang rồi sắp xếp lại'))
    dragRow('Marking', 'Reinstatement')
    expect(await screen.findByText('Danh sách đã thay đổi, hãy tải lại trang rồi sắp xếp lại')).toBeInTheDocument()
    await waitFor(() => expect(api.listManpowerGroups).toHaveBeenCalledTimes(2))
  })

  it('deletes an unused group after a confirm', async () => {
    await userEvent.click(within(rowOf('Marking')).getByRole('button', { name: 'Xoá nhóm' }))
    await userEvent.click(within(confirmDialog()).getByRole('button', { name: 'Xoá nhóm' }))
    await waitFor(() => expect(api.deleteManpowerGroup).toHaveBeenCalledWith('g3'))
  })

  it('shows the database\'s refusal for a group with data, in the confirm', async () => {
    api.deleteManpowerGroup.mockRejectedValue(new Error('Nhóm "Marking" đã có dữ liệu, không xoá được -- hãy ẩn nhóm'))
    await userEvent.click(within(rowOf('Marking')).getByRole('button', { name: 'Xoá nhóm' }))
    await userEvent.click(within(confirmDialog()).getByRole('button', { name: 'Xoá nhóm' }))
    expect(await within(confirmDialog()).findByText(/đã có dữ liệu, không xoá được/)).toBeInTheDocument()
  })
})

describe('PipingConfigModal: Cột thêm của spool (spec §6.1)', () => {
  beforeEach(async () => {
    renderModal()
    await openTab('Cột thêm của spool')
    await within(config()).findByText('Area')
  })

  it('adds a column at the end', async () => {
    await userEvent.type(within(config()).getByRole('textbox', { name: 'Tên cột mới' }), 'Khu')
    await userEvent.click(within(config()).getByRole('button', { name: 'Thêm cột' }))
    await waitFor(() => expect(api.addSpoolColumn).toHaveBeenCalledWith('p1', 'Khu', 3))
  })

  it('renames only after a confirm that states how many spools are rewritten', async () => {
    await userEvent.click(within(rowOf('Area')).getByRole('button', { name: 'Đổi tên cột' }))
    const input = within(config()).getByRole('textbox', { name: 'Tên cột' })
    await userEvent.clear(input)
    await userEvent.type(input, 'Khu{Enter}')
    // s1 and s2 carry Area; s2 also carries "khu", which the new label replaces.
    await waitFor(() => expect(confirmDialog()).toHaveTextContent('2 spool'))
    expect(api.renameSpoolColumn).not.toHaveBeenCalled()
    await userEvent.click(await readyButton('Đổi tên cột'))
    await waitFor(() => expect(api.renameSpoolColumn).toHaveBeenCalledWith('p1', 'c1', 'Khu'))
  })

  it('cancels a rename with Esc and keeps Cấu hình open', async () => {
    await userEvent.click(within(rowOf('Area')).getByRole('button', { name: 'Đổi tên cột' }))
    const input = within(config()).getByRole('textbox', { name: 'Tên cột' })
    await userEvent.type(input, 'x')
    fireEvent.keyDown(input, { key: 'Escape', code: 'Escape', keyCode: 27 })
    expect(within(config()).queryByRole('textbox', { name: 'Tên cột' })).toBeNull()
    expect(onClose).not.toHaveBeenCalled()
  })

  it.each([
    ['a built-in header', 'SpoolNo', 'Tên cột "SpoolNo" trùng tên cột chuẩn SpoolNo'],
    ['another column\'s label in another case', ' ghi CHÚ hiện trường ', 'Cột "ghi CHÚ hiện trường" đã có trong dự án'],
  ])('refuses a rename to %s before any confirm or spool count', async (_case, label, error) => {
    await userEvent.click(within(rowOf('Area')).getByRole('button', { name: 'Đổi tên cột' }))
    const input = within(config()).getByRole('textbox', { name: 'Tên cột' })
    await userEvent.clear(input)
    await userEvent.type(input, `${label}{Enter}`)
    expect(await screen.findByText(error)).toBeInTheDocument()
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(api.listSpools).not.toHaveBeenCalled()
    expect(within(config()).getByRole('textbox', { name: 'Tên cột' })).toBeInTheDocument()
  })

  it('lets a column change only the case of its own label', async () => {
    await userEvent.click(within(rowOf('Area')).getByRole('button', { name: 'Đổi tên cột' }))
    const input = within(config()).getByRole('textbox', { name: 'Tên cột' })
    await userEvent.clear(input)
    await userEvent.type(input, 'AREA{Enter}')
    await waitFor(() => expect(api.listSpools).toHaveBeenCalled())
  })

  it('adds once on a double Enter', async () => {
    api.addSpoolColumn.mockReturnValue(new Promise(() => {}))
    await userEvent.type(within(config()).getByRole('textbox', { name: 'Tên cột mới' }), 'Khu{Enter}{Enter}')
    expect(api.addSpoolColumn).toHaveBeenCalledTimes(1)
  })

  it('deletes only after a confirm that states how many spools lose their value', async () => {
    await userEvent.click(within(rowOf('Ghi chú hiện trường')).getByRole('button', { name: 'Xoá cột' }))
    await waitFor(() => expect(confirmDialog()).toHaveTextContent('1 spool'))
    expect(api.deleteSpoolColumn).not.toHaveBeenCalled()
    await userEvent.click(await readyButton('Xoá cột'))
    await waitFor(() => expect(api.deleteSpoolColumn).toHaveBeenCalledWith('p1', 'c2'))
  })

  it('saves the drag order on drop with every column', async () => {
    dragRow('Ghi chú hiện trường', 'Area')
    await waitFor(() => expect(api.reorderSpoolColumns).toHaveBeenCalledWith('p1', ['c2', 'c1']))
  })

  it('shows a refused label from the API', async () => {
    api.addSpoolColumn.mockRejectedValue(new Error('Tên cột "SpoolNo" trùng tên cột chuẩn SpoolNo'))
    await userEvent.type(within(config()).getByRole('textbox', { name: 'Tên cột mới' }), 'SpoolNo')
    await userEvent.click(within(config()).getByRole('button', { name: 'Thêm cột' }))
    expect(await screen.findByText('Tên cột "SpoolNo" trùng tên cột chuẩn SpoolNo')).toBeInTheDocument()
  })
})

describe('PipingConfigModal: Lịch sử import (spec §8)', () => {
  it('lists the imports newest first: kind, file, rows, who, when', async () => {
    renderModal()
    await openTab('Lịch sử import')
    const first = (await within(config()).findByText('cam.xlsx')).closest('tr') as HTMLElement
    expect(within(config()).getByRole('columnheader', { name: 'Tệp' })).toBeInTheDocument()
    expect(first).toHaveTextContent('Insulation Plan')
    expect(first).toHaveTextContent('1.250')
    expect(first).toHaveTextContent('Đoàn Linh')
    const rows = within(config()).getAllByRole('row').slice(1)
    expect(rows[0]).toBe(first)
    expect(rows[1]).toHaveTextContent('Reinstatement Plan')
    expect(rows[1]).toHaveTextContent('rein.xlsx')
    expect(rows[1]).toHaveTextContent('-')
  })
})

describe('PipingConfigModal: Tắt Piping (spec §2)', () => {
  it('turns Piping off after a confirm that says the data is kept', async () => {
    renderModal()
    await userEvent.click(within(config()).getByRole('button', { name: 'Tắt Piping' }))
    expect(confirmDialog()).toHaveTextContent('Dữ liệu được giữ lại')
    expect(api.disablePiping).not.toHaveBeenCalled()
    await userEvent.click(within(confirmDialog()).getByRole('button', { name: 'Tắt Piping' }))
    await waitFor(() => expect(api.disablePiping).toHaveBeenCalledWith('p1'))
    expect(onDisabled).toHaveBeenCalled()
  })
})
