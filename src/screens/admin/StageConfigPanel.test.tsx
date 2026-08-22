import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { StageConfigPanel } from './StageConfigPanel'

const listStages = vi.hoisted(() => vi.fn())
const saveStages = vi.hoisted(() => vi.fn())
// stagesRemovedBy and roundStageWeight are pure, and the panel's behaviour IS
// what they compute -- which stages the dialog names, and what value a keystroke
// stores. Stubbing them would leave the dialog and the clamp asserted against a
// fixture instead of against the real diff, so the real implementations are used
// here and only the two I/O functions are mocked.
// projectsApi imports the supabase client at module scope, so stub that out to
// let importOriginal run without reaching for real credentials. Nothing in this
// file goes through it -- the two functions that would are mocked below.
vi.mock('../../lib/supabase', () => ({ supabase: { from: vi.fn() } }))
vi.mock('../../lib/projectsApi', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../lib/projectsApi')>()
  return {
    listStages: (id: string) => listStages(id),
    saveStages: (id: string, s: unknown) => saveStages(id, s),
    stagesRemovedBy: real.stagesRemovedBy,
    roundStageWeight: real.roundStageWeight,
    STAGE_WEIGHT_EPSILON: real.STAGE_WEIGHT_EPSILON,
  }
})

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
    // Nothing is being removed here, so Lưu saves directly -- see the
    // no-dialog test below.
    await userEvent.click(screen.getByRole('button', { name: 'Lưu' }))

    await waitFor(() => expect(saveStages).toHaveBeenCalledTimes(1))
    const [, stages] = saveStages.mock.calls[0]
    expect(stages).toHaveLength(2)
    // saveStages keys the upsert on (project_id, seq), so ids from the old set
    // must not be sent -- and sending one would make the payload look like an
    // identity claim the diff does not actually use.
    for (const s of stages as Record<string, unknown>[]) {
      expect(s).not.toHaveProperty('id')
    }
  })

  it('saves without any confirmation when nothing is being removed', async () => {
    // A rename or a reweight now keeps every stage row, its id, its zones and
    // every cell's recorded progress: saveStages upserts on (project_id, seq)
    // and deletes only the seqs that genuinely disappear. There is nothing to
    // disclose, and a dialog on a save that costs nothing is a dialog the admin
    // learns to click through -- which is how the one that matters gets skimmed.
    saveStages.mockResolvedValue(undefined)
    render(<StageConfigPanel projectId="p1" />)
    const name = await screen.findByDisplayValue('Blast + Coat 1')
    await userEvent.clear(name)
    await userEvent.type(name, 'Blast + Coat 1 (renamed)')

    await userEvent.click(screen.getByRole('button', { name: 'Lưu' }))

    await waitFor(() => expect(saveStages).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect((saveStages.mock.calls[0][1] as { name: string }[])[0].name).toBe(
      'Blast + Coat 1 (renamed)',
    )
  })

  it('names the stage being removed, and what removing it destroys', async () => {
    // zones.stage_id references project_stages ON DELETE CASCADE and
    // cells.stage_id ON DELETE SET NULL, so a removal -- and now only a removal
    // -- nulls the cells sitting at that stage and deletes the zones planned
    // against it. The dialog has to name both consequences and the stage they
    // apply to; the wording it replaced mentioned neither zones nor which stage.
    listStages.mockResolvedValue([
      { id: 's1', seq: 1, name: 'Blast + Coat 1', color: '#fadb14', weight: 0.5 },
      { id: 's2', seq: 2, name: 'Coat 2', color: '#bfbfbf', weight: 0.3 },
      { id: 's3', seq: 3, name: 'Tháo giáo', color: '#722ed1', weight: 0.2 },
    ])
    saveStages.mockResolvedValue(undefined)
    render(<StageConfigPanel projectId="p1" />)
    await screen.findByDisplayValue('Tháo giáo')

    // Remove the last row, so the seq that disappears (3) is the row whose name
    // the dialog must show.
    await userEvent.click(screen.getAllByRole('button', { name: 'Xoá' })[2])
    // Put the freed weight back on an existing row so Lưu is enabled again.
    const weight = screen.getByDisplayValue('0,3')
    await userEvent.clear(weight)
    await userEvent.type(weight, '0,5')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Lưu' })).toBeEnabled())

    await userEvent.click(screen.getByRole('button', { name: 'Lưu' }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/Tháo giáo/)).toBeInTheDocument()
    // Not a surviving stage: naming one of those would be the over-disclosure
    // the diff exists to remove.
    expect(within(dialog).queryByText(/Blast \+ Coat 1/)).toBeNull()
    expect(within(dialog).getByText(/tiến độ đã ghi/i)).toBeInTheDocument()
    expect(within(dialog).getByText(/zone/i)).toBeInTheDocument()
    expect(saveStages).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Vẫn lưu' }))
    await waitFor(() => expect(saveStages).toHaveBeenCalledTimes(1))
    expect(saveStages.mock.calls[0][1]).toHaveLength(2)
  })

  it('surfaces a save failure and closes the confirmation modal', async () => {
    // Driven through the removal path so there is a modal to close in the first
    // place.
    listStages.mockResolvedValue([
      { id: 's1', seq: 1, name: 'Blast + Coat 1', color: '#fadb14', weight: 1 },
      { id: 's2', seq: 2, name: 'Coat 2', color: '#bfbfbf', weight: 0 },
    ])
    saveStages.mockRejectedValue(new Error('weights must sum to 1, got 0.9000'))
    render(<StageConfigPanel projectId="p1" />)
    await screen.findByDisplayValue('Coat 2')
    await userEvent.click(screen.getAllByRole('button', { name: 'Xoá' })[1])
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

    // No removal here, so Lưu saves directly with no dialog in the way.
    await userEvent.click(screen.getByRole('button', { name: 'Lưu' }))
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

  it('clamps a typed weight to the five decimals the column can store', async () => {
    // A8's first half. weight is numeric(6,5), so a sixth decimal is rounded
    // away by Postgres. Clamping as it is typed means the admin sees the value
    // that will actually be stored, instead of discovering on reload that the
    // total no longer sums to 1.
    render(<StageConfigPanel projectId="p1" />)
    const weight = await screen.findByDisplayValue('0,6')
    await userEvent.clear(weight)
    await userEvent.type(weight, '0,333333')
    // Blur: while focused rc-input-number echoes the raw keystrokes back, so
    // the field only shows the stored value once it stops being edited. The
    // running total below reads the state either way, and is what every
    // percentage on the project is computed from.
    await userEvent.tab()

    await waitFor(() => expect(screen.getByDisplayValue('0,33333')).toBeInTheDocument())
    expect(screen.queryByDisplayValue('0,333333')).toBeNull()
    // 0.4 + 0.33333, not 0.4 + 0.333333.
    expect(screen.getByText('0,7333')).toBeInTheDocument()
  })

  it('saves the three-way split that used to disable its own Save button', async () => {
    // The whole A8 defect, end to end. 0.333333 / 0.333333 / 0.333334 sums to
    // exactly 1 as typed, so it saved -- and Postgres stored 0.33333 three
    // times, leaving a reloaded total of 0.99999 that failed the old 1e-6 check:
    // the red banner appeared and Save disabled on a configuration that had just
    // saved successfully, with nothing on screen saying five decimals was the
    // limit. Both halves are needed here: the clamp makes the typed values the
    // stored ones, and the widened epsilon accepts the 1e-5 the clamp leaves
    // behind.
    listStages.mockResolvedValue([
      { id: 's1', seq: 1, name: 'A', color: '#111111', weight: 0.4 },
      { id: 's2', seq: 2, name: 'B', color: '#222222', weight: 0.3 },
      { id: 's3', seq: 3, name: 'C', color: '#333333', weight: 0.3 },
    ])
    saveStages.mockResolvedValue(undefined)
    render(<StageConfigPanel projectId="p1" />)
    await screen.findByDisplayValue('0,4')

    // By row, not by display value: two rows start at 0,3, and after the first
    // edit three rows share a value.
    const typed = ['0,333333', '0,333333', '0,333334']
    for (let row = 0; row < typed.length; row++) {
      const field = screen.getAllByRole('spinbutton')[row]
      await userEvent.clear(field)
      await userEvent.type(field, typed[row])
      await userEvent.tab()
    }

    // Every field holds the value the database will hold.
    await waitFor(() => expect(screen.getAllByDisplayValue('0,33333')).toHaveLength(3))
    // The total row formats to 4 decimals, so the 1e-5 the clamp leaves behind
    // rounds away and it reads 1,0000. That is precisely why the epsilon has to
    // forgive it: at 1e-6 the banner appeared next to a total the admin reads as
    // exactly 1,0000, saying "Tổng trọng số phải bằng 1.00 — hiện tại 1,0000".
    expect(screen.getByText('1,0000')).toBeInTheDocument()
    expect(screen.queryByText(/Tổng trọng số phải bằng/)).toBeNull()

    const save = screen.getByRole('button', { name: 'Lưu' })
    expect(save).toBeEnabled()
    await userEvent.click(save)

    await waitFor(() => expect(saveStages).toHaveBeenCalledTimes(1))
    expect((saveStages.mock.calls[0][1] as { weight: number }[]).map((s) => s.weight)).toEqual([
      0.33333, 0.33333, 0.33333,
    ])
  })

  it('disables save when the weights are a whole storable step away from 1', async () => {
    // 0.6 + 0.39998 is 0.99998: two units at scale 5, comfortably past
    // STAGE_WEIGHT_EPSILON. Widening the epsilon to absorb the clamp's own
    // residual must not have turned the Σ = 1 rule into a suggestion.
    render(<StageConfigPanel projectId="p1" />)
    const weight = await screen.findByDisplayValue('0,4')
    await userEvent.clear(weight)
    await userEvent.type(weight, '0,39998')
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
