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
    expect(await screen.findByText(/1\.0000/)).toBeInTheDocument()
  })

  it('blocks save when the weights do not sum to 1', async () => {
    render(<StageConfigPanel projectId="p1" />)
    const weight = await screen.findByDisplayValue('0.6')
    await userEvent.clear(weight)
    await userEvent.type(weight, '0.5')

    const save = screen.getByRole('button', { name: 'Lưu' })
    await waitFor(() => expect(save).toBeDisabled())
    expect(saveStages).not.toHaveBeenCalled()
  })

  it('enables save once the weights sum to 1 again', async () => {
    render(<StageConfigPanel projectId="p1" />)
    const weight = await screen.findByDisplayValue('0.4')
    await userEvent.clear(weight)
    await userEvent.type(weight, '0.4')
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

  it('surfaces a save failure', async () => {
    saveStages.mockRejectedValue(new Error('weights must sum to 1, got 0.9000'))
    render(<StageConfigPanel projectId="p1" />)
    await screen.findByDisplayValue('Coat 2')
    await userEvent.click(screen.getByRole('button', { name: 'Lưu' }))
    await userEvent.click(screen.getByRole('button', { name: 'Vẫn lưu' }))
    expect(await screen.findByText(/must sum to 1/)).toBeInTheDocument()
  })

  it('adds a stage at the end with the next seq', async () => {
    render(<StageConfigPanel projectId="p1" />)
    await screen.findByDisplayValue('Coat 2')
    await userEvent.click(screen.getByRole('button', { name: 'Thêm lớp' }))
    expect(screen.getAllByRole('textbox')).toHaveLength(3)
    // A new row starts at weight 0, which leaves the total unchanged --
    // 0.6 + 0.4 + 0 is exactly 1 in IEEE754, not an approximation -- so Lưu
    // stays enabled. The row still needs a real weight assigned before the
    // project is usable, but that is a separate concern from this gate.
    expect(screen.getByRole('button', { name: 'Lưu' })).toBeEnabled()
  })

  it('keeps save enabled right at the epsilon boundary', async () => {
    render(<StageConfigPanel projectId="p1" />)
    const weight = await screen.findByDisplayValue('0.4')
    await userEvent.clear(weight)
    // total becomes 1.000001 == 1 + 1e-6, exactly STAGE_WEIGHT_EPSILON: the
    // gate uses <=, so this must still be considered balanced.
    await userEvent.type(weight, '0.400001')
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Lưu' })).toBeEnabled(),
    )
  })

  it('disables save just past the epsilon boundary', async () => {
    render(<StageConfigPanel projectId="p1" />)
    const weight = await screen.findByDisplayValue('0.4')
    await userEvent.clear(weight)
    // total becomes 1.000002 == 1 + 2e-6, one step past STAGE_WEIGHT_EPSILON.
    await userEvent.type(weight, '0.400002')
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
