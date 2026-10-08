import { Alert, Button, Select, Spin } from 'antd'
import { useMemo } from 'react'
import { EmptyState } from '../../components/EmptyState'
import type { KeyFact } from '../../components/KeyFacts'
import { SectionCard } from '../../components/SectionCard'
import { searchSelectProps, useFullOptionsProps } from '../../components/searchSelect'
import {
  camProgress, camSeries, camSeriesKeys, camSpoolFlags, duplicateSpoolGroups, MILESTONE_LABEL, MILESTONES,
  planOrderIssues, UNIT_LABEL, type CamSpoolFlags,
} from '../../domain/piping/cam'
import type { CamSelection, Spool, SpoolColumn, Unit } from '../../domain/piping/types'
import { listSpoolColumns, listSpools } from '../../lib/pipingApi'
import { space } from '../../theme'
import { useFieldPhone } from '../gs/fieldSections'
import { ControlRow } from './insulation/ControlRow'
import { PHONE_CONTROL } from './insulation/controlStyle'
import { InsulationChart } from './insulation/InsulationChart'
import { SpoolDetail } from './insulation/SpoolDetail'
import { useInsulationSelection, useInsulationUnit } from './insulationUnit'
import type { PipingPanelProps } from './panelProps'
import { formatQty } from './pipingFormat'
import { usePanelData } from './usePanelData'

/**
 * The Insulation tab of the Piping page (spec §6.4, Q14-Q21): display.
 *
 * The card "Insulation" carries the summary beside its title -- the spools,
 * and per milestone how many items of the chosen unit reached it -- with the
 * admin's review warnings (duplicate SpoolNo, Q14C; plan order, Q15B), and
 * the chart: the unit select and the Plan | Actual | Plan & Actual select in
 * its header (on a phone in a wrapping row of the body, as the header does not
 * wrap). Below it, the detail table (`SpoolDetail`).
 *
 * Seams for the later tasks: the Plan import joins the Insulation card's
 * header (as on Reinstatement) and the empty state's `action`; Cập nhật
 * Actual and Import Actual go in `SpoolDetail`'s `toolbar`, a spool's own
 * actions (clear an actual, a note) in its `rowActions`; the late flag in
 * the "N spool trễ" pill beside the others here.
 */

interface InsulationData {
  spools: Spool[]
  columns: SpoolColumn[]
}

async function readInsulation(projectId: string): Promise<InsulationData> {
  const [spools, columns] = await Promise.all([listSpools(projectId), listSpoolColumns(projectId)])
  return { spools, columns }
}

const UNITS = (Object.keys(UNIT_LABEL) as Unit[]).map((u) => ({ value: u, label: UNIT_LABEL[u] }))

const SELECTIONS: Array<{ value: CamSelection; label: string }> = [
  { value: 'plan', label: 'Plan' },
  { value: 'actual', label: 'Actual' },
  { value: 'both', label: 'Plan & Actual' },
]

/** A warning's list of names: ten at most, then how many more. */
const MAX_NAMED = 10
function nameList(names: string[], noun: string): string {
  const shown = names.slice(0, MAX_NAMED).join(', ')
  return names.length > MAX_NAMED ? `${shown} và ${formatQty(names.length - MAX_NAMED)} ${noun} khác` : shown
}

const ORDER_TEXT = MILESTONES.map((m) => MILESTONE_LABEL[m]).join(', ')

/** The admin's review warnings (spec §6.2): imported as they are, listed to check. */
function reviewFacts(spools: Spool[]): KeyFact[] {
  const out: KeyFact[] = []
  const duplicates = duplicateSpoolGroups(spools)
  if (duplicates.length > 0) {
    out.push({
      value: formatQty(duplicates.length),
      label: 'SpoolNo trùng',
      tone: 'warning',
      info: `SpoolNo trùng: ${nameList(duplicates.map((g) => `${g.spoolNo} (${formatQty(g.rows.length)} dòng)`), 'SpoolNo')}`,
    })
  }
  const misordered = planOrderIssues(spools)
  if (misordered.length > 0) {
    out.push({
      value: formatQty(misordered.length),
      label: 'spool sai thứ tự Plan',
      tone: 'warning',
      info: `Ngày Plan không theo thứ tự ${ORDER_TEXT}: ${nameList(misordered.map((i) => i.row.spoolNo), 'spool')}`,
    })
  }
  return out
}

export function InsulationPanel({ projectId, settings, mode, role, todayKey, refreshKey }: PipingPanelProps) {
  const { data, error, reload } = usePanelData(projectId, refreshKey, readInsulation)
  const admin = role === 'admin'
  const fullOptionsProps = useFullOptionsProps()
  const phone = useFieldPhone()
  // The page holds the unit and the lines, so the export writes them as on screen (spec §10).
  const [unit, setUnit] = useInsulationUnit(projectId)
  const [selection, setSelection] = useInsulationSelection(projectId)

  const spools = data?.spools
  const series = useMemo(
    () => (spools === undefined
      ? []
      : camSeries({ spools, unit, mode, weekStart: settings.weekStartDate, todayKey }).points),
    [spools, unit, mode, settings.weekStartDate, todayKey],
  )
  const progress = useMemo(() => (spools === undefined ? null : camProgress(spools, unit)), [spools, unit])
  const flags = useMemo(
    () => (spools === undefined ? new Map<string, CamSpoolFlags>() : camSpoolFlags(spools, settings.lateThresholdDays, todayKey)),
    [spools, settings.lateThresholdDays, todayKey],
  )
  const review = useMemo(() => (spools === undefined || !admin ? [] : reviewFacts(spools)), [spools, admin])

  if (error !== null) {
    return (
      <Alert
        type="error"
        showIcon
        message="Không tải được Insulation"
        description={error}
        action={<Button onClick={reload}>Thử lại</Button>}
      />
    )
  }
  if (data === null || progress === null) return <Spin style={{ display: 'block', margin: '15vh auto' }} />

  if (data.spools.length === 0) {
    return (
      <SectionCard title="Insulation">
        <EmptyState
          title="Chưa có spool nào"
          description={admin ? 'Nhập Plan Insulation để thêm spool' : 'Admin chưa nhập Plan Insulation'}
        />
      </SectionCard>
    )
  }

  /** The unit and the lines shown: in the card's header, or on a phone in a row of the body. */
  const controls = (
    <>
      <Select<Unit>
        aria-label="Đơn vị đếm"
        {...searchSelectProps}
        {...fullOptionsProps}
        style={phone ? PHONE_CONTROL : { width: 170 }}
        value={unit}
        options={UNITS}
        onChange={setUnit}
      />
      <Select<CamSelection>
        aria-label="Đường hiển thị"
        {...searchSelectProps}
        {...fullOptionsProps}
        style={phone ? PHONE_CONTROL : { width: 150 }}
        value={selection}
        options={SELECTIONS}
        onChange={setSelection}
      />
    </>
  )

  const facts: KeyFact[] = [
    { value: formatQty(data.spools.length), label: 'spool' },
    ...MILESTONES.map((m) => ({
      prefix: MILESTONE_LABEL[m],
      value: `${formatQty(progress.done[m])}/${formatQty(progress.total)}`,
      // What the counts count: spool rows, or lines, packages... (spec §6.4).
      label: UNIT_LABEL[unit],
    })),
    ...review,
  ]

  return (
    // Keyed on the project: a filter or a search never carries over to the next project's spools.
    <div key={projectId} style={{ display: 'flex', flexDirection: 'column', gap: space.lg }}>
      <SectionCard
        title="Insulation"
        facts={facts}
        extra={phone ? undefined : controls}
      >
        {phone && <div style={{ marginBottom: space.md }}><ControlRow>{controls}</ControlRow></div>}
        {series.length === 0
          ? <EmptyState title="Chưa có ngày Plan hoặc Actual" />
          // Keyed on what shapes the axis: the Brush's zoom (its start index) belongs to one axis, not to the next.
          : (
            <InsulationChart
              key={`${mode}|${unit}|${selection}`}
              data={series}
              keys={camSeriesKeys(selection)}
              mode={mode}
            />
          )}
      </SectionCard>

      <SpoolDetail
        projectId={projectId}
        spools={data.spools}
        columns={data.columns}
        flags={flags}
        admin={admin}
      />
    </div>
  )
}
