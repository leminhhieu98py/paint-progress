import { Alert, Button, Select, Space, Spin } from 'antd'
import { useCallback, useMemo, useRef, useState } from 'react'
import { EmptyState } from '../../components/EmptyState'
import { IconAction } from '../../components/IconAction'
import type { KeyFact } from '../../components/KeyFacts'
import { SectionCard } from '../../components/SectionCard'
import { searchSelectProps, useFullOptionsProps } from '../../components/searchSelect'
import {
  camProgress, camSeries, camSeriesKeys, camSpoolFlags, duplicateSpoolGroups, lateWarnings, MILESTONE_LABEL, MILESTONES,
  planOrderIssues, UNIT_LABEL, type CamSpoolFlags,
} from '../../domain/piping/cam'
import { parseSpoolPlan, type SpoolPlanRow } from '../../domain/piping/imports'
import type { CamSelection, Spool, SpoolColumn, Unit } from '../../domain/piping/types'
import { buildSpoolPlanTemplate, templateFileName } from '../../lib/piping/templates'
import { listSpoolColumns, listSpools, replaceSpools } from '../../lib/pipingApi'
import { space } from '../../theme'
import { useFieldPhone } from '../gs/fieldSections'
import { ActualEntry } from './insulation/ActualEntry'
import { ActualImportFlow } from './insulation/ActualImportFlow'
import { setMilestones } from './insulation/actualPreview'
import { ClearActualModal } from './insulation/ClearActualModal'
import { ControlRow } from './insulation/ControlRow'
import { PHONE_CONTROL } from './insulation/controlStyle'
import { InsulationChart } from './insulation/InsulationChart'
import { lateFact } from './insulation/lateGroups'
import { LateSpools } from './insulation/LateSpools'
import { SpoolDetail } from './insulation/SpoolDetail'
import { spoolPlanPreview, spoolPlanSummary } from './insulation/spoolPlanPreview'
import type { PipingPanelProps } from './panelProps'
import { PlanImportFlow } from './PlanImportFlow'
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
  const [unit, setUnit] = useState<Unit>('spoolNo')
  const [selection, setSelection] = useState<CamSelection>('both')

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
  /** Late milestones (spec §7), for every role: the pill and the Spool trễ card. */
  const warnings = useMemo(
    () => (spools === undefined ? [] : lateWarnings(spools, settings.lateThresholdDays, todayKey)),
    [spools, settings.lateThresholdDays, todayKey],
  )
  const review = useMemo(() => (spools === undefined || !admin ? [] : reviewFacts(spools)), [spools, admin])
  const columns = data?.columns
  const parsePlan = useCallback(
    (sheets: Parameters<typeof parseSpoolPlan>[0]) => parseSpoolPlan(sheets, columns ?? []),
    [columns],
  )
  /**
   * The spools the last Plan preview was computed from. Read afresh when the
   * file is read, not taken from the page: an actual entered since the page
   * opened must show as lost (Q19A), and the log's client counts match what
   * the admin was shown.
   */
  const previewedSpools = useRef<Spool[]>([])
  const previewPlan = useCallback(async (rows: SpoolPlanRow[]) => {
    const fresh = await listSpools(projectId)
    previewedSpools.current = fresh
    return spoolPlanPreview(fresh, rows)
  }, [projectId])
  /** The spool whose actual the admin is clearing (R-12). */
  const [clearing, setClearing] = useState<Spool | null>(null)
  const rowActions = useCallback((s: Spool) => (
    <IconAction
      verb="delete"
      label="Xoá Actual"
      danger
      disabled={setMilestones(s).length === 0}
      onClick={() => setClearing(s)}
    />
  ), [])

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

  /** The admin's Plan import (spec §6.2): in the card's header, and in the empty state. */
  const planImport = admin ? (
    <PlanImportFlow<SpoolPlanRow>
      planLabel="Insulation Plan"
      templateName={templateFileName('spool_plan')}
      buildTemplate={() => buildSpoolPlanTemplate(data.columns.map((c) => c.label))}
      parse={parsePlan}
      preview={previewPlan}
      lineHeader="SpoolNo"
      lineAlign="left"
      commit={({ rows, fileName, summary }) => replaceSpools(
        // The database writes its own counts into the summary; the preview's sit under `client`.
        projectId, rows, fileName, { ...summary, client: spoolPlanSummary(previewedSpools.current, rows) },
      )}
      onImported={reload}
    />
  ) : undefined

  if (data.spools.length === 0) {
    return (
      <SectionCard title="Insulation">
        <EmptyState
          title="Chưa có spool nào"
          description={admin ? 'Nhập Plan Insulation để thêm spool' : 'Admin chưa nhập Plan Insulation'}
          action={planImport && <Space size={space.sm}>{planImport}</Space>}
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

  const late = lateFact(warnings, settings.lateThresholdDays)
  const facts: KeyFact[] = [
    { value: formatQty(data.spools.length), label: 'spool' },
    ...MILESTONES.map((m) => ({
      prefix: MILESTONE_LABEL[m],
      value: `${formatQty(progress.done[m])}/${formatQty(progress.total)}`,
      // What the counts count: spool rows, or lines, packages... (spec §6.4).
      label: UNIT_LABEL[unit],
    })),
    ...(late === null ? [] : [late]),
    ...review,
  ]

  return (
    // Keyed on the project: a filter or a search never carries over to the next project's spools.
    <div key={projectId} style={{ display: 'flex', flexDirection: 'column', gap: space.lg }}>
      <SectionCard
        title="Insulation"
        facts={facts}
        extra={phone && planImport === undefined ? undefined : <>{!phone && controls}{planImport}</>}
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
        toolbar={role === 'viewer' ? undefined : (
          <>
            <ActualEntry projectId={projectId} spools={data.spools} todayKey={todayKey} onSaved={reload} />
            <ActualImportFlow projectId={projectId} todayKey={todayKey} onImported={reload} />
          </>
        )}
        rowActions={admin ? rowActions : undefined}
      />

      <LateSpools projectId={projectId} warnings={warnings} thresholdDays={settings.lateThresholdDays} />

      {clearing !== null && (
        <ClearActualModal
          projectId={projectId}
          spool={clearing}
          onClose={() => setClearing(null)}
          onCleared={() => {
            setClearing(null)
            reload()
          }}
        />
      )}
    </div>
  )
}
