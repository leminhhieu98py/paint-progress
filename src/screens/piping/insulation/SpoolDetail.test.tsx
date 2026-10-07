import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App as AntApp } from 'antd'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { camSpoolFlags } from '../../../domain/piping/cam'
import type { Spool, SpoolColumn } from '../../../domain/piping/types'
import { expectLeft } from '../../../test/alignment'
import { keyFactTexts } from '../../../test/copy'
import { renderApp } from '../../../test/renderApp'
import { chooseOption, optionTitles } from '../../../test/select'
import { setViewport } from '../../../test/viewport'
import { SpoolDetail } from './SpoolDetail'

const spool = (seq: number, over: Partial<Spool> = {}): Spool => ({
  id: `s${seq}`,
  seq,
  spoolNo: `SP-${seq}`,
  lineNo: 'L1',
  insuType: 'HC',
  drawingNo: 'D1',
  testPackageNo: 'TP1',
  paintingSystem: 'BD-02B',
  extra: {},
  phPlan: null,
  ihPlan: null,
  iwPlan: null,
  phActual: null,
  ihActual: null,
  iwActual: null,
  ...over,
})

const SPOOLS: Spool[] = [
  spool(1, { phPlan: '2026-09-01', ihPlan: '2026-09-05', iwPlan: '2026-09-10', phActual: '2026-09-02', extra: { Zone: 'Z1' } }),
  spool(2, { spoolNo: 'SP-1', lineNo: 'L2', phPlan: '2026-09-03', phActual: '2026-09-04', insuType: 'PP' }),
  // A plan out of order: PH after IH.
  spool(3, { lineNo: 'L2', testPackageNo: 'TP2', phPlan: '2026-09-09', ihPlan: '2026-09-08', paintingSystem: 'EP-01' }),
  spool(4, { lineNo: null, testPackageNo: null, phActual: '2026-09-06' }),
]

const COLUMNS: SpoolColumn[] = [{ id: 'c1', label: 'Zone', sort: 1 }]

const detail = (over: Partial<Parameters<typeof SpoolDetail>[0]> = {}, spools = SPOOLS) => (
  <SpoolDetail
    projectId="p1"
    spools={spools}
    columns={COLUMNS}
    flags={camSpoolFlags(spools, 7, '2026-10-07')}
    admin
    {...over}
  />
)
const renderDetail = (over: Partial<Parameters<typeof SpoolDetail>[0]> = {}, spools = SPOOLS) =>
  renderApp(detail(over, spools))

const table = () => within(screen.getByTestId('spool-detail')).getByRole('table')
const headers = () => within(table()).getAllByRole('columnheader').map((h) => h.textContent)
const bodyRows = () => within(table()).getAllByRole('row').filter((r) => r.closest('tbody') !== null)
const cells = (row: HTMLElement) => within(row).getAllByRole('cell').map((c) => c.textContent)
const firstCells = () => bodyRows().map((r) => cells(r)[0])
/** The badges in a Spool row's last cell, Cảnh báo; [] for `-`. */
const flagsOf = (i: number) => Array.from(
  within(bodyRows()[i]).getAllByRole('cell').at(-1)!.querySelectorAll('.ant-space-item'),
  (el) => el.textContent,
)
const selected = (name: string) =>
  screen.getByRole('combobox', { name }).closest('.ant-select')?.querySelector('.ant-select-selection-item')?.textContent
const level = (name: 'Package' | 'Line' | 'Spool') => chooseOption('Cấp hiển thị', name)
const header = () => screen.getByRole('heading', { level: 2, name: 'Chi tiết' }).parentElement as HTMLElement

let undoViewport: () => void
beforeEach(() => {
  undoViewport = setViewport(1280)
})
afterEach(() => undoViewport())

describe('SpoolDetail: levels (spec §6.4, Q16B)', () => {
  it('opens on Package rows with done/total and the planned and reached dates per milestone', () => {
    renderDetail()
    expect(selected('Cấp hiển thị')).toBe('Package')
    expect(headers()).toEqual(expect.arrayContaining([
      'Test Package No', 'Số spool', 'Painting Handover', 'Insulation Handover', 'Insulation Work', 'Hoàn thành', 'Plan', 'Actual',
    ]))
    // TP1 holds spools 1 and 2, TP2 spool 3; spool 4 has no package: its row comes last.
    expect(firstCells()).toEqual(['TP1', 'TP2', '-'])
    // Số spool, then PH: 2/2 done, latest plan 03/09, reached on 04/09; IH: 0/2, a spool lacks a plan -> -.
    expect(cells(bodyRows()[0])).toEqual(['TP1', '2', '2/2', '03/09/2026', '04/09/2026', '0/2', '-', '-', '0/2', '-', '-'])
    // The spools without a package are no package: counts, no dates, and not counted as one.
    expect(cells(bodyRows()[2])).toEqual(['-', '1', '1/1', '-', '-', '0/1', '-', '-', '0/1', '-', '-'])
    expect(keyFactTexts()).toContain('2 Test Package')
  })

  it('groups Line on its own, not under Package', async () => {
    renderDetail()
    await level('Line')
    expect(headers()[0]).toBe('LineNo')
    expect(firstCells()).toEqual(['L1', 'L2', '-'])
    expect(cells(bodyRows()[1]).slice(0, 3)).toEqual(['L2', '2', '1/2'])
    expect(keyFactTexts()).toContain('2 Line')
  })

  it('lists spools with master fields, extra columns and the six dates, - when empty', async () => {
    renderDetail()
    await level('Spool')
    expect(headers()).toEqual(expect.arrayContaining([
      'SpoolNo', 'LineNo', 'InsuType', 'DrawingNo', 'Test Package No', 'Painting System', 'Zone', 'Cảnh báo',
    ]))
    expect(cells(bodyRows()[0]).slice(0, 13)).toEqual([
      'SP-1', 'L1', 'HC', 'D1', 'TP1', 'BD-02B', 'Z1',
      '01/09/2026', '02/09/2026', '05/09/2026', '-', '10/09/2026', '-',
    ])
    expect(cells(bodyRows()[3]).slice(0, 7)).toEqual(['SP-4', '-', 'HC', 'D1', '-', 'BD-02B', '-'])
    expect(keyFactTexts()).toContain('4 spool')
  })

  it('aligns typed text left and numbers, dates and badges centred', async () => {
    renderDetail()
    await level('Spool')
    const td = within(bodyRows()[2]).getAllByRole('cell')
    expectLeft(td[0])
    expectLeft(td[6])
    expect(td[7].style.textAlign).toBe('center')
    expect(td[13].style.textAlign).toBe('center')
  })
})

describe('SpoolDetail: flags (spec §6.2, §6.4, §7)', () => {
  it('flags the admin duplicate SpoolNo, plan-order issues and late milestones', async () => {
    renderDetail()
    await level('Spool')
    // Today 07/10, threshold 7: SP-1's IH and IW plans are long past without an actual.
    expect(flagsOf(0)).toEqual(['SpoolNo trùng', 'Trễ Insulation Handover', 'Trễ Insulation Work'])
    expect(flagsOf(1)).toEqual(['SpoolNo trùng'])
    expect(flagsOf(2)).toEqual(['Sai thứ tự Plan', 'Trễ Painting Handover', 'Trễ Insulation Handover'])
    expect(cells(bodyRows()[3]).at(-1)).toBe('-')
  })

  it('shows a foreman or a viewer the late milestones only', async () => {
    renderDetail({ admin: false })
    await level('Spool')
    expect(headers()).toContain('Cảnh báo')
    expect(flagsOf(0)).toEqual(['Trễ Insulation Handover', 'Trễ Insulation Work'])
    expect(cells(bodyRows()[1]).at(-1)).toBe('-')
    expect(flagsOf(2)).toEqual(['Trễ Painting Handover', 'Trễ Insulation Handover'])
  })
})

describe('SpoolDetail: filters and search (spec §6.4, FLT-02, FLT-08)', () => {
  it('offers the three levels and each filter its distinct values after an all option', async () => {
    renderDetail()
    expect(await optionTitles('Cấp hiển thị')).toEqual(['Package', 'Line', 'Spool'])
    expect(await optionTitles('InsuType')).toEqual(['Tất cả InsuType', 'HC', 'PP'])
    expect(await optionTitles('Painting System')).toEqual(['Tất cả Painting System', 'BD-02B', 'EP-01'])
    expect(await optionTitles('Test Package No')).toEqual(['Tất cả Test Package No', 'TP1', 'TP2'])
  })

  it('applies InsuType, Painting System and Test Package No as they change', async () => {
    renderDetail()
    await level('Spool')
    await chooseOption('InsuType', 'HC')
    expect(firstCells()).toEqual(['SP-1', 'SP-3', 'SP-4'])
    await chooseOption('Painting System', 'EP-01')
    expect(firstCells()).toEqual(['SP-3'])
    await chooseOption('Painting System', 'Tất cả Painting System')
    await chooseOption('Test Package No', 'TP1')
    expect(firstCells()).toEqual(['SP-1'])
  })

  it('narrows the group levels too', async () => {
    renderDetail()
    await chooseOption('InsuType', 'PP')
    expect(firstCells()).toEqual(['TP1'])
    expect(cells(bodyRows()[0])[1]).toBe('1')
  })

  it('puts a filter whose value a re-import removed back to all', async () => {
    const { rerender } = renderDetail()
    await level('Spool')
    await chooseOption('InsuType', 'PP')
    expect(firstCells()).toEqual(['SP-1'])
    const next = SPOOLS.map((s) => ({ ...s, insuType: 'HC' }))
    rerender(<AntApp>{detail({}, next)}</AntApp>)
    expect(selected('InsuType')).toBe('Tất cả InsuType')
    expect(firstCells()).toEqual(['SP-1', 'SP-1', 'SP-3', 'SP-4'])
  })

  it('searches SpoolNo or LineNo once the typing pauses', async () => {
    renderDetail()
    await level('Spool')
    const box = screen.getByRole('textbox', { name: 'Tìm spool' })
    await userEvent.type(box, 'l2')
    // Not yet: the box shows the text at once, the table follows after the pause.
    expect(box).toHaveValue('l2')
    expect(firstCells()).toEqual(['SP-1', 'SP-1', 'SP-3', 'SP-4'])
    await waitFor(() => expect(firstCells()).toEqual(['SP-1', 'SP-3']))
  })

  it('applies at once on Enter and on clear', async () => {
    renderDetail()
    await level('Spool')
    const box = screen.getByRole('textbox', { name: 'Tìm spool' })
    await userEvent.type(box, 'SP-4{Enter}')
    expect(firstCells()).toEqual(['SP-4'])
    await userEvent.clear(box)
    expect(firstCells()).toEqual(['SP-1', 'SP-1', 'SP-3', 'SP-4'])
  })

  it('says when nothing matches', async () => {
    renderDetail()
    await level('Spool')
    await userEvent.type(screen.getByRole('textbox', { name: 'Tìm spool' }), 'zzz{Enter}')
    expect(within(table()).getByText('Không có spool phù hợp')).toBeInTheDocument()
  })
})

describe('SpoolDetail: paging (UI-05)', () => {
  const MANY = Array.from({ length: 25 }, (_, i) => spool(i + 1, { insuType: i < 3 ? 'PP' : 'HC' }))
  const toPage2 = async () => {
    await userEvent.click(screen.getByTitle('2'))
    expect(firstCells()[0]).toBe('SP-11')
  }

  it('pages by 10 and goes back to page 1 when a filter changes', async () => {
    renderDetail({}, MANY)
    await level('Spool')
    expect(bodyRows()).toHaveLength(10)
    await toPage2()
    await chooseOption('InsuType', 'HC')
    expect(firstCells()[0]).toBe('SP-4')
  })

  it('goes back to page 1 when the search applies', async () => {
    renderDetail({}, MANY)
    await level('Spool')
    await toPage2()
    // SP-1 and SP-10..SP-19: eleven matches, two pages, the first shown.
    await userEvent.type(screen.getByRole('textbox', { name: 'Tìm spool' }), 'SP-1{Enter}')
    expect(firstCells()[0]).toBe('SP-1')
  })

  it('goes back to page 1 when the level changes', async () => {
    renderDetail({}, MANY)
    await level('Spool')
    await toPage2()
    await level('Line')
    await level('Spool')
    expect(firstCells()[0]).toBe('SP-1')
  })

  it('has no pager for ten rows or fewer', () => {
    renderDetail()
    expect(document.querySelector('.ant-pagination')).toBeNull()
  })
})

describe('SpoolDetail: seams and phones', () => {
  it('renders the toolbar in the header and the row actions it is given', async () => {
    renderDetail({
      toolbar: <button type="button">Cập nhật Actual</button>,
      rowActions: (s) => <button type="button">{`Mở ${s.spoolNo}`}</button>,
    })
    expect(within(header()).getByRole('button', { name: 'Cập nhật Actual' })).toBeInTheDocument()
    expect(within(header()).getByRole('combobox', { name: 'Cấp hiển thị' })).toBeInTheDocument()
    await level('Spool')
    expect(headers()).toContain('Thao tác')
    expect(within(bodyRows()[3]).getByRole('button', { name: 'Mở SP-4' })).toBeInTheDocument()
  })

  it('on a phone moves the controls into a row of the body, pins the first column, the filters in their own sheet', async () => {
    undoViewport()
    undoViewport = setViewport(390)
    renderDetail({ toolbar: <button type="button">Cập nhật Actual</button> })
    expect(within(header()).queryByRole('combobox')).toBeNull()
    const row = screen.getByTestId('control-row')
    expect(within(row).getByRole('combobox', { name: 'Cấp hiển thị' })).toBeInTheDocument()
    expect(within(row).getByRole('button', { name: 'Cập nhật Actual' })).toBeInTheDocument()
    await level('Spool')
    expect(within(bodyRows()[0]).getAllByRole('cell')[0]).toHaveClass('ant-table-cell-fix-left')
    expect(screen.getByRole('textbox', { name: 'Tìm spool' })).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'InsuType' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Lọc spool' }))
    await chooseOption('InsuType', 'PP', await screen.findByRole('dialog', { name: 'Lọc spool' }))
    await act(async () => {})
    expect(firstCells()).toEqual(['SP-1'])
  })

  it('leaves the first column free on a wide screen', async () => {
    renderDetail()
    await level('Spool')
    expect(within(bodyRows()[0]).getAllByRole('cell')[0]).not.toHaveClass('ant-table-cell-fix-left')
  })
})
