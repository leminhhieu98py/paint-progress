import { App as AntApp } from 'antd'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { palette } from '../../theme'
import { StagePlanTable, type StagePlanRow } from './StagePlanTable'
import { expectLeft } from '../../test/alignment'
import { weightOf } from '../../test/typography'
import { expectOneHeight } from '../../test/controls'
import { expectHelperText, keyFactTexts, ruleTexts } from '../../test/copy'

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

describe('StagePlanTable — facts (HLT-01)', () => {
  it('counts the coats and the planned ones beside the title as KeyFacts', () => {
    renderTable()
    expect(keyFactTexts()).toEqual(['3 công đoạn', '2 đã có kế hoạch'])
  })
})

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
const saveOf = (stageId: string) => row(stageId).getByRole('button', { name: 'Lưu' })
/** The text of Tự động tính's tooltip on a row, read by hovering it. */
const autoTip = async (stageId: string) => {
  const button = row(stageId).getByRole('button', { name: 'Tự động tính' })
  const anchor = button.parentElement as HTMLElement
  // A tooltip from an earlier hover can linger in jsdom: read the new one.
  const before = new Set(screen.queryAllByRole('tooltip'))
  await userEvent.hover(anchor)
  const tip = await waitFor(() => {
    const fresh = screen.queryAllByRole('tooltip').find((t) => !before.has(t))
    if (!fresh) throw new Error('no new tooltip')
    return fresh
  })
  const text = tip.textContent ?? ''
  await userEvent.unhover(anchor)
  return text
}

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

  it('titles the column of Lưu Thao tác, like every other action column (M20)', () => {
    renderTable()
    expect(screen.getByRole('columnheader', { name: 'Thao tác' })).toBeInTheDocument()
  })

  it('keeps Lưu in view while the table scrolls sideways (QA F9 follow-up)', () => {
    // Seen at 1024px after F9: the scrolling table pushed every row's Lưu past
    // the card's right edge. The save column is pinned to the right instead.
    renderTable()
    const save = row('s1').getByRole('button', { name: 'Lưu' })
    expect(save.closest('td')).toHaveClass('ant-table-cell-fix-right')
  })

  it('holds the window in one Dự kiến triển khai column (Feedback Rv5, RV5-38, AD18)', () => {
    // The app already had a settled answer for a per-coat date range and this
    // table did not use it: DeckProgressPanel.tsx:582, "One RangePicker per
    // coat writes both ends at once".
    renderTable()
    expect(screen.getByRole('columnheader', { name: 'Dự kiến triển khai' })).toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: 'Khoảng kế hoạch' })).toBeNull()
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

    // On the picker itself, as its error status and its tooltip: a caption
    // under Lưu broke the row's one axis (M10, TBL-02).
    const picker = row('s1').getAllByTestId('plan-range-s1')[0].closest('.ant-picker') as HTMLElement
    await waitFor(() => expect(picker).toHaveClass('ant-picker-status-error'))
    expect(row('s1').queryByText(/không được trước ngày bắt đầu/i)).toBeNull()
    await userEvent.hover(picker)
    expect(await screen.findByRole('tooltip')).toHaveTextContent(/không được trước ngày bắt đầu/i)
    expect(row('s1').getByTestId('plan-days-s1')).toHaveTextContent(/^-$/)
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

  it('leaves an empty area field empty, with no placeholder: empty means the automatic figure (AD18)', async () => {
    // RV5-23: the plan defaults to what the system computes as remaining on the
    // start date. The figure is on Tự động tính's tooltip now, not in the field.
    renderTable()
    const area = row('s2').getByLabelText('Diện tích kế hoạch') as HTMLInputElement
    expect(area.value).toBe('')
    expect(area.placeholder).toBe('')
    expect(await autoTip('s2')).toBe('Tự động tính · 8.000,00 m²')
    expect(row('s2').queryByTestId('plan-computed-s2')).toBeNull()
  })

  /** Mirrors `KpiScreen.computedAreaFor`, which short-circuits to 0 with no
   *  start date because there is no day to replay the deck's events up to. */
  const asOfStart = (r: StagePlanRow, startDate: string | null) =>
    (startDate === null ? 0 : COMPUTED[r.stageId] ?? 0)

  it('names no computed area on a row with no window (Feedback Rv5, RV5-23)', async () => {
    // The computed area is what remains ON the start date. With no start date
    // there is nothing to compute from, and a 0,00 reads as "the system worked
    // out zero" -- a different statement.
    renderTable({ computedAreaFor: asOfStart })
    expect(await autoTip('s3')).toBe('Tự động tính')
    expect(await autoTip('s2')).toBe('Tự động tính · 8.000,00 m²')
  })

  it('names the computed figure as soon as a start date is entered', async () => {
    renderTable({ computedAreaFor: asOfStart })
    await retype(startOf('s3'), '01/10/2026')
    await waitFor(async () => expect(await autoTip('s3')).toBe('Tự động tính · 16.000,00 m²'))
  })

  it('still names a computed zero, which is not the same as no figure at all', async () => {
    // A coat with genuinely nothing left computes 0,00 and has to say so. Only
    // the absence of a start date is undefined.
    renderTable({ computedAreaFor: () => 0 })
    expect(await autoTip('s2')).toBe('Tự động tính · 0,00 m²')
    expect(await autoTip('s3')).toBe('Tự động tính')
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

  it('reads an override typed the Vietnamese way, with a decimal comma and thousands dots', async () => {
    // antd's InputNumber with no decimalSeparator deletes the comma: "1.234,5"
    // was sent as 1.2345 m², and "2,5" as 25.
    const { onSave } = renderTable()

    const area = row('s2').getByLabelText('Diện tích kế hoạch')
    await userEvent.clear(area)
    await userEvent.type(area, '1.234,5')
    await userEvent.click(saveOf('s2'))

    await waitFor(() => expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ stageId: 's2' }),
      { startDate: '2026-09-09', endDate: '2026-09-16', plannedAreaM2: 1234.5 },
    ))

    onSave.mockClear()
    await userEvent.clear(area)
    await userEvent.type(area, '2,5')
    await userEvent.click(saveOf('s2'))

    await waitFor(() => expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ stageId: 's2' }),
      { startDate: '2026-09-09', endDate: '2026-09-16', plannedAreaM2: 2.5 },
    ))
  })

  it('reads "8.000" as eight thousand m², the way its own placeholder writes areas', async () => {
    // The placeholder shows "8.000,00". Under the general rule a lone dot is
    // the decimal point and "8.000" would plan 8 m²; an area field reads a dot
    // before exactly three digits as thousands instead.
    const { onSave } = renderTable()

    const area = row('s2').getByLabelText('Diện tích kế hoạch')
    await userEvent.clear(area)
    await userEvent.type(area, '8.000')
    await userEvent.click(saveOf('s2'))

    await waitFor(() => expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ stageId: 's2' }),
      { startDate: '2026-09-09', endDate: '2026-09-16', plannedAreaM2: 8000 },
    ))

    onSave.mockClear()
    await userEvent.clear(area)
    await userEvent.type(area, '8.5')
    await userEvent.click(saveOf('s2'))

    await waitFor(() => expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ stageId: 's2' }),
      { startDate: '2026-09-09', endDate: '2026-09-16', plannedAreaM2: 8.5 },
    ))
  })

  it('edits a stored area in place by one digit at its real magnitude', async () => {
    // The field shows 3300 ungrouped on purpose. Grouped as "3.300", adding
    // a digit at the end gave "3.3000" and deleting one gave "3.30" -- no
    // longer a thousands group, so both saved 3.3 m².
    const { onSave } = renderTable()
    const area = row('s1').getByLabelText('Diện tích kế hoạch') as HTMLInputElement
    expect(area.value).toBe('3300')

    // userEvent.type puts the caret at the end of the current text.
    await userEvent.type(area, '0')
    await userEvent.click(saveOf('s1'))
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ stageId: 's1' }),
      { startDate: '2026-09-01', endDate: '2026-09-12', plannedAreaM2: 33000 },
    ))

    onSave.mockClear()
    await userEvent.type(area, '{Backspace}{Backspace}')
    await userEvent.click(saveOf('s1'))
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ stageId: 's1' }),
      { startDate: '2026-09-01', endDate: '2026-09-12', plannedAreaM2: 330 },
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

    await userEvent.click(row('s1').getByRole('button', { name: 'Tự động tính' }))

    expect(onClearArea).toHaveBeenCalledWith('s1')
    await waitFor(() => expect((row('s1').getByLabelText('Diện tích kế hoạch') as HTMLInputElement).value).toBe(''))
    expect(row('s1').getByRole('button', { name: 'Tự động tính' })).toBeDisabled()
  })

  it('keeps Tự động tính in its slot but disabled on a row that carries no override (AD18)', () => {
    renderTable()
    expect(row('s2').getByRole('button', { name: 'Tự động tính' })).toBeDisabled()
    expect(row('s1').getByRole('button', { name: 'Tự động tính' })).toBeEnabled()
  })

  it('refuses a negative area with a message', async () => {
    const { onSave } = renderTable()

    const area = row('s1').getByLabelText('Diện tích kế hoạch')
    await userEvent.clear(area)
    await userEvent.type(area, '-5')

    // On the field, as its error status and its tooltip (M10, TBL-02).
    const box = area.closest('.ant-input-number') as HTMLElement
    await waitFor(() => expect(box).toHaveClass('ant-input-number-status-error'))
    expect(row('s1').queryByText(/không được âm/i)).toBeNull()
    await userEvent.hover(area)
    expect(await screen.findByRole('tooltip')).toHaveTextContent(/không được âm/i)
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

  it('spells out the rules it applies as helper text (RUL-01)', async () => {
    renderTable()
    await userEvent.click(screen.getByRole('button', { name: /Quy tắc áp dụng/ }))
    expect(ruleTexts()).toEqual([
      'Kế hoạch chia đều cho mọi ngày từ ngày bắt đầu đến ngày kết thúc, kể cả chủ nhật và ngày lễ.',
      'Để trống diện tích kế hoạch thì hệ thống tự tính phần còn lại của công đoạn từ ngày bắt đầu.',
      'Số anh gõ ghi đè diện tích tự tính cho tới khi bấm Tự động tính cạnh Lưu.',
      'Gõ 0 nghĩa là không có diện tích kế hoạch, khác với để trống.',
    ])
    expectHelperText(ruleTexts())
  })

  it('keys every rule uniquely, so React never warns about the RV5-23 rules (CPY-05)', async () => {
    const warn = vi.spyOn(console, 'error').mockImplementation(() => {})
    renderTable()
    await userEvent.click(screen.getByRole('button', { name: /Quy tắc áp dụng/ }))
    expect(screen.getByText(/Gõ 0 nghĩa là/)).toBeInTheDocument()
    expect(warn.mock.calls.flat().join(' ')).not.toMatch(/same key/)
    warn.mockRestore()
  })
})

describe('StagePlanTable — type scale (TYP-02)', () => {
  it('sets the stage name and the plan days as body text, not bold (R3-C)', () => {
    renderTable()
    expect(weightOf(row('s1').getByText('Công đoạn 1'))).toBe(400)
    expect(weightOf(screen.getByTestId('plan-days-s1'))).toBe(400)
  })
})

describe('StagePlanTable — one control height per row (CTL-01)', () => {
  it('stands the picker, the area field, Tự động tính and Lưu at the theme height (CTL-02)', async () => {
    renderTable()
    expectOneHeight(screen.getByTestId('plan-row-s1'))
    expectOneHeight(screen.getByTestId('plan-row-s2'))
  })

  it('lets the area field take its column\'s width, with no slot reserved beside it (AD18)', () => {
    renderTable()
    const field = row('s1').getByLabelText('Diện tích kế hoạch').closest('.ant-input-number') as HTMLElement
    expect(field).toHaveStyle({ width: '100%' })
    const cell = field.closest('td') as HTMLElement
    expect(within(cell).queryByRole('button', { name: /Tự động tính|Tự tính/ })).toBeNull()
  })
})

describe('StagePlanTable — pager and drafts follow the scope (M10, UI-05)', () => {
  const many = Array.from({ length: 12 }, (_, i) => ({
    ...ROWS[0], stageId: `m${i}`, stageName: `Coat ${i + 1}`,
  }))
  const table = (scopeKey: string) => (
    <AntApp>
      <StagePlanTable rows={many} computedAreaFor={() => 0} onSave={vi.fn()} onClearArea={vi.fn()} scopeKey={scopeKey} />
    </AntApp>
  )

  it('goes back to page 1 when Tìm applies, with the same rows', async () => {
    const { rerender } = render(table('p1|0'))
    await userEvent.click(screen.getByTitle('2'))
    expect(screen.getByTitle('2')).toHaveClass('ant-pagination-item-active')
    rerender(table('p1|1'))
    expect(screen.getByTitle('1')).toHaveClass('ant-pagination-item-active')
  })

  it('drops the drafts typed under the scope before', async () => {
    const { rerender } = render(table('p1|0'))
    const area = within(screen.getByTestId('plan-row-m0')).getByLabelText('Diện tích kế hoạch')
    await userEvent.clear(area)
    await userEvent.type(area, '77')
    expect(area).toHaveValue('77')
    rerender(table('p1|1'))
    expect(within(screen.getByTestId('plan-row-m0')).getByLabelText('Diện tích kế hoạch')).not.toHaveValue('77')
  })
})

describe('StagePlanTable — Lưu only for a changed row (M10)', () => {
  it('keeps Lưu off on a stored window nobody has changed, and on once it is', async () => {
    renderTable()
    // s1 is stored, complete and valid; nothing to save until it changes.
    expect(saveOf('s1')).toBeDisabled()
    const area = row('s1').getByLabelText('Diện tích kế hoạch')
    await userEvent.clear(area)
    await userEvent.type(area, '4321')
    await waitFor(() => expect(saveOf('s1')).toBeEnabled())
  })
})

describe('StagePlanTable — row actions are icons (ACT-01)', () => {
  it('shows Tự động tính and Lưu as icon buttons named by their labels, with no visible text', async () => {
    renderTable()
    for (const name of ['Tự động tính', 'Lưu']) {
      const button = row('s1').getByRole('button', { name })
      expect(button).toHaveClass('ant-btn-icon-only')
      expect(button).toHaveTextContent('')
      expect(button).not.toHaveClass('ant-btn-sm')
    }
  })
})

describe('StagePlanTable — names are one class (AD5, UI-06)', () => {
  it('sets Sàn, Công việc and Công đoạn in the one text colour, body weight', () => {
    renderTable()
    for (const text of ['Cellar Deck', 'Sơn', 'Công đoạn 1']) {
      const el = row('s1').getByText(text)
      expect(el).toHaveStyle({ color: palette.text, fontSize: '13px', fontWeight: '400' })
    }
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

describe('StagePlanTable — Tự động tính sits beside Lưu (AD18)', () => {
  it('puts Tự động tính then Lưu in the Thao tác cell of every row, in one fixed slot order', () => {
    renderTable()
    for (const id of ['s1', 's2', 's3']) {
      const cell = saveOf(id).closest('td') as HTMLElement
      expect(within(cell).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['Tự động tính', 'Lưu'])
    }
  })
})
