import { EllipsisOutlined, FileExcelOutlined, LoadingOutlined } from '@ant-design/icons'
import { App, Button, Dropdown } from 'antd'
import { useRef, useState } from 'react'
import { camSeriesKeys } from '../../domain/piping/cam'
import { resolveUnit } from '../../domain/piping/camUnit'
import { manpowerSeries, planAverage } from '../../domain/piping/manpower'
import type { CamSelection, Unit } from '../../domain/piping/types'
import { resolveChartColors } from './chartColors'
import { renderChartPng, type ChartSpec } from './report/chartImage'
import {
  buildPipingReport, pipingReportFileName, pipingReportSeries, type ChartKey, type PipingReportInput, type ReportChart,
} from '../../lib/piping/report'
import {
  listManpowerActual, listManpowerGroups, listManpowerPlan, listNotes, listReinstatementEntries,
  listReinstatementPlan, listSpoolColumns, listSpools,
} from '../../lib/pipingApi'
import { downloadWorkbook } from '../../lib/projectReport'
import { listProjectNames } from '../../lib/projectsApi'
import { useFieldPhone } from '../gs/fieldSections'
import { useInsulationSelectionValue, useInsulationUnitValue } from './insulationUnit'
import { manpowerSelectionOnScreen } from './manpowerSelection'
import type { PipingPanelProps } from './panelProps'

/**
 * Xuất báo cáo (spec §10), the "Report" text button at the end of the Piping
 * filter bar for every role (GS-09, RV8-1): on a field phone it folds into
 * one `⋯` menu item with the same word, as on the GS screen.
 *
 * A click reads what the report needs afresh -- the panels' data, and the
 * admin's notes only for the admin (spec §9: a GS or viewer never asks for
 * them) -- in the page's current Ngày | Tuần view and Insulation unit,
 * renders the three charts off screen, and downloads the workbook. One
 * export at a time; a chart that cannot be drawn is written as such rather
 * than failing the file.
 *
 * `panel` is null while the project's settings are read: the action keeps its
 * place in the bar, disabled, so the bar does not jump.
 */

const LABEL = 'Report'

async function chartPicture(spec: ChartSpec | null): Promise<ReportChart | undefined> {
  if (spec === null) return undefined
  try {
    return await renderChartPng(spec)
  } catch {
    return 'failed'
  }
}

/** The Insulation tab's choices on screen: the report's unit and its chart's lines. */
interface InsulationView {
  unit: Unit
  selection: CamSelection
}

/** The project's name and code for the file, from the page's own project list read (no extra module). */
async function projectIdentity(projectId: string): Promise<{ name: string; code: string }> {
  const project = (await listProjectNames()).find((p) => p.id === projectId)
  if (!project) throw new Error('Không đọc được dự án để đặt tên báo cáo.')
  return { name: project.name, code: project.code }
}

async function exportReport(panel: PipingPanelProps, { unit, selection }: InsulationView): Promise<void> {
  const { projectId, settings, mode, todayKey } = panel
  const admin = panel.role === 'admin'
  const [project, plan, entries, groups, mpPlan, mpActual, spools, columns, notes] = await Promise.all([
    projectIdentity(projectId),
    listReinstatementPlan(projectId),
    listReinstatementEntries(projectId),
    listManpowerGroups(projectId),
    listManpowerPlan(projectId),
    listManpowerActual(projectId),
    listSpools(projectId),
    listSpoolColumns(projectId),
    admin ? listNotes(projectId) : Promise.resolve([]),
  ])
  const data: Omit<PipingReportInput, 'charts'> = {
    project,
    settings,
    mode,
    unit,
    todayKey,
    reinstatement: { plan, actual: entries },
    manpower: { groups, plan: mpPlan, actual: mpActual },
    spools,
    columns,
    includeNotes: admin,
    notes,
  }
  const series = pipingReportSeries(data)
  // The Manpower picture draws the groups the tab's Nhóm select shows (RV8-7); its table keeps every group.
  const selected = manpowerSelectionOnScreen(projectId, groups, mpPlan, mpActual)
  const manpowerPoints = manpowerSeries({
    groups: series.manpower.groups, plan: mpPlan, actual: mpActual, mode, weekStart: settings.weekStartDate, todayKey,
    selected,
  })
  // The project's colours (RV8-2), resolved over the groups the chart draws, as the tab does.
  const colors = resolveChartColors(settings.chartColors, series.manpower.groups)
  // One after another: each borrows the page for a moment, off screen.
  const specs: Array<[ChartKey, ChartSpec | null]> = [
    ['reinstatement', series.reinstatement.length === 0
      ? null
      : { kind: 'reinstatement', data: series.reinstatement, mode, colors }],
    ['manpower', manpowerPoints.length === 0
      ? null
      : {
        kind: 'manpower', data: manpowerPoints, groups: series.manpower.groups, selected,
        planAverage: planAverage(mpPlan, selected), mode, colors,
      }],
    ['insulation', series.insulation.points.length === 0
      ? null
      : {
        kind: 'insulation', data: series.insulation.points, keys: camSeriesKeys(selection), mode, colors,
        // A number column's sums step the axes by fractions, as on screen (RV9-1).
        decimals: resolveUnit(unit, columns).count.kind === 'sum',
      }],
  ]
  const charts: PipingReportInput['charts'] = {}
  for (const [key, spec] of specs) {
    const picture = await chartPicture(spec)
    if (picture !== undefined) charts[key] = picture
  }
  const blob = await buildPipingReport({ ...data, charts }, series)
  downloadWorkbook(blob, pipingReportFileName(project.code, todayKey))
}

export function PipingExportAction({ panel, variant }: {
  panel: PipingPanelProps | null
  /** The page's variant, known before its panel: the field phone's ⋯ menu keeps its place while loading. */
  variant?: PipingPanelProps['variant']
}) {
  const { message } = App.useApp()
  const phone = useFieldPhone()
  const unit = useInsulationUnitValue(panel?.projectId ?? null)
  const selection = useInsulationSelectionValue(panel?.projectId ?? null)
  const [busy, setBusy] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  // The state answers after a render; a second click before it must not start a second export.
  const running = useRef(false)

  const run = async () => {
    if (panel === null || running.current) return
    running.current = true
    setBusy(true)
    try {
      await exportReport(panel, { unit, selection })
      message.success('Đã xuất báo cáo Piping')
    } catch (e) {
      message.error(`Không xuất được báo cáo: ${(e as Error).message}`)
    } finally {
      running.current = false
      setBusy(false)
    }
  }

  if (phone && (variant ?? panel?.variant) === 'gs') {
    return (
      <Dropdown
        trigger={['click']}
        placement="bottomRight"
        open={menuOpen}
        onOpenChange={setMenuOpen}
        menu={{
          items: [{
            key: 'report',
            icon: busy ? <LoadingOutlined aria-hidden /> : <FileExcelOutlined aria-hidden />,
            label: LABEL,
            disabled: busy || panel === null,
            onClick: () => { void run() },
          }],
        }}
      >
        {/* Never a spinner itself: it stays openable while the export runs, and the menu shows it running. */}
        <Button
          aria-label="Thêm thao tác"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          icon={<EllipsisOutlined aria-hidden />}
        />
      </Dropdown>
    )
  }

  return (
    // The word is the name, no tooltip (RV8-1); the aria-label keeps it while the spinner shows.
    <Button
      aria-label={LABEL}
      loading={busy}
      disabled={panel === null}
      onClick={() => { void run() }}
    >
      {LABEL}
    </Button>
  )
}
