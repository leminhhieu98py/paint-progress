import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { Unit } from '../../domain/piping/types'
import { renderApp } from '../../test/renderApp'
import { chooseOption } from '../../test/select'
import { InsulationPanel } from './InsulationPanel'
import {
  InsulationUnitProvider, useInsulationSelection, useInsulationSelectionValue, useInsulationUnit, useInsulationUnitValue,
} from './insulationUnit'

vi.mock('../../lib/pipingApi', () => ({
  listSpools: async () => [{
    id: 's1', seq: 1, spoolNo: 'SP-1', lineNo: 'L1', insuType: null, drawingNo: null, testPackageNo: 'TP1',
    paintingSystem: null, extra: {}, phPlan: '2026-10-01', ihPlan: null, iwPlan: null,
    phActual: null, ihActual: null, iwActual: null,
  }],
  listSpoolColumns: async () => [],
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

const unitOf = (projectId: string) => screen.getByRole('status', { name: `unit ${projectId}` }).textContent
const linesOf = (projectId: string) => screen.getByRole('status', { name: `lines ${projectId}` }).textContent

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
          settings={{ projectId: 'p1', enabled: true, weekStartDate: '2026-09-28', totalTestPacks: null, lateThresholdDays: 7 }}
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
})
