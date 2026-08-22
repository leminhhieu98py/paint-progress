import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { StageConfigPanel } from './StageConfigPanel'

const listStages = vi.hoisted(() => vi.fn())
const saveStages = vi.hoisted(() => vi.fn())
vi.mock('../../lib/projectsApi', () => ({
  listStages: (id: string) => listStages(id),
  saveStages: (id: string, s: unknown) => saveStages(id, s),
  STAGE_WEIGHT_EPSILON: 1e-6,
}))

beforeEach(() => {
  listStages.mockReset()
  saveStages.mockReset()
  listStages.mockResolvedValue([
    { id: 's1', seq: 1, name: 'Blast + Coat 1', color: '#fadb14', weight: 0.6 },
    { id: 's2', seq: 2, name: 'Coat 2', color: '#bfbfbf', weight: 0.4 },
  ])
})

describe('StageConfigPanel', () => {
  it('lists the project stages in seq order', async () => {
    render(<StageConfigPanel projectId="p1" />)
    expect(await screen.findByDisplayValue('Blast + Coat 1')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Coat 2')).toBeInTheDocument()
  })

  it('shows the running weight total', async () => {
    render(<StageConfigPanel projectId="p1" />)
    // vi-VN formatting: comma decimal separator, matching the paperwork the
    // operators already read from.
    expect(await screen.findByText(/1,0000/)).toBeInTheDocument()
  })

  it('blocks save when the weights do not sum to 1', async () => {
    render(<StageConfigPanel projectId="p1" />)
    // vi-VN comma decimal, matching decimalSeparator="," on the field.
    const weight = await screen.findByDisplayValue('0,6')
    await userEvent.clear(weight)
    await userEvent.type(weight, '0,5')

    const save = screen.getByRole('button', { name: 'Lưu' })
    await waitFor(() => expect(save).toBeDisabled())
    expect(saveStages).not.toHaveBeenCalled()
  })

  it('enables save once the weights sum to 1 again', async () => {
    render(<StageConfigPanel projectId="p1" />)
    const weight = await screen.findByDisplayValue('0,4')
    await userEvent.clear(weight)
    await userEvent.type(weight, '0,4')
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Lưu' })).toBeEnabled(),
    )
  })

  it('saves the edited stages without their ids', async () => {
    saveStages.mockResolvedValue(undefined)
    render(<StageConfigPanel projectId="p1" />)
    await screen.findByDisplayValue('Blast + Coat 1')
    await userEvent.click(screen.getByRole('button', { name: 'Lưu' }))
    // Lưu only opens the destructive-save confirmation (pinned by the next
    // test); the actual save happens on the modal's own confirm button.
    await userEvent.click(screen.getByRole('button', { name: 'Vẫn lưu' }))

    await waitFor(() => expect(saveStages).toHaveBeenCalledTimes(1))
    const [, stages] = saveStages.mock.calls[0]
    expect(stages).toHaveLength(2)
    // saveStages replaces the rows, so ids from the old set must not be sent.
    for (const s of stages as Record<string, unknown>[]) {
      expect(s).not.toHaveProperty('id')
    }
  })

  it('warns that saving will clear recorded progress, and needs confirmation', async () => {
    // cells.stage_id references project_stages ON DELETE SET NULL, and saveStages
    // replaces the whole list -- so every tick of recorded progress in the project
    // is nulled. Harmless while authoring, destructive once GS users have started.
    saveStages.mockResolvedValue(undefined)
    render(<StageConfigPanel projectId="p1" />)
    await screen.findByDisplayValue('Blast + Coat 1')

    await userEvent.click(screen.getByRole('button', { name: 'Lưu' }))
    expect(await screen.findByText(/tiến độ đã ghi/i)).toBeInTheDocument()
    expect(saveStages).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Vẫn lưu' }))
    await waitFor(() => expect(saveStages).toHaveBeenCalledTimes(1))
  })

  it('surfaces a save failure and closes the confirmation modal', async () => {
    saveStages.mockRejectedValue(new Error('weights must sum to 1, got 0.9000'))
    render(<StageConfigPanel projectId="p1" />)
    await screen.findByDisplayValue('Coat 2')
    await userEvent.click(screen.getByRole('button', { name: 'Lưu' }))
    await userEvent.click(screen.getByRole('button', { name: 'Vẫn lưu' }))
    expect(await screen.findByText(/must sum to 1/)).toBeInTheDocument()
    // The Alert lives outside the modal: if the dialog were still open, the
    // error would be rendered behind its mask, so the admin would just see
    // the confirm dialog fail to go away with no visible reason why.
    //
    // The modal is conditionally rendered rather than toggled via `open`, so
    // its absence from the accessibility tree is a real signal about our own
    // `confirming` state rather than a claim about antd's leave-animation
    // internals (which never resolve under jsdom, since no real
    // `transitionend` ever fires there).
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('keeps an in-progress edit when a stale background refresh resolves late', async () => {
    // Mirrors the post-mount auth-event test in AuthProvider: control the
    // resolution order of two overlapping loads by hand rather than relying
    // on real timing.
    const initialStages = [
      { id: 's1', seq: 1, name: 'Blast + Coat 1', color: '#fadb14', weight: 0.6 },
      { id: 's2', seq: 2, name: 'Coat 2', color: '#bfbfbf', weight: 0.4 },
    ]
    let resolveStaleLoad: (stages: typeof initialStages) => void = () => {}
    const staleLoad = new Promise<typeof initialStages>((resolve) => {
      resolveStaleLoad = resolve
    })
    // Call 1 (mount) resolves immediately; call 2 (the background refresh a
    // successful save kicks off) returns a promise this test controls and
    // leaves pending.
    listStages.mockResolvedValueOnce(initialStages).mockReturnValueOnce(staleLoad)
    saveStages.mockResolvedValue(undefined)

    render(<StageConfigPanel projectId="p1" />)
    await screen.findByDisplayValue('Blast + Coat 1')

    await userEvent.click(screen.getByRole('button', { name: 'Lưu' }))
    await userEvent.click(screen.getByRole('button', { name: 'Vẫn lưu' }))
    await waitFor(() => expect(saveStages).toHaveBeenCalledTimes(1))

    // The background refresh's `listStages` call is now pending on
    // `staleLoad`. The row is no longer disabled (the save itself finished;
    // only the reconciliation fetch is still in flight), so the admin
    // resumes editing -- this is the edit the guard must protect.
    const name = screen.getByDisplayValue('Blast + Coat 1')
    await userEvent.clear(name)
    await userEvent.type(name, 'Edited Mid-Flight')

    // Now the stale load resolves, carrying the pre-edit name.
    resolveStaleLoad(initialStages)

    // The edit must survive: a load that started before it, and resolves
    // after it, must not be allowed to overwrite it.
    await waitFor(() =>
      expect(screen.getByDisplayValue('Edited Mid-Flight')).toBeInTheDocument(),
    )
    expect(screen.queryByDisplayValue('Blast + Coat 1')).toBeNull()
  })

  it('adds a stage at the end with the next seq', async () => {
    render(<StageConfigPanel projectId="p1" />)
    await screen.findByDisplayValue('Coat 2')
    await userEvent.click(screen.getByRole('button', { name: 'Thêm lớp' }))
    expect(screen.getAllByRole('textbox')).toHaveLength(3)
    // Cumulative progress reads stages by seq, so the new row must land at 3,
    // not stay at the placeholder 0 a dropped renumber() would leave it at.
    expect(screen.getByTestId('seq-2')).toHaveTextContent('3')
    // A new row starts at weight 0, which leaves the total unchanged --
    // 0.6 + 0.4 + 0 is exactly 1 in IEEE754, not an approximation -- so Lưu
    // stays enabled. The row still needs a real weight assigned before the
    // project is usable, but that is a separate concern from this gate.
    expect(screen.getByRole('button', { name: 'Lưu' })).toBeEnabled()
  })

  it('keeps save enabled right at the epsilon boundary', async () => {
    render(<StageConfigPanel projectId="p1" />)
    const weight = await screen.findByDisplayValue('0,4')
    await userEvent.clear(weight)
    // total becomes 1.000001 == 1 + 1e-6, exactly STAGE_WEIGHT_EPSILON: the
    // gate uses <=, so this must still be considered balanced.
    await userEvent.type(weight, '0,400001')
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Lưu' })).toBeEnabled(),
    )
  })

  it('disables save just past the epsilon boundary', async () => {
    render(<StageConfigPanel projectId="p1" />)
    const weight = await screen.findByDisplayValue('0,4')
    await userEvent.clear(weight)
    // total becomes 1.000002 == 1 + 2e-6, one step past STAGE_WEIGHT_EPSILON.
    await userEvent.type(weight, '0,400002')
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Lưu' })).toBeDisabled(),
    )
  })

  it('removes a stage', async () => {
    render(<StageConfigPanel projectId="p1" />)
    await screen.findByDisplayValue('Coat 2')
    await userEvent.click(screen.getAllByRole('button', { name: 'Xoá' })[1])
    expect(screen.queryByDisplayValue('Coat 2')).toBeNull()
  })

  it('renumbers seq contiguously after removing a middle stage', async () => {
    // A 2-row fixture can't expose a broken renumber(): its sole survivor is
    // already seq 1 whether or not renumber ran. Only removing the middle of
    // three rows leaves a detectable gap (1, 3) if renumber were dropped.
    listStages.mockResolvedValue([
      { id: 's1', seq: 1, name: 'First', color: '#111111', weight: 0.5 },
      { id: 's2', seq: 2, name: 'Middle', color: '#222222', weight: 0.3 },
      { id: 's3', seq: 3, name: 'Last', color: '#333333', weight: 0.2 },
    ])
    render(<StageConfigPanel projectId="p1" />)
    await screen.findByDisplayValue('Middle')

    await userEvent.click(screen.getAllByRole('button', { name: 'Xoá' })[1])

    // 1,2,3 minus the middle must become 1,2 -- not 1,3. Cumulative progress
    // reads stages by seq, so a gap silently corrupts every percentage.
    expect(screen.queryByDisplayValue('Middle')).toBeNull()
    expect(screen.getByTestId('seq-0')).toHaveTextContent('1')
    expect(screen.getByTestId('seq-1')).toHaveTextContent('2')
  })

  it('refuses to remove the last remaining stage', async () => {
    listStages.mockResolvedValue([
      { id: 's1', seq: 1, name: 'Only', color: '#000000', weight: 1 },
    ])
    render(<StageConfigPanel projectId="p1" />)
    await screen.findByDisplayValue('Only')
    // A project with no stages has no defined progress at all.
    expect(screen.getByRole('button', { name: 'Xoá' })).toBeDisabled()
  })

  it('moves a stage up and renumbers seq contiguously', async () => {
    render(<StageConfigPanel projectId="p1" />)
    await screen.findByDisplayValue('Coat 2')
    await userEvent.click(screen.getAllByRole('button', { name: 'Lên' })[1])

    const names = screen.getAllByRole('textbox').map((i) => (i as HTMLInputElement).value)
    expect(names).toEqual(['Coat 2', 'Blast + Coat 1'])
    // Cumulative progress reads stages by seq, so gaps or ties would corrupt it.
    expect(screen.getAllByText(/^[12]$/).map((n) => n.textContent)).toEqual(['1', '2'])
  })
})
