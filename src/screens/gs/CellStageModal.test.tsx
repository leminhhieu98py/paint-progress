import { App as AntApp } from 'antd'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Cell } from '../../domain/types'
import { CellStageModal } from './CellStageModal'

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

  it('shows the note already on the bay, so the foreman can see what it says', () => {
    render(
      <CellStageModal
        cell={{ ...CELL, note: 'Giàn giáo chắn mất một góc' }}
        stages={STAGES}
        open
        onClose={() => {}}
        onCommit={() => {}}
      />,
    )
    expect(screen.getByLabelText(/Ghi chú/)).toHaveValue('Giàn giáo chắn mất một góc')
  })

  it('starts each bay with its own note rather than the previous one', () => {
    // The modal is one component reused for every bay. Left un-keyed, the note
    // typed on R1C1 would be sent as R1C2's -- attributing one bay's problem
    // to another.
    const { rerender } = render(
      <CellStageModal
        cell={{ ...CELL, id: 'c1', code: 'R1C1', note: 'ẩm' }}
        stages={STAGES}
        open
        onClose={() => {}}
        onCommit={() => {}}
      />,
    )
    rerender(
      <CellStageModal
        cell={{ ...CELL, id: 'c2', code: 'R1C2', note: '' }}
        stages={STAGES}
        open
        onClose={() => {}}
        onCommit={() => {}}
      />,
    )
    expect(screen.getByLabelText(/Ghi chú/)).toHaveValue('')
  })
})
