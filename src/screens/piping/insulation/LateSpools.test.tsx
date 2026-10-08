import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { LateWarning } from '../../../domain/piping/cam'
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
    const toggle = within(tp2).getByRole('button', { name: 'Xem spool' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await user.hover(toggle)
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Xem spool')
    await user.click(toggle)
    expect(within(tp2).getByRole('button', { name: 'Ẩn spool' })).toHaveAttribute('aria-expanded', 'true')
    const list = screen.getByTestId('late-spool-list')
    expect(within(list).getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
      'SpoolNo', 'Milestone', 'Bộ phận', 'Plan', 'Actual', 'Số ngày trễ',
    ])
    expect(tableRows(list)).toEqual([
      ['SP-a', 'Painting Handover', 'Piping', '01/09/2026', '-', '36'],
      ['SP-a', 'Insulation Work', 'Insulation', '10/09/2026', '25/09/2026', '15'],
    ])
    expect(within(list).getAllByLabelText(/Painting Handover: Piping bàn giao cho Painting/).length).toBeGreaterThan(0)
  })

  it('groups by Line from a searchable select', async () => {
    renderApp(<LateSpools projectId="p1" warnings={WARNINGS} thresholdDays={7} />)
    expect(await optionTitles('Nhóm spool trễ theo')).toEqual(['Package', 'Line'])
    await chooseOption('Nhóm spool trễ theo', 'Line')
    const table = screen.getByTestId('late-spools')
    expect(within(table).getAllByRole('columnheader')[1].textContent).toBe('LineNo')
    expect(tableRows(table).map((r) => r.slice(1, 3))).toEqual([['L1', '1'], ['L9', '1']])
  })

  it('puts the spools with no package in a last "-" row', () => {
    renderApp(<LateSpools projectId="p1" warnings={[warning('c', { testPackageNo: null }), ...WARNINGS]} thresholdDays={7} />)
    expect(tableRows(screen.getByTestId('late-spools')).map((r) => r[1])).toEqual(['TP1', 'TP2', '-'])
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
    expect(within(screen.getByTestId('control-row')).getByRole('combobox', { name: 'Nhóm spool trễ theo' })).toBeInTheDocument()
  })
})
