import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { Unit } from '../../domain/piping/types'
import { renderApp } from '../../test/renderApp'
import { chooseOption } from '../../test/select'
import { InsulationPanel } from './InsulationPanel'
import {
  InsulationUnitProvider, useInsulationHidden, useInsulationHiddenValue, useInsulationSelection,
  useInsulationSelectionValue, useInsulationUnit, useInsulationUnitValue,
} from './insulationUnit'

vi.mock('../../lib/pipingApi', () => ({
  listSpools: async () => [{
    id: 's1', seq: 1, spoolNo: 'SP-1', lineNo: 'L1', insuType: null, drawingNo: null, testPackageNo: 'TP1',
    paintingSystem: null, extra: {}, phPlan: '2026-10-01', ihPlan: null, iwPlan: null,
    phActual: null, ihActual: null, iwActual: null,
  }],
  listSpoolColumns: async () => [],
  listNotes: async () => [],
}))
vi.mock('./insulation/InsulationChart', () => ({ InsulationChart: () => <div data-testid="insulation-chart" /> }))

function Picker({ projectId, unit }: { projectId: string; unit: Unit }) {
  const [value, setUnit] = useInsulationUnit(projectId)
  return <button type="button" onClick={() => setUnit(unit)}>{`${projectId} chọn ${unit}: ${value}`}</button>
}

function Reader({ projectId }: { projectId: string | null }) {
  return <output aria-label={`unit ${projectId ?? 'none'}`}>{useInsulationUnitValue(projectId)}</output>
}

function SelectionPicker({ projectId }: { projectId: string }) {
  const [value, setSelection] = useInsulationSelection(projectId)
  return <button type="button" onClick={() => setSelection('actual')}>{`${projectId} chọn actual: ${value}`}</button>
}

function SelectionReader({ projectId }: { projectId: string | null }) {
  return <output aria-label={`lines ${projectId ?? 'none'}`}>{useInsulationSelectionValue(projectId)}</output>
}

function HiddenPicker({ projectId }: { projectId: string }) {
  const [value, setHidden] = useInsulationHidden(projectId)
  return <button type="button" onClick={() => setHidden([...value, 'phPlan'])}>{`${projectId} ẩn: ${value.join(',')}`}</button>
}

function HiddenReader({ projectId }: { projectId: string | null }) {
  return <output aria-label={`hidden ${projectId ?? 'none'}`}>{useInsulationHiddenValue(projectId).join(',')}</output>
}

const unitOf = (projectId: string) => screen.getByRole('status', { name: `unit ${projectId}` }).textContent
const linesOf = (projectId: string) => screen.getByRole('status', { name: `lines ${projectId}` }).textContent
const hiddenOf = (projectId: string) => screen.getByRole('status', { name: `hidden ${projectId}` }).textContent

describe('insulationUnit', () => {
  it('shares the unit per project under the page\'s provider, SpoolNo until it is changed', async () => {
    renderApp(
      <InsulationUnitProvider>
        <Picker projectId="p1" unit="lineNo" />
        <Reader projectId="p1" />
        <Reader projectId="p2" />
        <Reader projectId={null} />
      </InsulationUnitProvider>,
    )
    expect(unitOf('p1')).toBe('spoolNo')
    await userEvent.click(screen.getByRole('button', { name: /p1 chọn lineNo/ }))
    expect(unitOf('p1')).toBe('lineNo')
    expect(unitOf('p2')).toBe('spoolNo')
    expect(unitOf('none')).toBe('spoolNo')
  })

  it('shares the Plan | Actual | Plan & Actual lines per project beside the unit, Plan & Actual until changed', async () => {
    renderApp(
      <InsulationUnitProvider>
        <SelectionPicker projectId="p1" />
        <SelectionReader projectId="p1" />
        <SelectionReader projectId="p2" />
        <Reader projectId="p1" />
      </InsulationUnitProvider>,
    )
    expect(linesOf('p1')).toBe('both')
    await userEvent.click(screen.getByRole('button', { name: /p1 chọn actual/ }))
    expect(linesOf('p1')).toBe('actual')
    expect(linesOf('p2')).toBe('both')
    expect(unitOf('p1')).toBe('spoolNo')
  })

  it('shares the series hidden from the legend per project beside the lines, none until changed (RV9-4)', async () => {
    renderApp(
      <InsulationUnitProvider>
        <HiddenPicker projectId="p1" />
        <HiddenReader projectId="p1" />
        <HiddenReader projectId="p2" />
        <HiddenReader projectId={null} />
        <SelectionReader projectId="p1" />
      </InsulationUnitProvider>,
    )
    expect(hiddenOf('p1')).toBe('')
    await userEvent.click(screen.getByRole('button', { name: /p1 ẩn/ }))
    expect(hiddenOf('p1')).toBe('phPlan')
    expect(hiddenOf('p2')).toBe('')
    expect(hiddenOf('none')).toBe('')
    expect(linesOf('p1')).toBe('both')
  })

  it('keeps the hidden series in the component\'s own state without a provider', async () => {
    renderApp(<HiddenPicker projectId="p1" />)
    await userEvent.click(screen.getByRole('button', { name: 'p1 ẩn:' }))
    expect(screen.getByRole('button', { name: 'p1 ẩn: phPlan' })).toBeInTheDocument()
  })

  it('keeps the lines in the component\'s own state without a provider', async () => {
    renderApp(<SelectionPicker projectId="p1" />)
    await userEvent.click(screen.getByRole('button', { name: /p1 chọn actual: both/ }))
    expect(screen.getByRole('button', { name: /p1 chọn actual: actual/ })).toBeInTheDocument()
  })

  it('keeps the choice in the component\'s own state without a provider', async () => {
    renderApp(<Picker projectId="p1" unit="lineNo" />)
    await userEvent.click(screen.getByRole('button', { name: /p1 chọn lineNo: spoolNo/ }))
    expect(screen.getByRole('button', { name: /p1 chọn lineNo: lineNo/ })).toBeInTheDocument()
  })

  it('takes the Insulation tab\'s Đơn vị đếm choice, so the export writes the unit on screen', async () => {
    renderApp(
      <InsulationUnitProvider>
        <InsulationPanel
          projectId="p1"
          settings={{ projectId: 'p1', enabled: true, weekStartDate: '2026-09-28', totalTestPacks: null, lateThresholdDays: 7, chartColors: {} }}
          mode="day"
          variant="admin"
          role="admin"
          todayKey="2026-10-07"
          refreshKey={0}
        />
        <Reader projectId="p1" />
        <SelectionReader projectId="p1" />
      </InsulationUnitProvider>,
    )
    await screen.findByRole('combobox', { name: 'Đơn vị đếm' })
    await chooseOption('Đơn vị đếm', 'LineNo')
    expect(unitOf('p1')).toBe('lineNo')
    await chooseOption('Đường hiển thị', 'Actual')
    expect(linesOf('p1')).toBe('actual')
  })

  it('puts the choice back to SpoolNo when its extra column is no longer configured (RV9-1)', async () => {
    renderApp(
      <InsulationUnitProvider>
        <Picker projectId="p1" unit="col:gone" />
        <InsulationPanel
          projectId="p1"
          settings={{ projectId: 'p1', enabled: true, weekStartDate: '2026-09-28', totalTestPacks: null, lateThresholdDays: 7, chartColors: {} }}
          mode="day"
          variant="admin"
          role="admin"
          todayKey="2026-10-07"
          refreshKey={0}
        />
        <Reader projectId="p1" />
      </InsulationUnitProvider>,
    )
    await screen.findByRole('combobox', { name: 'Đơn vị đếm' })
    await userEvent.click(screen.getByRole('button', { name: /p1 chọn col:gone/ }))
    await waitFor(() => expect(unitOf('p1')).toBe('spoolNo'))
  })
})
