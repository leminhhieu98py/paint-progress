import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
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
