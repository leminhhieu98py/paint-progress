import { App as AntApp } from 'antd'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { StagePlanTable, type StagePlanRow } from './StagePlanTable'
import { expectLeft } from '../../test/alignment'

const ROWS: StagePlanRow[] = [
  {
    stageId: 's1', workId: 'w1', deckId: 'd1',
    workName: 'Sơn', deckName: 'Cellar Deck', stageName: 'Công đoạn 1',
    plan: {
      stageId: 's1', workName: 'Sơn', stageName: 'Công đoạn 1',
      startDate: '2026-09-01', endDate: '2026-09-12', plannedAreaM2: 3300,
    },
  },
  {
    stageId: 's2', workId: 'w1', deckId: 'd1',
    workName: 'Sơn', deckName: 'Cellar Deck', stageName: 'Công đoạn 2',
    plan: {
      stageId: 's2', workName: 'Sơn', stageName: 'Công đoạn 2',
      startDate: '2026-09-09', endDate: '2026-09-16', plannedAreaM2: null,
    },
  },
  {
    stageId: 's3', workId: 'w1', deckId: 'd1',
    workName: 'Sơn', deckName: 'Cellar Deck', stageName: 'Công đoạn 3',
    plan: null,
  },
]

/** Remaining area is the screen's to compute; here it is a fixed answer per coat. */
const COMPUTED: Record<string, number> = { s1: 5000, s2: 8000, s3: 16000 }

describe('StagePlanTable — empty (CPY-01)', () => {
  it('names the step to take first, without the sentence on how plans are entered', () => {
    renderTable({ rows: [] })
    expect(screen.getByText('Thêm công việc và công đoạn cho sàn trước, rồi quay lại đây.')).toBeInTheDocument()
    expect(screen.queryByText(/Kế hoạch KPI được nhập theo từng công đoạn/)).toBeNull()
  })
})

function renderTable(over: Partial<Parameters<typeof StagePlanTable>[0]> = {}) {
  const onSave = vi.fn()
  const onClearArea = vi.fn()
  render(
    <AntApp>
      <StagePlanTable
        rows={ROWS}
        computedAreaFor={(row) => COMPUTED[row.stageId] ?? 0}
        onSave={onSave}
        onClearArea={onClearArea}
        {...over}
      />
    </AntApp>,
  )
  return { onSave, onClearArea }
}

const row = (stageId: string) => within(screen.getByTestId(`plan-row-${stageId}`))
const startOf = (stageId: string) => row(stageId).getByPlaceholderText('Bắt đầu')
const endOf = (stageId: string) => row(stageId).getByPlaceholderText('Kết thúc')
const saveOf = (stageId: string) => row(stageId).getByRole('button', { name: 'Lưu kế hoạch' })

const retype = async (input: HTMLElement, value: string) => {
  await userEvent.clear(input)
  await userEvent.type(input, value)
  await userEvent.keyboard('{Enter}')
}

describe('StagePlanTable', () => {
  it('lists one row per coat, including the ones with no window yet', async () => {
    renderTable()
    expect(screen.getByTestId('plan-row-s1')).toBeInTheDocument()
    expect(screen.getByTestId('plan-row-s2')).toBeInTheDocument()
    // A coat the admin has not planned yet still gets a row: an absent row
    // reads as "this coat does not exist", which is a different statement.
    expect(screen.getByTestId('plan-row-s3')).toBeInTheDocument()
    expect(row('s3').getByText('Công đoạn 3')).toBeInTheDocument()
    expect((startOf('s3') as HTMLInputElement).value).toBe('')
  })

  it('shows the stored window in the pickers', () => {
    renderTable()
    expect((startOf('s1') as HTMLInputElement).value).toBe('01/09/2026')
    expect((endOf('s1') as HTMLInputElement).value).toBe('12/09/2026')
  })

  it('keeps the dates whole at a narrow window: the table scrolls instead of squeezing (QA F9)', () => {
    // At 1024px the picker was cut to "10/09, → 20/09" -- the year gone --
    // and "Công đoạn" wrapped one word per line. Sized to its content, the
    // card scrolls sideways and every column keeps the width it asked for.
    renderTable()
    expect(screen.getByRole('columnheader', { name: 'Số ngày' }).closest('table'))
      .toHaveStyle({ width: 'max-content' })
    const picker = row('s1').getAllByTestId('plan-range-s1')[0].closest('.ant-picker')
    expect(picker).toHaveStyle({ minWidth: '250px' })
  })

  it('keeps Lưu in view while the table scrolls sideways (QA F9 follow-up)', () => {
    // Seen at 1024px after F9: the scrolling table pushed every row's Lưu past
    // the card's right edge. The save column is pinned to the right instead.
    renderTable()
    const save = row('s1').getByRole('button', { name: 'Lưu kế hoạch' })
    expect(save.closest('td')).toHaveClass('ant-table-cell-fix-right')
  })

  it('holds the window in one Khoảng kế hoạch column (Feedback Rv5, RV5-38)', () => {
    // The app already had a settled answer for a per-coat date range and this
    // table did not use it: DeckProgressPanel.tsx:582, "One RangePicker per
    // coat writes both ends at once".
    renderTable()
    expect(screen.getByRole('columnheader', { name: 'Khoảng kế hoạch' })).toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: 'Ngày bắt đầu' })).toBeNull()
    expect(screen.queryByRole('columnheader', { name: 'Ngày kết thúc' })).toBeNull()

    // One control per row, carrying both ends: antd puts the testid on each of
    // the RangePicker's two inputs, so exactly two is exactly one control.
    const inputs = row('s1').getAllByTestId('plan-range-s1')
    expect(inputs).toHaveLength(2)
    expect(inputs.map((i) => (i as HTMLInputElement).placeholder)).toEqual(['Bắt đầu', 'Kết thúc'])
  })

  it('leaves Lưu disabled while only one end of the range is set (RV5-39)', async () => {
    // `stage_plans.start_date` and `end_date` are both NOT NULL, so -- unlike
    // DeckProgressPanel, where a zone whose finish has slipped keeps its start
    // -- a half-typed window is not a state this table can store.
    const { onSave } = renderTable()

    await retype(startOf('s3'), '01/10/2026')
    expect((endOf('s3') as HTMLInputElement).value).toBe('')
    expect(saveOf('s3')).toBeDisabled()
    await userEvent.click(saveOf('s3'))
    expect(onSave).not.toHaveBeenCalled()

    await retype(endOf('s3'), '10/10/2026')
    await waitFor(() => expect(saveOf('s3')).toBeEnabled())
  })

  it('counts both ends in Số ngày, and recounts as the dates change', async () => {
    // RV5-22, =D-C+1. 01/09 to 12/09 inclusive is 12 days.
    renderTable()
    expect(row('s1').getByTestId('plan-days-s1')).toHaveTextContent('12')

    await retype(endOf('s1'), '20/09/2026')
    await waitFor(() => expect(row('s1').getByTestId('plan-days-s1')).toHaveTextContent('20'))

    // A same-day window is one day, never zero.
    await retype(startOf('s1'), '20/09/2026')
    await waitFor(() => expect(row('s1').getByTestId('plan-days-s1')).toHaveTextContent('1'))
  })

  it('refuses an end before the start with a message, and saves nothing backwards', async () => {
    // RV5-40 expected one RangePicker to make this branch unenterable. Measured
    // against antd 5.29 in jsdom, it does not: a date TYPED into the end box is
    // reported by `onCalendarChange` exactly as typed, and the inverted pair
    // sits in the draft -- still inverted 50 ms later -- until the control is
    // blurred, at which point antd silently swaps the two ends. Typing is how
    // an admin on a laptop uses this control, so the message stays: it is what
    // says why the row will not save.
    const { onSave } = renderTable()

    await retype(endOf('s1'), '01/08/2026')

    expect(await row('s1').findByText(/không được trước ngày bắt đầu/i)).toBeInTheDocument()
    expect(row('s1').getByTestId('plan-days-s1')).toHaveTextContent('—')
    expect(saveOf('s1')).toBeDisabled()

    // Clicking Lưu blurs the picker first, and antd's own swap lands before the
    // click does. Whichever way it resolves, nothing backwards reaches the
    // write -- `stage_plans_window` in 0033 is the backstop behind that.
    await userEvent.click(saveOf('s1'))
    for (const call of onSave.mock.calls) {
      const w = call[1] as { startDate: string; endDate: string }
      expect(w.endDate >= w.startDate).toBe(true)
    }
  })

  it('shows the computed figure rather than a blank when the area is empty', async () => {
    // RV5-23: the plan defaults to what the system computes as remaining on the
    // start date. A blank field would read as "no area planned", which is what
    // a typed 0 means instead.
    renderTable()
    const area = row('s2').getByLabelText('Diện tích kế hoạch')
    expect((area as HTMLInputElement).value).toBe('')
    // In the placeholder and nowhere under it (TBL-02): a helper line beneath
    // the field pushed the input, the picker and Lưu off one axis.
    expect(area).toHaveAttribute('placeholder', 'Tự tính 8.000,00')
    expect(row('s2').queryByTestId('plan-computed-s2')).toBeNull()
  })

  /** Mirrors `KpiScreen.computedAreaFor`, which short-circuits to 0 with no
   *  start date because there is no day to replay the deck's events up to. */
  const asOfStart = (r: StagePlanRow, startDate: string | null) =>
    (startDate === null ? 0 : COMPUTED[r.stageId] ?? 0)

  it('shows no computed area on a row with no window (Feedback Rv5, RV5-23)', () => {
    // The computed area is what remains ON the start date. With no start date
    // there is nothing to compute from, and `Tự tính: 0,00` reads as "the
    // system worked out zero" -- a different statement.
    renderTable({ computedAreaFor: asOfStart })
    // No zero placeholder standing in for a figure that does not exist.
    const area = row('s3').getByLabelText('Diện tích kế hoạch') as HTMLInputElement
    expect(area.value).toBe('')
    expect(area.placeholder).toBe('')
    // The rows that do have a window are untouched.
    expect(row('s2').getByLabelText('Diện tích kế hoạch'))
      .toHaveAttribute('placeholder', 'Tự tính 8.000,00')
  })

  it('shows the computed figure as soon as a start date is entered', async () => {
    renderTable({ computedAreaFor: asOfStart })
    await retype(startOf('s3'), '01/10/2026')
    await waitFor(() => expect(row('s3').getByLabelText('Diện tích kế hoạch'))
      .toHaveAttribute('placeholder', 'Tự tính 16.000,00'))
  })

  it('still prints a computed zero, which is not the same as no figure at all', () => {
    // A coat with genuinely nothing left computes 0,00 and has to say so. Only
    // the absence of a start date is undefined, so the branch turns on the
    // DATE and never on the value -- here every figure is zero and the two
    // rows must still read differently.
    renderTable({ computedAreaFor: () => 0 })
    expect(row('s2').getByLabelText('Diện tích kế hoạch')).toHaveAttribute('placeholder', 'Tự tính 0,00')
    expect((row('s3').getByLabelText('Diện tích kế hoạch') as HTMLInputElement).placeholder).toBe('')
  })

  it('sends the computed figure as null so the system keeps computing it', async () => {
    const { onSave } = renderTable()

    await retype(endOf('s2'), '18/09/2026')
    await userEvent.click(saveOf('s2'))

    await waitFor(() => expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ stageId: 's2' }),
      { startDate: '2026-09-09', endDate: '2026-09-18', plannedAreaM2: null },
    ))
  })

  it('sends a typed override instead of the computed figure', async () => {
    const { onSave } = renderTable()

    const area = row('s2').getByLabelText('Diện tích kế hoạch')
    await userEvent.clear(area)
    await userEvent.type(area, '1234')
    await userEvent.click(saveOf('s2'))

    await waitFor(() => expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ stageId: 's2' }),
      { startDate: '2026-09-09', endDate: '2026-09-16', plannedAreaM2: 1234 },
    ))
  })

  it('treats a typed zero as an override of zero, not as an empty field', async () => {
    // The distinction the whole nullable column exists for: 0 says this coat
    // plans no area, empty says work it out for me.
    const { onSave } = renderTable()

    const area = row('s2').getByLabelText('Diện tích kế hoạch')
    await userEvent.clear(area)
    await userEvent.type(area, '0')
    await userEvent.click(saveOf('s2'))

    await waitFor(() => expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ stageId: 's2' }),
      expect.objectContaining({ plannedAreaM2: 0 }),
    ))
    const sent = onSave.mock.calls[0][1] as { plannedAreaM2: number | null }
    expect(sent.plannedAreaM2).not.toBeNull()
  })

  it('returns a row to the computed figure when the override is cleared', async () => {
    // RV5-23: "a cleared override returns the row to the computed figure".
    const { onClearArea } = renderTable()

    const area = row('s1').getByLabelText('Diện tích kế hoạch')
    expect((area as HTMLInputElement).value).toBe('3300')

    await userEvent.click(row('s1').getByRole('button', { name: 'Về diện tích tự tính' }))

    expect(onClearArea).toHaveBeenCalledWith('s1')
    await waitFor(() => expect((row('s1').getByLabelText('Diện tích kế hoạch') as HTMLInputElement).value).toBe(''))
    expect(row('s1').getByLabelText('Diện tích kế hoạch'))
      .toHaveAttribute('placeholder', 'Tự tính 5.000,00')
  })

  it('offers no clear button on a row that carries no override', () => {
    renderTable()
    expect(row('s2').queryByRole('button', { name: 'Về diện tích tự tính' })).toBeNull()
  })

  it('refuses a negative area with a message', async () => {
    const { onSave } = renderTable()

    const area = row('s1').getByLabelText('Diện tích kế hoạch')
    await userEvent.clear(area)
    await userEvent.type(area, '-5')

    expect(await row('s1').findByText(/không được âm/i)).toBeInTheDocument()
    expect(saveOf('s1')).toBeDisabled()
    await userEvent.click(saveOf('s1'))
    expect(onSave).not.toHaveBeenCalled()
  })

  it('cannot save a coat until both dates are set', async () => {
    const { onSave } = renderTable()
    expect(saveOf('s3')).toBeDisabled()

    await retype(startOf('s3'), '01/10/2026')
    expect(saveOf('s3')).toBeDisabled()

    await retype(endOf('s3'), '10/10/2026')
    await waitFor(() => expect(saveOf('s3')).toBeEnabled())

    await userEvent.click(saveOf('s3'))
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ stageId: 's3' }),
      { startDate: '2026-10-01', endDate: '2026-10-10', plannedAreaM2: null },
    ))
  })

  it('locks every row while a save is in flight', () => {
    renderTable({ saving: true })
    expect(saveOf('s1')).toBeDisabled()
    expect(startOf('s1')).toBeDisabled()
    expect(row('s1').getByLabelText('Diện tích kế hoạch')).toBeDisabled()
  })

  it('renders an empty state rather than a bare table when the project has no coats', () => {
    renderTable({ rows: [] })
    expect(screen.getByText(/chưa có công đoạn nào/i)).toBeInTheDocument()
  })

  it('names the deck and the work on every row', () => {
    // Two works may carry identically-named coats on one deck (RV5-18), so the
    // coat name alone does not identify a row.
    renderTable()
    expect(row('s1').getByText('Cellar Deck')).toBeInTheDocument()
    expect(row('s1').getByText('Sơn')).toBeInTheDocument()
  })

  it('spells out the rules it applies', async () => {
    renderTable()
    await userEvent.click(screen.getByRole('button', { name: /Quy tắc áp dụng/ }))
    expect(screen.getByText(/chủ nhật/i)).toBeInTheDocument()
  })

  it('keys every rule uniquely, so React never warns about the two RV5-23 rules (CPY-05)', async () => {
    const warn = vi.spyOn(console, 'error').mockImplementation(() => {})
    renderTable()
    await userEvent.click(screen.getByRole('button', { name: /Quy tắc áp dụng/ }))
    expect(screen.getByText(/Gõ số 0 là ghi đè/)).toBeInTheDocument()
    expect(warn.mock.calls.flat().join(' ')).not.toMatch(/same key/)
    warn.mockRestore()
  })
})

describe('StagePlanTable — alignment (UI-03)', () => {
  it('centres the area field and the save button in their cells, not only the cell text', () => {
    renderTable()
    // The two cells wrap their controls in a flex box, and `text-align` on the
    // cell does not move a flex item: without its own centring the field and
    // the button sat at the left of a centred column.
    const areaCell = row('s1').getByLabelText('Diện tích kế hoạch').closest('td') as HTMLElement
    expect(areaCell).toHaveStyle({ textAlign: 'center' })
    expect(areaCell.firstElementChild).toHaveStyle({ justifyContent: 'center' })
    const saveCell = saveOf('s1').closest('td') as HTMLElement
    expect(saveCell).toHaveStyle({ textAlign: 'center' })
    expect(saveCell.firstElementChild).toHaveStyle({ alignItems: 'center' })
    expectLeft(row('s1').getByText('Công đoạn 1').closest('td'))
  })
})

describe('StagePlanTable — the area field holds still (UI-06 review I6)', () => {
  it('keeps the Tự tính slot laid out on every row, shown only on an override', async () => {
    renderTable()
    // The field and the button are centred as a group, so a button that
    // appeared on the first keystroke re-centred the group and moved the
    // field under the caret. The slot is always there; only its visibility
    // follows the override.
    const group = (stageId: string) =>
      (row(stageId).getByLabelText('Diện tích kế hoạch').closest('td') as HTMLElement).firstElementChild as HTMLElement
    const slot = (stageId: string) => group(stageId).lastElementChild as HTMLElement
    expect(group('s2').childElementCount).toBe(group('s1').childElementCount)
    expect(slot('s1')).toHaveStyle({ visibility: 'visible' })
    expect(slot('s2')).toHaveStyle({ visibility: 'hidden' })

    await userEvent.type(row('s2').getByLabelText('Diện tích kế hoạch'), '1')
    await waitFor(() => expect(slot('s2')).toHaveStyle({ visibility: 'visible' }))
    expect(group('s2').childElementCount).toBe(group('s1').childElementCount)
  })
})
