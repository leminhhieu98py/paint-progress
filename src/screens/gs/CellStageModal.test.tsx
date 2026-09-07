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
  workName: 'Công việc chính',
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

/** The shared roster the two crew pickers offer (Feedback Rv4). */
const CREW = ['Lê Văn A', 'Nguyễn Văn B', 'Trần Văn C']

const renderModal = (cell: Cell | null = CELL, over: { employees?: string[] } = {}) =>
  render(
    <AntApp>
      <CellStageModal
        cell={cell}
        stages={STAGES}
        open={cell !== null}
        onClose={onClose}
        onCommit={onCommit}
        employees={over.employees ?? CREW}
      />
    </AntApp>,
  )

/** Picks a name out of one of the two crew selects. */
const chooseCrew = (label: string, name: string) => chooseIn(label, name)

/**
 * Everything Rv4 made compulsory apart from the coat, which each test chooses
 * for itself. Zero waste, so no order and no reason are asked for.
 */
const fillRequired = async (hours = '4') => {
  await chooseCrew('Nhóm trưởng', 'Lê Văn A')
  await chooseCrew('Thợ chính', 'Nguyễn Văn B')
  await userEvent.type(screen.getByLabelText(/Số giờ công \(Mhr\)/), hours)
  await userEvent.type(screen.getByLabelText(/Giờ hao phí \(Mhr\)/), '0')
}

/** What `fillRequired` produces, for the assertions. */
const FILLED = {
  leadName: 'Lê Văn A', painterName: 'Nguyễn Văn B',
  workHours: 4, wasteHours: 0, wasteReason: '', wasteOrder: '',
}

/**
 * Opens the stage dropdown and picks an option by its visible label.
 *
 * `getByRole('combobox', { name })` and not `getByLabelText`: antd puts the
 * aria-label on both the wrapper and the inner input, so getByLabelText throws
 * "found multiple elements". rc-select opens on the click's mousedown, and each
 * option div carries its label as `title`. Verified against antd 5.29 in jsdom
 * before this plan was written.
 */
/**
 * Opens one Select and clicks an option in ITS OWN dropdown.
 *
 * antd leaves every dropdown it has opened in the DOM, so once the dialog has
 * four Selects a plain `findByTitle` finds an option in a closed list as
 * readily as in the open one -- and a closed one is `pointer-events: none`, so
 * the click throws rather than picking the wrong thing. Each input names its
 * own listbox through `aria-controls`; that is the only reliable link between
 * the two.
 */
const chooseIn = async (name: string, option: string, search?: string) => {
  const box = screen.getByRole('combobox', { name })
  await userEvent.click(box)
  // The reason list is 26 long and rc-virtual-list renders only what fits, so
  // an option near the end is not in the DOM until the search narrows to it --
  // which is how a foreman reaches it too.
  if (search !== undefined) await userEvent.type(box, search)
  const listId = box.getAttribute('aria-controls')
  const dropdown = listId
    ? (document.getElementById(listId)?.closest('.ant-select-dropdown') as HTMLElement | null)
    : null
  if (!dropdown) throw new Error(`Select "${name}" opened no dropdown`)
  await userEvent.click(await within(dropdown).findByTitle(option))
}

const chooseStage = (label: string) => chooseIn('Công đoạn', label)

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
  it('shows the cell code, its area and the stage it is on', async () => {
    renderModal()

    expect(await screen.findByText('R3C7')).toBeInTheDocument()
    // vi-VN: comma decimal, dot grouping, two fraction digits -- from the
    // shared formatter, so this fails if someone hand-rolls toFixed(2).
    expect(info().getByText('148,50 m²')).toBeInTheDocument()
    expect(info().getByText('Coat 2')).toBeInTheDocument()
  })

  it('says so when the cell has not started', async () => {
    renderModal({ ...CELL, stageId: null })
    expect(await screen.findByTestId('cell-stage-info')).toBeInTheDocument()
    expect(info().getByText('Chưa bắt đầu')).toBeInTheDocument()
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

  it('offers no one-tap advance: the coat is chosen every time (Feedback Rv4)', async () => {
    renderModal()
    expect(await screen.findByTestId('cell-stage-info')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Xong công đoạn tiếp theo/ })).toBeNull()
    expect(screen.getByRole('combobox', { name: 'Công đoạn' })).toBeInTheDocument()
  })

  it('commits the chosen stage and closes, without waiting for the write', async () => {
    renderModal()
    await chooseStage('Coat 3')
    await fillRequired()
    await userEvent.click(screen.getByRole('button', { name: 'Xác nhận' }))

    expect(onCommit).toHaveBeenCalledWith('c1', 's3', '', FILLED)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('commits null when the cell is cleared', async () => {
    renderModal()
    await chooseStage('Chưa bắt đầu')
    await fillRequired()
    await userEvent.click(screen.getByRole('button', { name: 'Xác nhận' }))

    // The sentinel must never escape the modal: setCellStage sends stage_id
    // straight to PostgREST, and '__not-started__' is not a uuid.
    expect(onCommit).toHaveBeenCalledWith('c1', null, '', FILLED)
  })

  it('says which coat is missing rather than writing the one already there', async () => {
    // Opens defaulted to the CURRENT stage: a mis-tap must not be able to
    // advance a coat, because the percentage it moves is what the customer is
    // billed against. Pressing Xác nhận without touching it now explains why
    // nothing happened, where before the button was simply dead.
    renderModal()
    await fillRequired()
    await userEvent.click(screen.getByRole('button', { name: 'Xác nhận' }))

    expect(await screen.findByText('Chọn công đoạn cho ô này.')).toBeInTheDocument()
    expect(onCommit).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
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
          employees={CREW}
        />
      </AntApp>,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Xác nhận' }))
    expect(await screen.findByText('Chọn công đoạn cho ô này.')).toBeInTheDocument()
  })
})

describe('CellStageModal notes', () => {
  it('sends the typed note along with the stage', async () => {
    const user = userEvent.setup()
    const onCommit = vi.fn()
    render(
      <CellStageModal cell={CELL} stages={STAGES} open onClose={() => {}} onCommit={onCommit} employees={CREW} />,
    )

    await user.type(
      screen.getByLabelText(/Ghi chú/),
      'Bề mặt còn ẩm, hoãn sơn sang mai',
    )
    await chooseStage('Coat 3')
    await fillRequired()
    await user.click(screen.getByRole('button', { name: 'Xác nhận' }))

    expect(onCommit).toHaveBeenCalledWith(CELL.id, 's3', 'Bề mặt còn ẩm, hoãn sơn sang mai', FILLED)
  })

  it('sends an empty note when the foreman typed nothing', async () => {
    // Empty, not undefined and not "leave it alone": the note describes ONE
    // change, so a new coat with no comment must not inherit the comment that
    // explained the coat before it.
    const user = userEvent.setup()
    const onCommit = vi.fn()
    render(
      <CellStageModal cell={CELL} stages={STAGES} open onClose={() => {}} onCommit={onCommit} employees={CREW} />,
    )

    await chooseStage('Coat 3')
    await fillRequired()
    await user.click(screen.getByRole('button', { name: 'Xác nhận' }))

    expect(onCommit).toHaveBeenCalledWith(CELL.id, 's3', '', FILLED)
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
    // Each chip names the work too (0024): two works can note one bay.
    expect(within(thread).getByText('Công việc chính · Tháo giáo')).toBeInTheDocument()
    expect(within(thread).getByText('Công việc chính · Blast + Coat 1')).toBeInTheDocument()
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
    await chooseStage('Coat 3')
    await fillRequired()
    await userEvent.click(screen.getByRole('button', { name: 'Xác nhận' }))
    expect(onCommit).toHaveBeenCalledWith(CELL.id, 's3', '', FILLED)
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
        employees={CREW}
      />,
    )
    await chooseStage('Coat 2')
    await fillRequired()
    await userEvent.click(screen.getByRole('button', { name: 'Xác nhận' }))
    expect(onCommit).toHaveBeenCalledWith(CELL.id, 's2', '', FILLED)
  })
})

describe('CellStageModal — công việc', () => {
  it('names the work the stage is recorded for, in the title', () => {
    // Since 0024 a bay holds one stage per work, so "Ô R3C7" alone no longer
    // says what is being recorded.
    render(
      <AntApp>
        <CellStageModal
          cell={CELL}
          stages={STAGES}
          open
          onClose={onClose}
          onCommit={onCommit}
          workName="Tháo giáo"
        />
      </AntApp>,
    )
    expect(screen.getByText('Ô R3C7 · Tháo giáo')).toBeInTheDocument()
  })
})

describe('CellStageModal — kế hoạch', () => {
  it('lists the zones this bay is planned in, under Kế hoạch', () => {
    // Feedback Rv2 item 7, tablet side: no hover on a touch screen, so the bay
    // dialog carries the plan. Shown whether or not the plan overlay is on --
    // the plan is a fact about the bay.
    render(
      <AntApp>
        <CellStageModal
          cell={CELL}
          stages={STAGES}
          open
          onClose={onClose}
          onCommit={onCommit}
          zones={[
            { name: 'Khu A — Coat 3', stageName: 'Coat 3', range: '06/10 – 17/10' },
            { name: 'Khu A — Tháo giáo', stageName: 'Tháo giáo', range: '20/10 – 24/10' },
          ]}
        />
      </AntApp>,
    )
    const info = screen.getByTestId('cell-stage-info')
    expect(within(info).getByText('Kế hoạch')).toBeInTheDocument()
    expect(within(info).getByText('Khu A — Coat 3 · 06/10 – 17/10')).toBeInTheDocument()
    expect(within(info).getByText('Khu A — Tháo giáo · 20/10 – 24/10')).toBeInTheDocument()
  })

  it('shows no Kế hoạch row for a bay in no zone', () => {
    renderModal()
    expect(within(screen.getByTestId('cell-stage-info')).queryByText('Kế hoạch')).toBeNull()
  })
})

describe('CellStageModal — chỉ xem', () => {
  it('shows the facts and no way to change them for a viewer', () => {
    // Feedback Rv2 item 2: the bosses' account. The database refuses the write
    // anyway; the dialog must not offer one and then fail.
    render(
      <AntApp>
        <CellStageModal
          cell={CELL}
          stages={STAGES}
          open
          onClose={onClose}
          onCommit={onCommit}
          readOnly
        />
      </AntApp>,
    )
    expect(screen.getByTestId('cell-stage-info')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Xong công đoạn tiếp theo/ })).toBeNull()
    expect(screen.queryByRole('combobox', { name: 'Công đoạn' })).toBeNull()
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Xác nhận' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Đóng' })).toBeInTheDocument()
  })
})

describe('CellStageModal effort (Feedback Rv2 item 11, tightened by Rv4)', () => {
  it('offers the six effort fields and marks every one compulsory', async () => {
    renderModal()
    const block = within(await screen.findByTestId('cell-effort'))
    expect(block.getByText('Giờ công')).toBeInTheDocument()
    // Rv2 said "không bắt buộc"; Rv4 made all of it required, so that word
    // must be gone -- Linh flagged it specifically.
    expect(block.queryByText('không bắt buộc')).toBeNull()
    // The two crew fields are Selects, so the accessible name reaches both the
    // wrapper and its inner input; the role query picks exactly one.
    expect(block.getByRole('combobox', { name: 'Nhóm trưởng' })).toBeInTheDocument()
    expect(block.getByRole('combobox', { name: 'Thợ chính' })).toBeInTheDocument()
    expect(block.getByLabelText(/Số giờ công \(Mhr\)/)).toBeInTheDocument()
    expect(block.getByLabelText(/Giờ hao phí \(Mhr\)/)).toBeInTheDocument()
    // The order and the reason wait for lost hours: two more taps for a blank
    // on every bay that lost nothing.
    expect(block.queryByLabelText(/Lệnh sản xuất/)).toBeNull()
    expect(block.queryByLabelText(/Lý do hao phí/)).toBeNull()
  })

  it('picks the crew from the shared roster instead of taking typed names', async () => {
    renderModal()
    await chooseCrew('Nhóm trưởng', 'Trần Văn C')
    // A Select, not a text box: the whole point of Rv4's roster is that no
    // foreman can invent a spelling.
    expect(screen.getByRole('combobox', { name: 'Nhóm trưởng' })).toBeInTheDocument()
    expect(within(screen.getByTestId('cell-effort')).getByTitle('Trần Văn C')).toBeInTheDocument()
  })

  it('says so when the roster is empty rather than offering an empty box', async () => {
    renderModal(CELL, { employees: [] })
    expect(await screen.findByText('Chưa có nhân viên nào trong danh sách')).toBeInTheDocument()
  })

  it('hides the effort block from a viewer', async () => {
    render(
      <AntApp>
        <CellStageModal cell={CELL} stages={STAGES} open onClose={onClose} onCommit={onCommit} readOnly />
      </AntApp>,
    )
    expect(await screen.findByTestId('cell-stage-info')).toBeInTheDocument()
    expect(screen.queryByTestId('cell-effort')).toBeNull()
  })

  it('refuses to commit until every compulsory field is filled, naming each one', async () => {
    renderModal()
    await chooseStage('Coat 3')
    await userEvent.click(screen.getByRole('button', { name: 'Xác nhận' }))

    expect(await screen.findByText('Chọn nhóm trưởng.')).toBeInTheDocument()
    expect(screen.getByText('Chọn thợ chính.')).toBeInTheDocument()
    expect(screen.getByText('Nhập số giờ công.')).toBeInTheDocument()
    expect(screen.getByText('Nhập số giờ hao phí; không hao phí thì nhập 0.')).toBeInTheDocument()
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('says nothing until the foreman has actually tried', async () => {
    // A dialog that opens covered in red accuses somebody who has done nothing.
    renderModal()
    expect(await screen.findByTestId('cell-effort')).toBeInTheDocument()
    expect(screen.queryByText('Chọn nhóm trưởng.')).toBeNull()
  })

  it('sends the crew and the hours with the chosen stage', async () => {
    renderModal()
    await chooseStage('Coat 3')
    await chooseCrew('Nhóm trưởng', 'Lê Văn A')
    await chooseCrew('Thợ chính', 'Nguyễn Văn B')
    await userEvent.type(screen.getByLabelText(/Số giờ công \(Mhr\)/), '3.5')
    await userEvent.type(screen.getByLabelText(/Giờ hao phí \(Mhr\)/), '0')
    await userEvent.click(screen.getByRole('button', { name: 'Xác nhận' }))

    expect(onCommit).toHaveBeenCalledWith('c1', 's3', '', {
      leadName: 'Lê Văn A', painterName: 'Nguyễn Văn B',
      workHours: 3.5, wasteHours: 0, wasteReason: '', wasteOrder: '',
    })
  })

  it('asks for the production order and a listed reason once hours were lost', async () => {
    renderModal()
    await chooseStage('Coat 3')
    await chooseCrew('Nhóm trưởng', 'Lê Văn A')
    await chooseCrew('Thợ chính', 'Nguyễn Văn B')
    await userEvent.type(screen.getByLabelText(/Số giờ công \(Mhr\)/), '4')
    await userEvent.type(screen.getByLabelText(/Giờ hao phí \(Mhr\)/), '0.5')

    await userEvent.click(screen.getByRole('button', { name: 'Xác nhận' }))
    expect(await screen.findByText('Nhập lệnh sản xuất ghi nhận hao phí.')).toBeInTheDocument()
    expect(screen.getByText('Chọn lý do hao phí.')).toBeInTheDocument()
    expect(onCommit).not.toHaveBeenCalled()

    await userEvent.type(screen.getByLabelText(/Lệnh sản xuất/), 'LSX-2026-77')
    // A list, not free text: "chờ vật tư", "cho vat tu" and "đợi vật tư" were
    // three rows on the dashboard for one cause.
    await chooseIn('Lý do hao phí', '2.1 Vật tư về trễ, về không đồng bộ', 'Vật tư về trễ')
    await userEvent.click(screen.getByRole('button', { name: 'Xác nhận' }))

    expect(onCommit).toHaveBeenCalledWith('c1', 's3', '', {
      leadName: 'Lê Văn A', painterName: 'Nguyễn Văn B', workHours: 4, wasteHours: 0.5,
      wasteReason: '2.1 Vật tư về trễ, về không đồng bộ', wasteOrder: 'LSX-2026-77',
    })
  })

  it('drops the order and the reason for hours that were then cleared', async () => {
    renderModal()
    await chooseStage('Coat 3')
    await chooseCrew('Nhóm trưởng', 'Lê Văn A')
    await chooseCrew('Thợ chính', 'Nguyễn Văn B')
    await userEvent.type(screen.getByLabelText(/Số giờ công \(Mhr\)/), '4')
    await userEvent.type(screen.getByLabelText(/Giờ hao phí \(Mhr\)/), '1')
    await userEvent.type(screen.getByLabelText(/Lệnh sản xuất/), 'LSX-1')
    await chooseIn('Lý do hao phí', '8.1 Thời tiết', 'Thời tiết')

    await userEvent.clear(screen.getByLabelText(/Giờ hao phí \(Mhr\)/))
    await userEvent.type(screen.getByLabelText(/Giờ hao phí \(Mhr\)/), '0')
    expect(screen.queryByLabelText(/Lệnh sản xuất/)).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Xác nhận' }))

    expect(onCommit).toHaveBeenCalledWith('c1', 's3', '', {
      leadName: 'Lê Văn A', painterName: 'Nguyễn Văn B',
      workHours: 4, wasteHours: 0, wasteReason: '', wasteOrder: '',
    })
  })

  it('seeds the crew from the last update, since the same crew ticks fifty bays a day', async () => {
    render(
      <AntApp>
        <CellStageModal
          cell={CELL} stages={STAGES} open onClose={onClose} onCommit={onCommit}
          employees={CREW}
          defaultEffortNames={{ leadName: 'Lê Văn A', painterName: 'Nguyễn Văn B' }}
        />
      </AntApp>,
    )
    const block = within(await screen.findByTestId('cell-effort'))
    expect(block.getByTitle('Lê Văn A')).toBeInTheDocument()
    expect(block.getByTitle('Nguyễn Văn B')).toBeInTheDocument()
    expect(screen.getByLabelText(/Số giờ công \(Mhr\)/)).toHaveValue('')
  })

  it('starts each bay with fresh hours, so one bay\'s hours are never sent as another\'s', async () => {
    const view = renderModal()
    await userEvent.type(await screen.findByLabelText(/Số giờ công \(Mhr\)/), '3')
    view.rerender(
      <AntApp>
        <CellStageModal
          cell={{ ...CELL, id: 'c2', code: 'R3C8' }} stages={STAGES} open
          onClose={onClose} onCommit={onCommit} employees={CREW}
        />
      </AntApp>,
    )
    expect(await screen.findByText('Ô R3C8')).toBeInTheDocument()
    expect(screen.getByLabelText(/Số giờ công \(Mhr\)/)).toHaveValue('')
  })
})
