import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { NoteThread } from './NoteThread'
import type { CellNote } from '../lib/progressApi'

const note = (over: Partial<CellNote> = {}): CellNote => ({
  id: 1,
  at: '2026-08-29T11:47:00Z',
  stageName: 'Coat 2',
  note: 'Bề mặt còn ẩm',
  byName: 'Lê Trung Hiếu',
  byUsername: 'gs.hieu',
  byId: 'u1',
  reportNote: null,
  reportHidden: false,
  reportEditedByName: null,
  reportEditedAt: null,
  ...over,
})

describe('NoteThread', () => {
  it('says the bay has nothing rather than showing an empty box', () => {
    render(<NoteThread notes={[]} />)
    expect(screen.getByText('Ô này chưa có ghi chú nào')).toBeInTheDocument()
  })

  it('names the coat each note was recorded against', () => {
    // "Bề mặt còn ẩm" against Blast + Coat 1 and against Tháo giáo are
    // different problems. Without the coat a thread is a pile of sentences.
    render(
      <NoteThread
        notes={[
          note({ id: 2, stageName: 'Tháo giáo', note: 'Chờ cẩu' }),
          note({ id: 1, stageName: 'Blast + Coat 1' }),
        ]}
      />,
    )
    expect(screen.getByText('Tháo giáo')).toBeInTheDocument()
    expect(screen.getByText('Blast + Coat 1')).toBeInTheDocument()
  })

  it('keeps the order it was given, newest first', () => {
    render(
      <NoteThread
        notes={[note({ id: 2, note: 'Mới nhất' }), note({ id: 1, note: 'Cũ hơn' })]}
      />,
    )
    const entries = within(screen.getByTestId('note-thread')).getAllByText(/nhất|hơn/)
    expect(entries.map((e) => e.textContent)).toEqual(['Mới nhất', 'Cũ hơn'])
  })

  it('marks the one the drawing is actually showing', () => {
    render(
      <NoteThread
        notes={[note({ id: 2, note: 'Mới nhất' }), note({ id: 1, note: 'Cũ hơn' })]}
        current="Mới nhất"
      />,
    )
    expect(screen.getByText('Đang hiện trên bản vẽ')).toBeInTheDocument()
  })

  it('marks nothing when the bay\'s current note was cleared', () => {
    // A later stage change with no remark empties cells.note while the history
    // keeps the older ones. Marking one of those "current" would be a lie about
    // what the bay says now.
    render(<NoteThread notes={[note({ note: 'Cũ' })]} current="" />)
    expect(screen.queryByText('Đang hiện trên bản vẽ')).toBeNull()
  })

  it('shows a note whose author is no longer readable', () => {
    // profiles sits behind RLS and an account can be switched off. Losing the
    // name must not lose the note.
    render(<NoteThread notes={[note({ byName: null, byUsername: null })]} />)
    expect(screen.getByText('Bề mặt còn ẩm')).toBeInTheDocument()
    expect(screen.getByText('Không rõ người ghi')).toBeInTheDocument()
  })

  it('says so when a bay was put back to not started', () => {
    render(<NoteThread notes={[note({ stageName: null, note: 'Sơn hỏng, làm lại' })]} />)
    expect(screen.getByText('Trả về chưa bắt đầu')).toBeInTheDocument()
  })
})

describe('NoteThread — the report copy (0023)', () => {
  const edited = {
    reportEditedByName: 'Đoàn Công Linh',
    reportEditedAt: '2026-09-02T03:00:00Z',
  }
  const STAMP = /Đoàn Công Linh · \d{2}\.\d{2}\.\d{4} \d{2}:\d{2}/

  it('shows the report version beside the original, with who set it and when', () => {
    // The foreman's sentence is never replaced on screen. The admin's version
    // is a second thing, labelled as the one the XLSX will print.
    render(
      <NoteThread
        notes={[note({ reportNote: 'Bề mặt ẩm, đã sơn lại ngày sau', ...edited })]}
      />,
    )
    expect(screen.getByText('Bề mặt còn ẩm')).toBeInTheDocument()
    expect(screen.getByText('Bản cho báo cáo')).toBeInTheDocument()
    expect(screen.getByText('Bề mặt ẩm, đã sơn lại ngày sau')).toBeInTheDocument()
    expect(screen.getByText(STAMP)).toHaveTextContent(/^Sửa bởi /)
  })

  it('flags a note kept out of the report, and still shows it', () => {
    render(<NoteThread notes={[note({ reportHidden: true, ...edited })]} />)
    expect(screen.getByText('Bề mặt còn ẩm')).toBeInTheDocument()
    expect(screen.getByText(STAMP)).toHaveTextContent(/^Ẩn khỏi báo cáo · /)
  })

  it('shows neither block nor flag on a note nobody has touched', () => {
    render(<NoteThread notes={[note()]} />)
    expect(screen.queryByText('Bản cho báo cáo')).toBeNull()
    expect(screen.queryByText(/Ẩn khỏi báo cáo/)).toBeNull()
  })

  it('offers no report actions unless handed the handlers', () => {
    // The GS modal and the admin's Xem mode render this without them, and
    // neither may write anything.
    render(<NoteThread notes={[note()]} />)
    expect(screen.queryByRole('button', { name: /báo cáo/ })).toBeNull()
  })

  it('offers the two report actions per note when handed the handlers', async () => {
    const onEditReport = vi.fn()
    const onToggleHidden = vi.fn()
    const n = note({ id: 7 })
    render(<NoteThread notes={[n]} onEditReport={onEditReport} onToggleHidden={onToggleHidden} />)

    await userEvent.click(screen.getByRole('button', { name: 'Sửa cho báo cáo' }))
    expect(onEditReport).toHaveBeenCalledWith(n)
    await userEvent.click(screen.getByRole('button', { name: 'Ẩn khỏi báo cáo' }))
    expect(onToggleHidden).toHaveBeenCalledWith(n)
  })

  it('offers to bring a hidden note back, since hiding is reversible', () => {
    render(
      <NoteThread
        notes={[note({ reportHidden: true, ...edited })]}
        onEditReport={vi.fn()}
        onToggleHidden={vi.fn()}
      />,
    )
    expect(screen.getByRole('button', { name: 'Hiện lại trong báo cáo' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Ẩn khỏi báo cáo' })).toBeNull()
  })
})
