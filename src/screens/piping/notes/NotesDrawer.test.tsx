import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { formatDateTimeVN } from '../../../lib/format'
import type { NoteAnchor, PipingNoteEntry } from '../../../lib/pipingApi'
import { expectNoSpecIds } from '../../../test/copy'
import { renderApp } from '../../../test/renderApp'
import { NotesDrawer } from './NotesDrawer'

const api = vi.hoisted(() => ({ addNote: vi.fn(), updateNote: vi.fn(), deleteNote: vi.fn() }))
vi.mock('../../../lib/pipingApi', () => ({
  addNote: (...a: unknown[]) => api.addNote(...a),
  updateNote: (...a: unknown[]) => api.updateNote(...a),
  deleteNote: (...a: unknown[]) => api.deleteNote(...a),
}))

const ANCHOR: NoteAnchor = { target: 'reinstatement_day', day: '2026-10-01' }
const note = (id: string, over: Partial<PipingNoteEntry> = {}): PipingNoteEntry => ({
  id, target: 'reinstatement_day', day: '2026-10-01', spoolId: null, body: `Nội dung ${id}`, authorId: 'u1',
  createdAt: '2026-10-01T01:00:00Z', updatedBy: null, updatedAt: '2026-10-01T01:00:00Z', authorName: 'Đoàn Linh',
  updatedByName: null, ...over,
})
const NOTES = [
  note('n2', { createdAt: '2026-10-02T03:00:00Z', updatedBy: 'u2', updatedAt: '2026-10-03T04:00:00Z', updatedByName: 'Admin B' }),
  note('n1'),
]

const handlers = { onClose: vi.fn(), onChanged: vi.fn(), onRetry: vi.fn() }
const renderDrawer = (over: { notes?: PipingNoteEntry[]; error?: string | null } = {}) => renderApp(
  <NotesDrawer
    projectId="p1"
    title="Ghi chú Reinstatement 01/10/2026"
    anchor={ANCHOR}
    notes={over.notes ?? NOTES}
    error={over.error ?? null}
    {...handlers}
  />,
)
const drawer = () => screen.getByText('Ghi chú Reinstatement 01/10/2026').closest('.ant-drawer-content') as HTMLElement
const items = () => within(drawer()).getAllByTestId('piping-note')

beforeEach(() => {
  vi.clearAllMocks()
  api.addNote.mockResolvedValue(note('n3'))
  api.updateNote.mockResolvedValue(undefined)
  api.deleteNote.mockResolvedValue(undefined)
})

describe('NotesDrawer (spec §9)', () => {
  it('lists the notes as given, newest first, with author, time and who edited', () => {
    renderDrawer()
    expect(items().map((i) => within(i).getByTestId('piping-note-body').textContent)).toEqual(['Nội dung n2', 'Nội dung n1'])
    expect(within(items()[0]).getByText('Đoàn Linh')).toBeInTheDocument()
    expect(within(items()[0]).getByText(formatDateTimeVN('2026-10-02T03:00:00Z'))).toBeInTheDocument()
    expect(within(items()[0]).getByText(`Sửa bởi Admin B · ${formatDateTimeVN('2026-10-03T04:00:00Z')}`)).toBeInTheDocument()
    expect(within(items()[1]).queryByText(/Sửa bởi/)).toBeNull()
    expectNoSpecIds()
  })

  it('says when the target has no note yet', () => {
    renderDrawer({ notes: [] })
    expect(within(drawer()).getByText('Chưa có ghi chú')).toBeInTheDocument()
  })

  it('adds a note on its target and clears the box', async () => {
    const user = userEvent.setup()
    renderDrawer()
    const add = within(drawer()).getByRole('button', { name: 'Thêm ghi chú' })
    expect(add).toBeDisabled()
    const box = within(drawer()).getByRole('textbox', { name: 'Ghi chú mới' })
    await user.type(box, '  Mưa, nghỉ  ')
    await user.click(add)
    expect(api.addNote).toHaveBeenCalledWith('p1', ANCHOR, 'Mưa, nghỉ')
    await waitFor(() => expect(handlers.onChanged).toHaveBeenCalledTimes(1))
    expect(box).toHaveValue('')
  })

  it('shows why a note was not added', async () => {
    api.addNote.mockRejectedValue(new Error('Bạn không có quyền'))
    const user = userEvent.setup()
    renderDrawer()
    await user.type(within(drawer()).getByRole('textbox', { name: 'Ghi chú mới' }), 'X')
    await user.click(within(drawer()).getByRole('button', { name: 'Thêm ghi chú' }))
    expect(await within(drawer()).findByText('Bạn không có quyền')).toBeInTheDocument()
    expect(handlers.onChanged).not.toHaveBeenCalled()
  })

  it('adds once on a double click', async () => {
    let finish: (v: unknown) => void = () => {}
    api.addNote.mockReturnValue(new Promise((resolve) => { finish = resolve }))
    const user = userEvent.setup()
    renderDrawer()
    await user.type(within(drawer()).getByRole('textbox', { name: 'Ghi chú mới' }), 'Một lần')
    await user.dblClick(within(drawer()).getByRole('button', { name: /Thêm ghi chú/ }))
    finish(note('n3'))
    await waitFor(() => expect(handlers.onChanged).toHaveBeenCalledTimes(1))
    expect(api.addNote).toHaveBeenCalledTimes(1)
  })

  it('keeps Thêm ghi chú off while a note is being edited', async () => {
    const user = userEvent.setup()
    renderDrawer()
    await user.type(within(drawer()).getByRole('textbox', { name: 'Ghi chú mới' }), 'Mới')
    await user.click(within(items()[0]).getByRole('button', { name: 'Sửa ghi chú' }))
    expect(within(drawer()).getByRole('button', { name: 'Thêm ghi chú' })).toBeDisabled()
  })

  it('keeps the edit open with the reason when saving fails', async () => {
    api.updateNote.mockRejectedValue(new Error('Không lưu được'))
    const user = userEvent.setup()
    renderDrawer()
    await user.click(within(items()[0]).getByRole('button', { name: 'Sửa ghi chú' }))
    await user.click(within(items()[0]).getByRole('button', { name: 'Lưu ghi chú' }))
    expect(await within(drawer()).findByText('Không lưu được')).toBeInTheDocument()
    expect(within(items()[0]).getByRole('textbox', { name: 'Sửa ghi chú' })).toBeInTheDocument()
    expect(handlers.onChanged).not.toHaveBeenCalled()
  })

  it('keeps the delete confirm open with the reason when deleting fails', async () => {
    api.deleteNote.mockRejectedValue(new Error('Không xoá được'))
    const user = userEvent.setup()
    renderDrawer()
    await user.click(within(items()[0]).getByRole('button', { name: 'Xoá ghi chú' }))
    const confirm = (await screen.findByText('Xoá ghi chú?')).closest('.ant-modal') as HTMLElement
    await user.click(within(confirm).getByRole('button', { name: 'Xoá' }))
    expect(await within(confirm).findByText('Không xoá được')).toBeInTheDocument()
    expect(within(confirm).getByRole('button', { name: 'Xoá' })).toBeEnabled()
    expect(handlers.onChanged).not.toHaveBeenCalled()
  })

  it('edits a note in place', async () => {
    const user = userEvent.setup()
    renderDrawer()
    await user.click(within(items()[1]).getByRole('button', { name: 'Sửa ghi chú' }))
    const box = within(items()[1]).getByRole('textbox', { name: 'Sửa ghi chú' })
    expect(box).toHaveValue('Nội dung n1')
    await user.clear(box)
    await user.type(box, 'Đã sửa')
    await user.click(within(items()[1]).getByRole('button', { name: 'Lưu ghi chú' }))
    expect(api.updateNote).toHaveBeenCalledWith('n1', 'Đã sửa')
    await waitFor(() => expect(handlers.onChanged).toHaveBeenCalledTimes(1))
    expect(within(items()[1]).queryByRole('textbox')).toBeNull()
  })

  it('cancels an edit without saving', async () => {
    const user = userEvent.setup()
    renderDrawer()
    await user.click(within(items()[0]).getByRole('button', { name: 'Sửa ghi chú' }))
    await user.click(within(items()[0]).getByRole('button', { name: 'Huỷ sửa' }))
    expect(within(items()[0]).queryByRole('textbox')).toBeNull()
    expect(api.updateNote).not.toHaveBeenCalled()
  })

  it('deletes a note after a confirm', async () => {
    const user = userEvent.setup()
    renderDrawer()
    await user.click(within(items()[0]).getByRole('button', { name: 'Xoá ghi chú' }))
    expect(api.deleteNote).not.toHaveBeenCalled()
    const confirm = (await screen.findByText('Xoá ghi chú?')).closest('.ant-modal') as HTMLElement
    await user.click(within(confirm).getByRole('button', { name: 'Xoá' }))
    expect(api.deleteNote).toHaveBeenCalledWith('n2')
    await waitFor(() => expect(handlers.onChanged).toHaveBeenCalledTimes(1))
  })

  const closeDrawer = () => userEvent.click(within(drawer()).getByRole('button', { name: 'Close' }))

  it('closes at once with nothing typed', async () => {
    renderDrawer()
    await closeDrawer()
    expect(handlers.onClose).toHaveBeenCalledTimes(1)
  })

  it('asks before closing over an unsent note, and stays open on cancel', async () => {
    renderDrawer()
    await userEvent.type(within(drawer()).getByRole('textbox', { name: 'Ghi chú mới' }), 'Chưa gửi')
    await closeDrawer()
    expect(handlers.onClose).not.toHaveBeenCalled()
    const confirm = (await screen.findByText('Đóng ghi chú?')).closest('.ant-modal') as HTMLElement
    await userEvent.click(within(confirm).getByRole('button', { name: 'Huỷ' }))
    expect(handlers.onClose).not.toHaveBeenCalled()
    expect(within(drawer()).getByRole('textbox', { name: 'Ghi chú mới' })).toHaveValue('Chưa gửi')
  })

  it('asks before closing over a changed edit, and closes on confirm', async () => {
    renderDrawer()
    await userEvent.click(within(items()[0]).getByRole('button', { name: 'Sửa ghi chú' }))
    await userEvent.type(within(items()[0]).getByRole('textbox', { name: 'Sửa ghi chú' }), ' thêm')
    await closeDrawer()
    const confirm = (await screen.findByText('Đóng ghi chú?')).closest('.ant-modal') as HTMLElement
    await userEvent.click(within(confirm).getByRole('button', { name: 'Vẫn đóng' }))
    expect(handlers.onClose).toHaveBeenCalledTimes(1)
  })

  it('says a failed read and retries it', async () => {
    const user = userEvent.setup()
    renderDrawer({ notes: [], error: 'mất mạng' })
    expect(within(drawer()).getByText('Không tải được ghi chú')).toBeInTheDocument()
    await user.click(within(drawer()).getByRole('button', { name: 'Thử lại' }))
    expect(handlers.onRetry).toHaveBeenCalledTimes(1)
  })
})
