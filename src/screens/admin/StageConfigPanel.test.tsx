import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
// decksApi imports the supabase client at module scope, so stub that out to
// let importOriginal run without reaching for real credentials. Nothing in this
// file goes through it -- the two functions that would are mocked below.
vi.mock('../../lib/supabase', () => ({ supabase: { from: vi.fn() } }))
vi.mock('../../lib/decksApi', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../lib/decksApi')>()
  return {
    listStages: (id: string) => listStages(id),
    saveStages: (id: string, s: unknown) => saveStages(id, s),
    stagesRemovedBy: real.stagesRemovedBy,
    roundStageWeight: real.roundStageWeight,
    STAGE_WEIGHT_EPSILON: real.STAGE_WEIGHT_EPSILON,
  }
})

/**
 * Matches a list item by its whole rendered text. The removal list puts each
 * stage name in a <strong>, which splits the text across elements and makes the
 * default string matcher (direct text nodes only) miss it. Comparing the item's
 * full textContent also pins that the item is EXACTLY that stage, rather than
 * merely containing its name.
 */
const listItem = (text: string) => (_content: string, el: Element | null) =>
  el?.tagName === 'LI' && el.textContent === text

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
    render(<StageConfigPanel deckId="d1" />)
    expect(await screen.findByDisplayValue('Blast + Coat 1')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Coat 2')).toBeInTheDocument()
  })

  it('shows the running weight total', async () => {
    render(<StageConfigPanel deckId="d1" />)
    // Wait for the real stages to load first: before they do, `total` is 0
    // and the balance warning renders too (now also reading "phải bằng
    // 1,0000" -- B14's fix for its own hardcoded "1.00" -- so a bare
    // `findByText(/1,0000/)` can resolve against THAT transient node and then
    // fail `toBeInTheDocument()` a tick later when it unmounts, racing the
    // mocked listStages promise rather than testing the settled total.
    await screen.findByDisplayValue('Blast + Coat 1')
    // vi-VN formatting: comma decimal separator, matching the paperwork the
    // operators already read from.
    expect(await screen.findByText(/1,0000/)).toBeInTheDocument()
  })

  it('blocks save when the weights do not sum to 1', async () => {
    render(<StageConfigPanel deckId="d1" />)
    // vi-VN comma decimal, matching decimalSeparator="," on the field.
    const weight = await screen.findByDisplayValue('0,6')
    await userEvent.clear(weight)
    await userEvent.type(weight, '0,5')

    const save = screen.getByRole('button', { name: 'Lưu' })
    await waitFor(() => expect(save).toBeDisabled())
    expect(saveStages).not.toHaveBeenCalled()
  })

  it('enables save once the weights sum to 1 again', async () => {
    render(<StageConfigPanel deckId="d1" />)
    const weight = await screen.findByDisplayValue('0,4')
    await userEvent.clear(weight)
    await userEvent.type(weight, '0,4')
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Lưu' })).toBeEnabled(),
    )
  })

  it('saves each stage with the id it was loaded under', async () => {
    saveStages.mockResolvedValue(undefined)
    render(<StageConfigPanel deckId="d1" />)
    await screen.findByDisplayValue('Blast + Coat 1')
    // Nothing is being removed here, so Lưu saves directly -- see the
    // no-dialog test below.
    await userEvent.click(screen.getByRole('button', { name: 'Lưu' }))

    await waitFor(() => expect(saveStages).toHaveBeenCalledTimes(1))
    const [, stages] = saveStages.mock.calls[0]
    // saveStages keys its upsert on the id, so the id is the payload's most
    // important field: it is what makes the write land on the row whose progress
    // the admin was looking at. Dropping it would send an anonymous row set that
    // could only be matched by its mutable seq again.
    expect(stages).toEqual([
      { id: 's1', seq: 1, name: 'Blast + Coat 1', color: '#fadb14', weight: 0.6 },
      { id: 's2', seq: 2, name: 'Coat 2', color: '#bfbfbf', weight: 0.4 },
    ])
  })

  it('mints a fallback id via crypto.getRandomValues when randomUUID is unavailable', async () => {
    // crypto.randomUUID requires a secure context. Over plain http on a site
    // office's LAN IP it is simply not a function -- stubbing it away here is
    // what that insecure context looks like. Without the fallback this
    // throws and "Thêm lớp" does nothing, with no explanation on screen.
    const originalCrypto = globalThis.crypto
    vi.stubGlobal('crypto', {
      getRandomValues: originalCrypto.getRandomValues.bind(originalCrypto),
      randomUUID: undefined,
    })
    try {
      saveStages.mockResolvedValue(undefined)
      render(<StageConfigPanel deckId="d1" />)
      await screen.findByDisplayValue('Blast + Coat 1')

      await userEvent.click(screen.getByRole('button', { name: 'Thêm lớp' }))
      await userEvent.click(screen.getByRole('button', { name: 'Lưu' }))

      await waitFor(() => expect(saveStages).toHaveBeenCalledTimes(1))
      const saved = saveStages.mock.calls[0][1] as { id: string }[]
      // A real v4 uuid, from the fallback path, not a reused or empty one:
      // deck_stages.id is a uuid primary key.
      expect(saved[2].id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      )
    } finally {
      vi.stubGlobal('crypto', originalCrypto)
    }
  })

  it('mints an id for a stage the admin adds, so the upsert has one to key on', async () => {
    // A new row has no database id yet, and the id cannot be left for the
    // database to invent: the upsert keys on it. It is generated here, client
    // side, the moment the row appears.
    saveStages.mockResolvedValue(undefined)
    render(<StageConfigPanel deckId="d1" />)
    await screen.findByDisplayValue('Blast + Coat 1')
    await userEvent.click(screen.getByRole('button', { name: 'Thêm lớp' }))
    await userEvent.click(screen.getByRole('button', { name: 'Lưu' }))

    await waitFor(() => expect(saveStages).toHaveBeenCalledTimes(1))
    const saved = saveStages.mock.calls[0][1] as { id: string; seq: number }[]
    expect(saved).toHaveLength(3)
    expect(saved[2].id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    )
    // A real uuid, not a reused or empty one: deck_stages.id is a uuid
    // primary key, and colliding with an existing stage would make the upsert
    // overwrite that stage instead of inserting a new one.
    expect(saved.map((s) => s.id)).toEqual(['s1', 's2', saved[2].id])
  })

  it('saves a rename without any confirmation, keeping the row it renames', async () => {
    // A rename keeps every stage row, its id, its zones and every cell's
    // recorded progress: saveStages upserts on the id and deletes only the ids
    // that genuinely disappear. There is nothing to disclose, and a dialog on a
    // save that costs nothing is a dialog the admin learns to click through --
    // which is how the one that matters gets skimmed.
    saveStages.mockResolvedValue(undefined)
    render(<StageConfigPanel deckId="d1" />)
    const name = await screen.findByDisplayValue('Blast + Coat 1')
    await userEvent.clear(name)
    await userEvent.type(name, 'Blast + Coat 1 (renamed)')

    await userEvent.click(screen.getByRole('button', { name: 'Lưu' }))

    await waitFor(() => expect(saveStages).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('dialog')).toBeNull()
    const saved = saveStages.mock.calls[0][1] as Record<string, unknown>[]
    // The new name arrives attached to the id it was typed on, so the write
    // renames that stage rather than relabelling whatever sits at its seq.
    expect(saved[0]).toEqual({
      id: 's1', seq: 1, name: 'Blast + Coat 1 (renamed)', color: '#fadb14', weight: 0.6,
    })
  })

  it('names the stage actually being removed, and what removing it destroys', async () => {
    // The MIDDLE stage, which is the case a seq-keyed diff got wrong: the panel
    // renumbers 1..n, so the seq that disappears is 3 and the old dialog
    // announced the deletion of "Tháo giáo" while the database deleted "Coat 2".
    // The disclosure has to name the stage whose id is going.
    //
    // zones.stage_id references deck_stages ON DELETE CASCADE and
    // cells.stage_id ON DELETE SET NULL, so a removal nulls the cells sitting at
    // that stage and deletes the zones planned against it. Both consequences are
    // named; the wording this replaced mentioned neither zones nor which stage.
    listStages.mockResolvedValue([
      { id: 's1', seq: 1, name: 'Blast + Coat 1', color: '#fadb14', weight: 0.5 },
      { id: 's2', seq: 2, name: 'Coat 2', color: '#bfbfbf', weight: 0.3 },
      { id: 's3', seq: 3, name: 'Tháo giáo', color: '#722ed1', weight: 0.2 },
    ])
    saveStages.mockResolvedValue(undefined)
    render(<StageConfigPanel deckId="d1" />)
    await screen.findByDisplayValue('Tháo giáo')

    await userEvent.click(screen.getAllByRole('button', { name: 'Xoá' })[1])
    // Put the freed weight back on an existing row so Lưu is enabled again.
    const weight = screen.getByDisplayValue('0,5')
    await userEvent.clear(weight)
    await userEvent.type(weight, '0,8')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Lưu' })).toBeEnabled())

    await userEvent.click(screen.getByRole('button', { name: 'Lưu' }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Xoá lớp sơn khỏi cấu hình?')).toBeInTheDocument()
    expect(within(dialog).getByText(listItem('Coat 2'))).toBeInTheDocument()
    // The survivors are not named, because nothing happens to them: Tháo giáo
    // keeps its row, its id and its cells' recorded progress even though its seq
    // is renumbered from 3 to 2. Naming it here is precisely the old defect.
    expect(within(dialog).queryByText(listItem('Tháo giáo'))).toBeNull()
    expect(within(dialog).queryByText(listItem('Blast + Coat 1'))).toBeNull()
    // Both consequences of the delete, named: the cells at that stage are reset,
    // and the zones planned against it go with it.
    expect(within(dialog).getByText(/trở về trạng thái chưa bắt đầu/)).toBeInTheDocument()
    expect(within(dialog).getByText(/xoá luôn các zone đã lên kế hoạch/)).toBeInTheDocument()
    expect(saveStages).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Vẫn lưu' }))
    await waitFor(() => expect(saveStages).toHaveBeenCalledTimes(1))
    // s2 is gone; s1 and s3 survive with their own ids, s3 renumbered to seq 2.
    const saved = saveStages.mock.calls[0][1] as { id: string; seq: number }[]
    expect(saved.map((s) => [s.id, s.seq])).toEqual([
      ['s1', 1],
      ['s3', 2],
    ])
  })

  it('saves a reorder with no dialog, because a reorder moves no recorded progress', async () => {
    // The disclosure this replaced existed because a seq-keyed upsert rewrote
    // each seq in place: swapping seq 2 and 3 left every cell where it was and
    // renamed the layer over the top of it, so a cell recorded at Coat 2 was
    // thereafter counted as Coat 3 -- a later, heavier stage, and the deck's
    // reported percentage rose with nothing deleted. Keyed on the id, a reorder
    // rewrites display order and nothing else: there is nothing to disclose, and
    // a dialog claiming otherwise would be teaching the admin something false.
    listStages.mockResolvedValue([
      { id: 's1', seq: 1, name: 'Blast + Coat 1', color: '#fadb14', weight: 0.5 },
      { id: 's2', seq: 2, name: 'Coat 2', color: '#bfbfbf', weight: 0.3 },
      { id: 's3', seq: 3, name: 'Coat 3', color: '#52c41a', weight: 0.2 },
    ])
    saveStages.mockResolvedValue(undefined)
    render(<StageConfigPanel deckId="d1" />)
    await screen.findByDisplayValue('Coat 3')

    // Move Coat 3 up one: it takes seq 2 and Coat 2 takes seq 3.
    await userEvent.click(screen.getAllByRole('button', { name: 'Lên' })[2])
    await userEvent.click(screen.getByRole('button', { name: 'Lưu' }))

    await waitFor(() => expect(saveStages).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('dialog')).toBeNull()
    // Each stage arrives under its own id, with only seq changed -- so every
    // cells.stage_id and zones.stage_id still points at the stage it always did.
    const saved = saveStages.mock.calls[0][1] as { id: string; name: string; seq: number }[]
    expect(saved.map((s) => [s.id, s.name, s.seq])).toEqual([
      ['s1', 'Blast + Coat 1', 1],
      ['s3', 'Coat 3', 2],
      ['s2', 'Coat 2', 3],
    ])
  })

  it('calls onSaved after a save actually persists, so the parent can refresh its own rollup', async () => {
    saveStages.mockResolvedValue(undefined)
    const onSaved = vi.fn()
    render(<StageConfigPanel deckId="d1" onSaved={onSaved} />)
    await screen.findByDisplayValue('Blast + Coat 1')

    await userEvent.click(screen.getByRole('button', { name: 'Lưu' }))

    await waitFor(() => expect(saveStages).toHaveBeenCalledTimes(1))
    expect(onSaved).toHaveBeenCalledTimes(1)
  })

  it('does not call onSaved when the save fails', async () => {
    saveStages.mockRejectedValue(new Error('permission denied'))
    const onSaved = vi.fn()
    render(<StageConfigPanel deckId="d1" onSaved={onSaved} />)
    await screen.findByDisplayValue('Blast + Coat 1')

    await userEvent.click(screen.getByRole('button', { name: 'Lưu' }))

    await screen.findByText(/permission denied/)
    expect(onSaved).not.toHaveBeenCalled()
  })

  it('surfaces a save failure and closes the confirmation modal', async () => {
    // Driven through the removal path so there is a modal to close in the first
    // place.
    listStages.mockResolvedValue([
      { id: 's1', seq: 1, name: 'Blast + Coat 1', color: '#fadb14', weight: 1 },
      { id: 's2', seq: 2, name: 'Coat 2', color: '#bfbfbf', weight: 0 },
    ])
    saveStages.mockRejectedValue(new Error('Stage weights must sum to 1, got 0.9000'))
    render(<StageConfigPanel deckId="d1" />)
    await screen.findByDisplayValue('Coat 2')
    await userEvent.click(screen.getAllByRole('button', { name: 'Xoá' })[1])
    await userEvent.click(screen.getByRole('button', { name: 'Lưu' }))
    await userEvent.click(screen.getByRole('button', { name: 'Vẫn lưu' }))
    // Translated, not the raw domain wording: an admin cannot act on
    // "Stage weights must sum to 1, got 0.9000" in an otherwise Vietnamese UI.
    expect(await screen.findByText(/Tổng trọng số các lớp phải bằng 1/)).toBeInTheDocument()
    expect(screen.queryByText(/must sum to 1/i)).toBeNull()
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

  it('translates a raw Postgres duplicate-key error instead of showing it', async () => {
    // C1's last line of defence. saveStages deletes before it upserts now, so
    // nothing this panel can do should provoke this -- but the two statements
    // were the other way round once, and while they were, removing any stage but
    // the last put `duplicate key value violates unique constraint
    // "deck_stages_deck_id_seq_key"` verbatim into an otherwise
    // Vietnamese-only Alert. If that order is ever restored, the admin at least
    // gets a sentence they can act on.
    saveStages.mockRejectedValue(new Error(
      'duplicate key value violates unique constraint "deck_stages_deck_id_seq_key"',
    ))
    render(<StageConfigPanel deckId="d1" />)
    await screen.findByDisplayValue('Coat 2')

    await userEvent.click(screen.getByRole('button', { name: 'Lưu' }))

    expect(await screen.findByText(/thứ tự các lớp bị trùng/)).toBeInTheDocument()
    expect(screen.queryByText(/duplicate key/i)).toBeNull()
    expect(screen.queryByText(/unique constraint/i)).toBeNull()
  })

  it('does not touch an infrastructure error the translator does not recognise', async () => {
    // Anything unmatched must fall through unchanged, or a new domain error
    // could be silently swallowed instead of reaching the admin.
    saveStages.mockRejectedValue(new Error('permission denied for table deck_stages'))
    render(<StageConfigPanel deckId="d1" />)
    await screen.findByDisplayValue('Coat 2')

    await userEvent.click(screen.getByRole('button', { name: 'Lưu' }))

    expect(await screen.findByText('permission denied for table deck_stages')).toBeInTheDocument()
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

    render(<StageConfigPanel deckId="d1" />)
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
    render(<StageConfigPanel deckId="d1" />)
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
    render(<StageConfigPanel deckId="d1" />)
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
    render(<StageConfigPanel deckId="d1" />)
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
    render(<StageConfigPanel deckId="d1" />)
    const weight = await screen.findByDisplayValue('0,4')
    await userEvent.clear(weight)
    await userEvent.type(weight, '0,39998')
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Lưu' })).toBeDisabled(),
    )
  })

  it('removes a stage', async () => {
    render(<StageConfigPanel deckId="d1" />)
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
    render(<StageConfigPanel deckId="d1" />)
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
    render(<StageConfigPanel deckId="d1" />)
    await screen.findByDisplayValue('Only')
    // A project with no stages has no defined progress at all.
    expect(screen.getByRole('button', { name: 'Xoá' })).toBeDisabled()
  })

  it('moves a stage up and renumbers seq contiguously', async () => {
    render(<StageConfigPanel deckId="d1" />)
    await screen.findByDisplayValue('Coat 2')
    await userEvent.click(screen.getAllByRole('button', { name: 'Lên' })[1])

    const names = screen.getAllByRole('textbox').map((i) => (i as HTMLInputElement).value)
    expect(names).toEqual(['Coat 2', 'Blast + Coat 1'])
    // Cumulative progress reads stages by seq, so gaps or ties would corrupt it.
    expect(screen.getAllByText(/^[12]$/).map((n) => n.textContent)).toEqual(['1', '2'])
  })

  it('refuses to save two stages under one name or one colour', async () => {
    // A name and a colour are how a stage is recognised, and by two different
    // people: the admin reads the name in the report, the GS reads the colour
    // off the drawing and nothing else. Two stages sharing either make a deck
    // that cannot be read back, and no error afterwards would say which of the
    // two a given bay is at.
    listStages.mockResolvedValue([
      { id: 's1', seq: 1, name: 'Coat 1', color: '#1677ff', weight: 0.5 },
      { id: 's2', seq: 2, name: 'Coat 2', color: '#52c41a', weight: 0.5 },
    ])
    render(<StageConfigPanel deckId="d1" />)
    await screen.findByDisplayValue('Coat 1')

    const second = screen.getAllByRole('textbox')[1]
    await userEvent.clear(second)
    await userEvent.type(second, 'coat 1 ')

    expect(await screen.findByText('Hai lớp sơn đang trùng nhau')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Lưu' })).toBeDisabled()
    expect(saveStages).not.toHaveBeenCalled()
  })

  it('reorders the stages when one is dragged onto another', async () => {
    // Top to bottom is innermost to outermost: the order the GS ticks them in
    // and the order cumulative progress reads them in. Renumbering seq from the
    // list's own order is what makes the drag mean anything.
    listStages.mockResolvedValue([
      { id: 's1', seq: 1, name: 'Coat 1', color: '#1677ff', weight: 0.5 },
      { id: 's2', seq: 2, name: 'Coat 2', color: '#52c41a', weight: 0.5 },
    ])
    render(<StageConfigPanel deckId="d1" />)
    await screen.findByDisplayValue('Coat 1')

    const rows = document.querySelectorAll('.ant-table-tbody .ant-table-row')
    fireEvent.dragStart(rows[1])
    fireEvent.dragOver(rows[0])
    fireEvent.drop(rows[0])

    // Coat 2 is now first, and carries seq 1 with it.
    await waitFor(() => expect(screen.getAllByRole('textbox')[0]).toHaveValue('Coat 2'))
    expect(screen.getByTestId('seq-0')).toHaveTextContent('1')
    expect(screen.getByTestId('seq-1')).toHaveTextContent('2')
  })
})
