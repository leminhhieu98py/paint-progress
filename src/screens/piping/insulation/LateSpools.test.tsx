import { act, fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SEARCH_DEBOUNCE_MS } from '../../../components/useDebouncedValue'
import { MILESTONE_LABEL, type LateWarning } from '../../../domain/piping/cam'
import { expectNoSpecIds, keyFactTexts } from '../../../test/copy'
import { renderApp } from '../../../test/renderApp'
import { chooseOption, optionTitles } from '../../../test/select'
import { setViewport } from '../../../test/viewport'
import { LateSpools } from './LateSpools'

const warning = (spoolId: string, over: Partial<LateWarning> = {}): LateWarning => ({
  spoolId, spoolNo: `SP-${spoolId}`, lineNo: 'L1', testPackageNo: 'TP1', milestone: 'ph', department: 'Piping',
  plan: '2026-09-01', actual: null, daysLate: 36, ...over,
})

const WARNINGS: LateWarning[] = [
  warning('a', { testPackageNo: 'TP2', lineNo: 'L9' }),
  warning('a', {
    testPackageNo: 'TP2', lineNo: 'L9', milestone: 'iw', department: 'Insulation', plan: '2026-09-10',
    actual: '2026-09-25', daysLate: 15,
  }),
  warning('b', { testPackageNo: 'TP1', milestone: 'ih', department: 'Painting' }),
]

const card = () => screen.getByRole('heading', { level: 2, name: 'Spool trễ' }).closest('section') ?? document.body
const tableRows = (root: HTMLElement) => within(root).getAllByRole('row')
  .filter((r) => within(r).queryAllByRole('cell').length > 0)
  .map((r) => within(r).getAllByRole('cell').map((c) => c.textContent))

let undoViewport: () => void
beforeEach(() => {
  undoViewport = setViewport(1280)
})
afterEach(() => undoViewport())

describe('LateSpools (spec §7)', () => {
  it('lists Packages with their late spools and late milestones, counted per milestone', () => {
    renderApp(<LateSpools projectId="p1" warnings={WARNINGS} thresholdDays={7} />)
    expect(keyFactTexts(card())).toEqual(['2 spool'])
    expect(screen.getByLabelText(
      'Spool có ít nhất một mốc trễ quá 7 ngày so với ngày Plan (chưa có Actual thì tính đến hôm nay)',
    )).toBeInTheDocument()
    const header = within(screen.getByTestId('late-spools')).getAllByRole('columnheader').map((h) => h.textContent)
    expect(header).toEqual(expect.arrayContaining([
      'Test Package No', 'Số spool trễ', 'Painting Handover', 'Insulation Handover', 'Insulation Work',
    ]))
    expect(tableRows(screen.getByTestId('late-spools')).map((r) => r.slice(1))).toEqual([
      ['TP1', '1', '0', '1', '0'],
      ['TP2', '1', '1', '0', '1'],
    ])
    expectNoSpecIds()
  })

  it('opens a group to its spools: milestone, department, plan, actual and days late', async () => {
    const user = userEvent.setup()
    renderApp(<LateSpools projectId="p1" warnings={WARNINGS} thresholdDays={7} />)
    const tp2 = within(screen.getByTestId('late-spools')).getAllByRole('row').find((r) => within(r).queryByText('TP2')) as HTMLElement
    const toggle = within(tp2).getByRole('button', { name: 'Xem spool của TP2' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await user.hover(toggle)
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Xem spool của TP2')
    await user.click(toggle)
    expect(within(tp2).getByRole('button', { name: 'Ẩn spool của TP2' })).toHaveAttribute('aria-expanded', 'true')
    const list = screen.getByTestId('late-spool-list')
    expect(within(list).getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
      'SpoolNo', 'Mốc', 'Bộ phận', 'Plan', 'Actual', 'Số ngày trễ',
    ])
    expect(tableRows(list)).toEqual([
      ['SP-a', 'Painting Handover', 'Piping', '01/09/2026', '-', '36'],
      ['SP-a', 'Insulation Work', 'Insulation', '10/09/2026', '25/09/2026', '15'],
    ])
    expect(within(list).getAllByLabelText(/Painting Handover: Piping bàn giao cho Painting/).length).toBeGreaterThan(0)
  })

  it('groups by Line from a searchable select', async () => {
    renderApp(<LateSpools projectId="p1" warnings={WARNINGS} thresholdDays={7} />)
    expect(await optionTitles('Nhóm spool trễ theo')).toEqual(['Package', 'Line', 'Spool'])
    await chooseOption('Nhóm spool trễ theo', 'Line')
    const table = screen.getByTestId('late-spools')
    expect(within(table).getAllByRole('columnheader')[1].textContent).toBe('LineNo')
    expect(tableRows(table).map((r) => r.slice(1, 3))).toEqual([['L1', '1'], ['L9', '1']])
  })

  it('puts the spools with no package in a last "-" row', () => {
    renderApp(<LateSpools projectId="p1" warnings={[warning('c', { testPackageNo: null }), ...WARNINGS]} thresholdDays={7} />)
    expect(tableRows(screen.getByTestId('late-spools')).map((r) => r[1])).toEqual(['TP1', 'TP2', '-'])
    expect(screen.getByRole('button', { name: 'Xem spool không có Package' })).toBeInTheDocument()
  })

  it('names the "-" Line group in its toggle', async () => {
    renderApp(<LateSpools projectId="p1" warnings={[warning('c', { lineNo: null }), ...WARNINGS]} thresholdDays={7} />)
    await chooseOption('Nhóm spool trễ theo', 'Line')
    expect(screen.getByRole('button', { name: 'Xem spool không có Line' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Xem spool của L9' })).toBeInTheDocument()
  })

  it('says so when no spool is late', () => {
    renderApp(<LateSpools projectId="p1" warnings={[]} thresholdDays={7} />)
    expect(screen.getByText('Không có spool trễ')).toBeInTheDocument()
    expect(screen.queryByTestId('late-spools')).not.toBeInTheDocument()
  })

  it('pages the groups', () => {
    const many = Array.from({ length: 12 }, (_, i) => warning(`s${i}`, { testPackageNo: `TP${String(i).padStart(2, '0')}` }))
    renderApp(<LateSpools projectId="p1" warnings={many} thresholdDays={7} />)
    expect(tableRows(screen.getByTestId('late-spools'))).toHaveLength(10)
  })

  it('moves the select into the body on a phone', () => {
    undoViewport()
    undoViewport = setViewport(390)
    renderApp(<LateSpools projectId="p1" warnings={WARNINGS} thresholdDays={7} />)
    const row = within(screen.getByTestId('control-row'))
    expect(row.getByRole('combobox', { name: 'Nhóm spool trễ theo' })).toBeInTheDocument()
    expect(row.getByRole('textbox', { name: 'Tìm spool trễ' })).toBeInTheDocument()
    expect(screen.getByTestId('control-row').style.flexWrap).toBe('wrap')
  })

  it('puts the select and the search in a header row that wraps on a desktop', () => {
    renderApp(<LateSpools projectId="p1" warnings={WARNINGS} thresholdDays={7} />)
    const actions = screen.getByTestId('header-actions')
    expect(actions.style.flexWrap).toBe('wrap')
    expect(within(actions).getByRole('combobox', { name: 'Nhóm spool trễ theo' })).toBeInTheDocument()
    expect(within(actions).getByRole('textbox', { name: 'Tìm spool trễ' })).toHaveAttribute('placeholder', 'Tìm Spool / Line / Package')
  })
})

describe('LateSpools: Spool level (RV8-10)', () => {
  const [PH, IH, IW] = [MILESTONE_LABEL.ph, MILESTONE_LABEL.ih, MILESTONE_LABEL.iw]

  it('lists one row per late spool, unnested, with each milestone\'s late info', async () => {
    renderApp(<LateSpools projectId="p1" warnings={WARNINGS} thresholdDays={7} />)
    await chooseOption('Nhóm spool trễ theo', 'Spool')
    const table = screen.getByTestId('late-spools')
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
      'SpoolNo', 'LineNo', 'Test Package No', PH, IH, IW,
      'Bộ phận', 'Plan', 'Actual', 'Số ngày trễ',
      'Bộ phận', 'Plan', 'Actual', 'Số ngày trễ',
      'Bộ phận', 'Plan', 'Actual', 'Số ngày trễ',
    ])
    expect(tableRows(table)).toEqual([
      ['SP-a', 'L9', 'TP2', 'Piping', '01/09/2026', '-', '36', '-', '-', '-', '-', 'Insulation', '10/09/2026', '25/09/2026', '15'],
      ['SP-b', 'L1', 'TP1', '-', '-', '-', '-', 'Painting', '01/09/2026', '-', '36', '-', '-', '-', '-'],
    ])
    expect(within(table).queryByRole('button', { name: /Xem spool/ })).not.toBeInTheDocument()
    expect(keyFactTexts(card())).toEqual(['2 spool'])
  })

  it('pages the spools', async () => {
    const many = Array.from({ length: 12 }, (_, i) => warning(`s${i}`))
    renderApp(<LateSpools projectId="p1" warnings={many} thresholdDays={7} />)
    await chooseOption('Nhóm spool trễ theo', 'Spool')
    expect(tableRows(screen.getByTestId('late-spools'))).toHaveLength(10)
  })
})

describe('LateSpools: search (RV8-10)', () => {
  const MORE: LateWarning[] = [
    ...WARNINGS,
    warning('c', { spoolNo: 'SP-Đầu', testPackageNo: 'TP2', lineNo: 'L1', milestone: 'ih', department: 'Painting' }),
  ]
  const search = () => screen.getByRole('textbox', { name: 'Tìm spool trễ' })
  const typeQuery = (text: string) => fireEvent.change(search(), { target: { value: text } })
  const firstCells = () => tableRows(screen.getByTestId('late-spools')).map((r) => r[1])

  afterEach(() => {
    vi.useRealTimers()
  })

  it('applies once the typing pauses for 250 ms, accent-blind, and counts the matching spools', () => {
    renderApp(<LateSpools projectId="p1" warnings={MORE} thresholdDays={7} />)
    vi.useFakeTimers()
    expect(keyFactTexts(card())).toEqual(['3 spool'])
    typeQuery('sp-dau')
    act(() => vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 1))
    expect(search()).toHaveValue('sp-dau')
    expect(firstCells()).toEqual(['TP1', 'TP2'])
    act(() => vi.advanceTimersByTime(1))
    // TP2 does not match: it keeps only its matching spool.
    expect(tableRows(screen.getByTestId('late-spools')).map((r) => r.slice(1, 3))).toEqual([['TP2', '1']])
    expect(keyFactTexts(card())).toEqual(['1 spool'])
  })

  it('keeps a group whose name matches with all its spools', () => {
    renderApp(<LateSpools projectId="p1" warnings={MORE} thresholdDays={7} />)
    vi.useFakeTimers()
    typeQuery('tp2')
    act(() => vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS))
    expect(tableRows(screen.getByTestId('late-spools')).map((r) => r.slice(1, 3))).toEqual([['TP2', '2']])
    expect(keyFactTexts(card())).toEqual(['2 spool'])
  })

  it('filters the Spool level by LineNo too', async () => {
    renderApp(<LateSpools projectId="p1" warnings={MORE} thresholdDays={7} />)
    await chooseOption('Nhóm spool trễ theo', 'Spool')
    vi.useFakeTimers()
    typeQuery('l1')
    act(() => vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS))
    expect(tableRows(screen.getByTestId('late-spools')).map((r) => r[0])).toEqual(['SP-b', 'SP-Đầu'])
    expect(keyFactTexts(card())).toEqual(['2 spool'])
  })

  it('says so when no spool matches, and shows all again at once when cleared with its x', () => {
    renderApp(<LateSpools projectId="p1" warnings={MORE} thresholdDays={7} />)
    vi.useFakeTimers()
    typeQuery('zzz')
    act(() => vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS))
    expect(within(screen.getByTestId('late-spools')).getByText('Không có spool trễ khớp tìm kiếm')).toBeInTheDocument()
    expect(keyFactTexts(card())).toEqual(['0 spool'])
    fireEvent.click(card().querySelector('.ant-input-clear-icon') as HTMLElement)
    expect(search()).toHaveValue('')
    expect(firstCells()).toEqual(['TP1', 'TP2'])
  })

  it('applies at once on Enter', () => {
    renderApp(<LateSpools projectId="p1" warnings={MORE} thresholdDays={7} />)
    typeQuery('tp1')
    fireEvent.keyDown(search(), { key: 'Enter', code: 'Enter', keyCode: 13 })
    expect(firstCells()).toEqual(['TP1'])
  })
})
