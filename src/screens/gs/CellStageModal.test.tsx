import { App as AntApp } from 'antd'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Cell } from '../../domain/types'
import type { CellNote } from '../../lib/progressApi'
import { CellStageModal } from './CellStageModal'

const listCellNotes = vi.hoisted(() => vi.fn())
vi.mock('../../lib/progressApi', () => ({
  listCellNotes: (cellId: string) => listCellNotes(cellId),
}))

const NOTE = (over: Partial<CellNote> = {}): CellNote => ({
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

const STAGES = [
  { id: 's1', seq: 1, name: 'Blast + Coat 1', color: '#fadb14', weight: 0.25 },
  { id: 's2', seq: 2, name: 'Coat 2', color: '#bfbfbf', weight: 0.15 },
  { id: 's3', seq: 3, name: 'Coat 3', color: '#52c41a', weight: 0.35 },
  { id: 's4', seq: 4, name: 'Coat 4', color: '#1677ff', weight: 0.15 },
  { id: 's5', seq: 5, name: 'Tháo giáo', color: '#722ed1', weight: 0.1 },
]

// Annotated, not inferred: an inferred literal types stageId as string, so
// { ...CELL, stageId: null } -- the not-started case below -- would not compile.
const CELL: Cell = {
  id: 'c1', code: 'R3C7', x: 0, y: 0, w: 0.25, h: 0.5, areaM2: 148.5, stageId: 's2',
}

const onCommit = vi.fn()
const onClose = vi.fn()

const renderModal = (cell: Cell | null = CELL) =>
  render(
    <AntApp>
      <CellStageModal
        cell={cell}
        stages={STAGES}
        open={cell !== null}
        onClose={onClose}
        onCommit={onCommit}
      />
    </AntApp>,
  )

/**
 * Opens the stage dropdown and picks an option by its visible label.
 *
 * `getByRole('combobox', { name })` and not `getByLabelText`: antd puts the
 * aria-label on both the wrapper and the inner input, so getByLabelText throws
 * "found multiple elements". rc-select opens on the click's mousedown, and each
 * option div carries its label as `title`. Verified against antd 5.29 in jsdom
 * before this plan was written.
 */
const chooseStage = async (label: string) => {
  await userEvent.click(screen.getByRole('combobox', { name: 'Công đoạn' }))
  await userEvent.click(await screen.findByTitle(label))
}

/**
 * The info rows, scoped.
 *
 * The Select renders its selected option's label, so the CURRENT stage name is
 * on screen twice and an unscoped getByText('Coat 2') throws "found multiple
 * elements". Scoping rather than switching to getAllByText: the point of these
 * assertions is that the info block states the current and next stage, and
 * getAllByText would still pass on a modal that showed only the Select.
 */
const info = () => within(screen.getByTestId('cell-stage-info'))

beforeEach(() => {
  onCommit.mockReset()
  onClose.mockReset()
  listCellNotes.mockReset()
  // Pending, not resolved: the tests that are not about the thread must not
  // have a state update land after they have finished and warn about act().
  // The ones that are about it resolve it themselves.
  listCellNotes.mockReturnValue(new Promise(() => {}))
})

describe('CellStageModal', () => {
  it('shows the cell code, its area, its current stage and the next one', async () => {
    renderModal()

    expect(await screen.findByText('R3C7')).toBeInTheDocument()
    // vi-VN: comma decimal, dot grouping, two fraction digits -- from the
    // shared formatter, so this fails if someone hand-rolls toFixed(2).
    expect(info().getByText('148,50 m²')).toBeInTheDocument()
    expect(info().getByText('Coat 2')).toBeInTheDocument()
    expect(info().getByText('Coat 3')).toBeInTheDocument()
  })

  it('says so when the cell has not started', async () => {
    renderModal({ ...CELL, stageId: null })
    expect(await screen.findByTestId('cell-stage-info')).toBeInTheDocument()
    expect(info().getByText('Chưa bắt đầu')).toBeInTheDocument()
    // Next stage for a cell that has not started is the FIRST one, not the
    // second -- catches a nextStage call that treats null as seq 1.
    expect(info().getByText('Blast + Coat 1')).toBeInTheDocument()
  })

  it('says so when the cell is at the last stage', async () => {
    renderModal({ ...CELL, stageId: 's5' })
    expect(await screen.findByText('Đã xong công đoạn cuối')).toBeInTheDocument()
  })

  it('warns in red when the chosen stage goes backwards', async () => {
    renderModal()
    await chooseStage('Blast + Coat 1')

    const warning = await screen.findByText('Đang chuyển ô về công đoạn trước')
    expect(warning).toBeInTheDocument()
    // Red, not orange: antd renders type="error" as ant-alert-error. A
    // "warning" here would look like the divergence banner, which is
    // informational and routinely ignored.
    expect(document.querySelector('.ant-alert-error')).not.toBeNull()
  })

  it('does not warn for a forward move', async () => {
    renderModal()
    await chooseStage('Coat 4')
    expect(screen.queryByText('Đang chuyển ô về công đoạn trước')).toBeNull()
  })

  it('warns when clearing a recorded cell back to not started', async () => {
    // The most destructive move the GS screen offers: it discards a recorded
    // coat. isBackwards treats null as seq 0 for exactly this reason.
    renderModal()
    await chooseStage('Chưa bắt đầu')
    expect(await screen.findByText('Đang chuyển ô về công đoạn trước')).toBeInTheDocument()
  })

  it('advances one stage in a single tap', async () => {
    renderModal()
    await userEvent.click(
      screen.getByRole('button', { name: 'Xong công đoạn tiếp theo: Coat 3' }),
    )
    // Exactly one stage on from the cell's CURRENT stage (s2) -- not to the last
    // stage, and not two along. Catches a button wired to the last stage or to
    // whatever the Select happens to be showing.
    expect(onCommit).toHaveBeenCalledWith('c1', 's3', '')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('offers no advance button on a cell already at the last stage', async () => {
    renderModal({ ...CELL, stageId: 's5' })
    expect(await screen.findByText('Đã xong công đoạn cuối')).toBeInTheDocument()
    // nextStage returns null here, so there is nothing to advance to and a
    // button would have to commit something. The Select stays, for a correction.
    expect(screen.queryByRole('button', { name: /Xong công đoạn tiếp theo/ })).toBeNull()
    expect(screen.getByRole('combobox', { name: 'Công đoạn' })).toBeInTheDocument()
  })

  it('commits the chosen stage and closes, without waiting for the write', async () => {
    renderModal()
    await chooseStage('Coat 3')
    await userEvent.click(screen.getByRole('button', { name: 'Xác nhận' }))

    expect(onCommit).toHaveBeenCalledWith('c1', 's3', '')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('commits null when the cell is cleared', async () => {
    renderModal()
    await chooseStage('Chưa bắt đầu')
    await userEvent.click(screen.getByRole('button', { name: 'Xác nhận' }))

    // The sentinel must never escape the modal: setCellStage sends stage_id
    // straight to PostgREST, and '__not-started__' is not a uuid.
    expect(onCommit).toHaveBeenCalledWith('c1', null, '')
  })

  it('refuses to write when nothing was changed', async () => {
    renderModal()
    // Opens defaulted to the CURRENT stage, not the next one: a mis-tap must
    // not be able to advance a coat, because the percentage it moves is what
    // the customer is billed against.
    expect(screen.getByRole('button', { name: 'Xác nhận' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Huỷ' }))
    expect(onCommit).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('starts each cell from its own stage, not the previously opened cell\'s', async () => {
    // The Modal is mounted once and reused, so a selection left over from the
    // last cell would be committed against this one.
    const { rerender } = renderModal()
    await chooseStage('Coat 4')

    rerender(
      <AntApp>
        <CellStageModal
          cell={{ ...CELL, id: 'c2', code: 'R4C1', stageId: 's1' }}
          stages={STAGES}
          open
          onClose={onClose}
          onCommit={onCommit}
        />
      </AntApp>,
    )

    expect(screen.getByRole('button', { name: 'Xác nhận' })).toBeDisabled()
  })
})

describe('CellStageModal notes', () => {
  it('sends the typed note along with the stage', async () => {
    const user = userEvent.setup()
    const onCommit = vi.fn()
    render(
      <CellStageModal cell={CELL} stages={STAGES} open onClose={() => {}} onCommit={onCommit} />,
    )

    await user.type(
      screen.getByLabelText(/Ghi chú/),
      'Bề mặt còn ẩm, hoãn sơn sang mai',
    )
    await user.click(screen.getByRole('button', { name: /Xong công đoạn tiếp theo/ }))

    expect(onCommit).toHaveBeenCalledWith(CELL.id, 's3', 'Bề mặt còn ẩm, hoãn sơn sang mai')
  })

  it('sends an empty note when the foreman typed nothing', async () => {
    // Empty, not undefined and not "leave it alone": the note describes ONE
    // change, so a new coat with no comment must not inherit the comment that
    // explained the coat before it.
    const user = userEvent.setup()
    const onCommit = vi.fn()
    render(
      <CellStageModal cell={CELL} stages={STAGES} open onClose={() => {}} onCommit={onCommit} />,
    )

    await user.click(screen.getByRole('button', { name: /Xong công đoạn tiếp theo/ }))

    expect(onCommit).toHaveBeenCalledWith(CELL.id, 's3', '')
  })

  it('clears a half-typed note when the foreman moves to another bay', async () => {
    // The modal is one component reused for every bay. Left un-keyed, the note
    // typed on R1C1 would be sent as R1C2's -- attributing one bay's problem
    // to another.
    const { rerender } = render(
      <CellStageModal
        cell={{ ...CELL, id: 'c1', code: 'R1C1' }}
        stages={STAGES}
        open
        onClose={() => {}}
        onCommit={() => {}}
      />,
    )
    await userEvent.type(screen.getByLabelText(/Ghi chú cho quản trị viên/), 'ẩm')
    rerender(
      <CellStageModal
        cell={{ ...CELL, id: 'c2', code: 'R1C2' }}
        stages={STAGES}
        open
        onClose={() => {}}
        onCommit={() => {}}
      />,
    )
    expect(screen.getByLabelText(/Ghi chú cho quản trị viên/)).toHaveValue('')
  })
})

describe('CellStageModal — the previous note', () => {
  it('opens on an empty field, whatever the bay already says', async () => {
    // A note belongs to the stage change being recorded. Pre-filling the last
    // coat's remark means the foreman recording Coat 2 submits a sentence
    // written about Blast + Coat 1 -- and the history then shows the same
    // problem reported twice, against two coats, by someone who only meant to
    // tick a box.
    render(
      <CellStageModal
        cell={{ ...CELL, stageId: 's1', note: 'Bề mặt còn ẩm, hoãn sơn sang mai' }}
        stages={STAGES}
        open
        onClose={() => {}}
        onCommit={() => {}}
      />,
    )
    expect(screen.getByLabelText(/Ghi chú cho quản trị viên/)).toHaveValue('')
  })

  it('shows every earlier note on the bay, newest first, each against its coat', async () => {
    // Feedback Rv1, item 7. The foreman used to see only the latest remark;
    // "Bề mặt còn ẩm" against Blast + Coat 1 and "Chờ cẩu" against Tháo giáo
    // are different problems, and the one he is standing in front of may be
    // the older one.
    listCellNotes.mockResolvedValue([
      NOTE({ id: 2, stageName: 'Tháo giáo', note: 'Chờ cẩu', at: '2026-08-30T08:00:00Z' }),
      NOTE({ id: 1, stageName: 'Blast + Coat 1' }),
    ])
    renderModal({ ...CELL, note: 'Chờ cẩu' })

    const thread = await screen.findByTestId('note-thread')
    expect(listCellNotes).toHaveBeenCalledWith('c1')
    const texts = within(thread).getAllByText(/Chờ cẩu|Bề mặt còn ẩm/).map((el) => el.textContent)
    expect(texts).toEqual(['Chờ cẩu', 'Bề mặt còn ẩm'])
    expect(within(thread).getByText('Tháo giáo')).toBeInTheDocument()
    expect(within(thread).getByText('Blast + Coat 1')).toBeInTheDocument()
    // The newest one is what the drawing's flag shows.
    expect(within(thread).getByText('Đang hiện trên bản vẽ')).toBeInTheDocument()
  })

  it('names an author the tablet cannot read from profiles, through authorNames', async () => {
    // profiles is admin-plus-self behind RLS, so the embed comes back null on
    // a tablet. The screen hands the modal the names coworker_names() allows.
    listCellNotes.mockResolvedValue([NOTE({ byName: null, byUsername: null, byId: 'u2' })])
    render(
      <AntApp>
        <CellStageModal
          cell={CELL}
          stages={STAGES}
          open
          onClose={onClose}
          onCommit={onCommit}
          authorNames={{ u2: 'Nguyễn Văn B' }}
        />
      </AntApp>,
    )
    expect(await screen.findByText('Nguyễn Văn B')).toBeInTheDocument()
    expect(screen.queryByText('Không rõ người ghi')).toBeNull()
  })

  it('shows no thread and no empty-state copy on a bay with no notes', async () => {
    // The admin's empty state explains where notes come from. On a tablet the
    // foreman IS where they come from, and the modal has one job.
    listCellNotes.mockResolvedValue([])
    renderModal()

    await waitFor(() => expect(listCellNotes).toHaveBeenCalledWith('c1'))
    expect(screen.queryByTestId('note-thread')).toBeNull()
    expect(screen.queryByText('Ô này chưa có ghi chú nào')).toBeNull()
    expect(screen.queryByTestId('cell-previous-note')).toBeNull()
  })

  it('keeps the write available when the history cannot be loaded', async () => {
    // The thread is context; the stage change is the job. A tether that drops
    // the history read must not take the foreman's only write with it.
    listCellNotes.mockRejectedValue(new Error('mất kết nối'))
    renderModal()

    expect(await screen.findByText('Không tải được ghi chú cũ')).toBeInTheDocument()
    const next = screen.getByRole('button', { name: 'Xong công đoạn tiếp theo: Coat 3' })
    expect(next).toBeEnabled()
    await userEvent.click(next)
    expect(onCommit).toHaveBeenCalledWith(CELL.id, 's3', '')
  })

  it('never shows the foreman the report-facing version or the hidden flag', async () => {
    // Those are the admin's decisions about the XLSX (0023). On the tablet the
    // note is what was written, full stop.
    listCellNotes.mockResolvedValue([
      NOTE({ reportNote: 'Bản dành cho báo cáo', reportHidden: true, reportEditedByName: 'Đoàn Công Linh' }),
    ])
    renderModal()

    const thread = await screen.findByTestId('note-thread')
    expect(within(thread).getByText('Bề mặt còn ẩm')).toBeInTheDocument()
    expect(screen.queryByText('Bản dành cho báo cáo')).toBeNull()
    expect(screen.queryByText(/Bản cho báo cáo/)).toBeNull()
    expect(screen.queryByText(/Ẩn khỏi báo cáo/)).toBeNull()
    expect(screen.queryByRole('button', { name: /báo cáo/ })).toBeNull()
  })

  it('sends an empty note when the foreman writes nothing, clearing the old one', async () => {
    // 0019 sends the note on every stage change, empty included: a bay that
    // gets a new coat and no comment must not keep the note that explained the
    // coat before it.
    const onCommit = vi.fn()
    render(
      <CellStageModal
        cell={{ ...CELL, stageId: 's1', note: 'Bề mặt còn ẩm' }}
        stages={STAGES}
        open
        onClose={() => {}}
        onCommit={onCommit}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: /Xong công đoạn tiếp theo/ }))
    expect(onCommit).toHaveBeenCalledWith(CELL.id, 's2', '')
  })
})
