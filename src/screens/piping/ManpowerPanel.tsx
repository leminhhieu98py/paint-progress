import { Alert, Button, Spin, Table } from 'antd'
import { useCallback, useMemo, useRef, useState } from 'react'
import { EmptyState } from '../../components/EmptyState'
import type { KeyFact } from '../../components/KeyFacts'
import { RulesDisclosure } from '../../components/RulesDisclosure'
import { SectionCard } from '../../components/SectionCard'
import { useTablePagination } from '../../components/tablePagination'
import { diffManpowerPlan, parseManpowerPlan, type SheetRows } from '../../domain/piping/imports'
import {
  chartGroups, entryGroups, manpowerAverages, manpowerDays, manpowerSeries, type ManpowerDayRow,
} from '../../domain/piping/manpower'
import { compareText } from '../../domain/piping/text'
import type { DayKey, ManpowerGroup, ManpowerValue } from '../../domain/piping/types'
import { formatDayMonthYear } from '../../domain/piping/week'
import { MISSING } from '../../lib/format'
import { buildManpowerPlanTemplate, templateFileName } from '../../lib/piping/templates'
import {
  listManpowerActual, listManpowerGroups, listManpowerPlan, replaceManpowerPlan, type ManpowerActualEntry,
} from '../../lib/pipingApi'
import { space } from '../../theme'
import { useFieldPhone } from '../gs/fieldSections'
import { dayGridColumns } from './manpower/dayGridColumns'
import { ManpowerChart } from './manpower/ManpowerChart'
import { ManpowerEntryForm } from './manpower/ManpowerEntryForm'
import { ManpowerHistoryTable } from './manpower/ManpowerHistoryTable'
import type { PipingPanelProps } from './panelProps'
import { dayNotes, usePipingNotes } from './notes/usePipingNotes'
import { HeaderActions } from './HeaderActions'
import { PlanImportFlow, type PlanImportPreview } from './PlanImportFlow'
import { formatQty } from './pipingFormat'
import { usePanelData } from './usePanelData'

/**
 * The Manpower tab of the Piping page (spec §3, §5, R-2, R-6..R-8, Q11-Q13).
 *
 * The card "Manpower" carries the average daily Plan and Actual totals beside
 * its title and the chart; the admin's Plan import sits in its header. Below
 * it, the actual: the entry form for a foreman and the admin (one input per
 * visible group for the picked day), the day grid for everyone, Sửa and Xoá
 * for the admin. Last, the plan as imported, folded away.
 */

interface ManpowerData {
  groups: ManpowerGroup[]
  plan: ManpowerValue[]
  actual: ManpowerActualEntry[]
}

async function readManpower(projectId: string): Promise<ManpowerData> {
  const [groups, plan, actual] = await Promise.all([
    listManpowerGroups(projectId), listManpowerPlan(projectId), listManpowerActual(projectId),
  ])
  return { groups, plan, actual }
}

const RULES = [
  { id: 'day', text: 'Chỉ nhập được ngày từ hôm nay trở về trước.' },
  { id: 'empty', text: 'Nhóm không có nhân lực trong ngày thì để trống.' },
  { id: 'gs', text: 'Giám sát chỉ nhập được ô còn trống, ô đã có giá trị chỉ admin sửa được.' },
  { id: 'admin', text: 'Admin sửa được mọi ô, kể cả nhóm đã ẩn, và xoá một giá trị bằng cách để trống ô.' },
  { id: 'hidden', text: 'Giám sát không nhập được nhóm đã ẩn, số liệu đã có vẫn hiển thị.' },
  { id: 'total', text: 'Tổng là tổng các nhóm trong ngày.' },
  { id: 'week', text: 'Chế độ Tuần hiển thị trung bình các ngày có số liệu trong tuần.' },
]

/** Every group by sort, hidden ones included: the template's columns (spec §8). */
function bySort(groups: ManpowerGroup[]): ManpowerGroup[] {
  return [...groups].sort((a, b) => a.sort - b.sort || compareText(a.name, b.name))
}

/** The re-import preview: every changed (day, group), old -> new (spec §8). */
function planPreview(groups: ManpowerGroup[], stored: ManpowerValue[], next: ManpowerValue[]): PlanImportPreview {
  const names = new Map(groups.map((g) => [g.id, g.name]))
  const diff = diffManpowerPlan(stored, next)
  const lines = [
    ...diff.added.map((d) => ({ ...d, change: 'added' as const, from: null, to: formatQty(d.to) })),
    ...diff.changed.map((d) => ({ ...d, change: 'changed' as const, from: formatQty(d.from), to: formatQty(d.to) })),
    ...diff.removed.map((d) => ({ ...d, change: 'removed' as const, from: formatQty(d.from), to: null })),
  ]
    .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0))
    .map(({ day, groupId, change, from, to }) => ({
      key: `${day}|${groupId}`, change, from, to, label: `${formatDayMonthYear(day)} · ${names.get(groupId) ?? MISSING}`,
    }))
  return {
    added: diff.added.length,
    changed: diff.changed.length,
    removed: diff.removed.length,
    unchanged: diff.unchangedCount,
    lines,
  }
}

/** The file's rows behind the parsed values: one per day. */
const fileDays = (rows: ManpowerValue[]) => new Set(rows.map((r) => r.day)).size

const average = (n: number | null) => (n === null ? MISSING : formatQty(n))

/** How the pill's averages are made (R-2), for its InfoTip. */
const AVERAGE_INFO = 'Mỗi nhóm lấy trung bình các ngày có số liệu đến hôm nay, rồi cộng các nhóm'

export function ManpowerPanel({ projectId, settings, mode, role, todayKey, refreshKey }: PipingPanelProps) {
  const { data, error, loading, reload } = usePanelData(projectId, refreshKey, readManpower)
  const admin = role === 'admin'
  const [day, setDay] = useState<DayKey | null>(todayKey)
  const formRef = useRef<HTMLDivElement>(null)

  const drawn = useMemo(() => (data === null ? [] : chartGroups(data.groups, data.plan, data.actual)), [data])
  const historyGroups = useMemo(() => (data === null ? [] : chartGroups(data.groups, [], data.actual)), [data])
  const series = useMemo(
    () => (data === null
      ? []
      : manpowerSeries({
        groups: drawn, plan: data.plan, actual: data.actual, mode, weekStart: settings.weekStartDate, todayKey,
      })),
    [data, drawn, mode, settings.weekStartDate, todayKey],
  )
  const groups = data?.groups
  const plan = data?.plan
  const parse = useCallback((sheets: SheetRows[]) => parseManpowerPlan(sheets, groups ?? []), [groups])
  const preview = useCallback((rows: ManpowerValue[]) => planPreview(groups ?? [], plan ?? [], rows), [groups, plan])
  const buildTemplate = useCallback(() => buildManpowerPlanTemplate(bySort(groups ?? []).map((g) => g.name)), [groups])
  /** The admin's notes on a day (spec §9); none for a foreman or a viewer. */
  const notes = usePipingNotes(projectId, refreshKey, admin)
  const noteAction = notes.action
  const dayExtra = useMemo(() => noteAction && dayNotes(noteAction, 'manpower_day', 'Manpower'), [noteAction])

  if (error !== null) {
    return (
      <Alert
        type="error"
        showIcon
        message="Không tải được Manpower"
        description={error}
        action={<Button onClick={reload}>Thử lại</Button>}
      />
    )
  }
  if (data === null) return <Spin style={{ display: 'block', margin: '15vh auto' }} />

  const averages = manpowerAverages({ groups: data.groups, plan: data.plan, actual: data.actual, todayKey })
  const facts: KeyFact[] = [{
    prefix: 'trung bình đến hôm nay',
    value: `Plan ${average(averages.plan)} · Actual ${average(averages.actual)}`,
    info: AVERAGE_INFO,
  }]
  // The admin corrects hidden groups too; a foreman enters visible ones only (R-8).
  const entry = admin ? bySort(data.groups) : entryGroups(data.groups)
  const actualDays = manpowerDays(data.groups, data.actual).length

  const editDay = (next: DayKey) => {
    setDay(next)
    formRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'center' })
  }

  return (
    // Keyed on the project: a typed value or an open dialog never carries over to the next one.
    <div key={projectId} style={{ display: 'flex', flexDirection: 'column', gap: space.lg }}>
      {notes.alert}
      <SectionCard
        // Week view averages (R-2): said in the title as well as on the total lines (spec §3).
        title={mode === 'week' ? 'Manpower (trung bình tuần)' : 'Manpower'}
        facts={facts}
        extra={admin ? (
          <HeaderActions>
            <PlanImportFlow<ManpowerValue>
              planLabel="Manpower Plan"
              templateName={templateFileName('manpower_plan')}
              buildTemplate={buildTemplate}
              parse={parse}
              preview={preview}
              lineHeader="Ngày · Nhóm"
              lineAlign="left"
              countFileRows={fileDays}
              commit={({ rows, fileName, summary }) => replaceManpowerPlan(projectId, rows, fileName, summary)}
              onImported={reload}
            />
          </HeaderActions>
        ) : undefined}
      >
        {series.length === 0
          // An empty answer is not the last word while a re-read runs (after an import or a save).
          ? (loading
            ? <Spin style={{ display: 'block', margin: `${space.xxl}px auto` }} />
            : <EmptyState title="Chưa có Plan hoặc nhân lực Manpower" />)
          // Keyed on the view: the Brush's zoom belongs to one axis, not to the next.
          : <ManpowerChart key={mode} data={series} groups={drawn} mode={mode} />}
      </SectionCard>

      <SectionCard
        title="Nhân lực đã nhập"
        facts={[{ value: formatQty(actualDays), label: 'ngày' }]}
        extra={notes.byDay?.('manpower_day', 'Manpower', todayKey)}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: space.md }}>
          {role !== 'viewer' && (
            <div ref={formRef}>
              {entry.length === 0
                ? (
                  <Alert
                    type="info"
                    showIcon
                    message={admin ? 'Thêm nhóm nhân lực trong Cấu hình' : 'Admin chưa thêm nhóm nhân lực'}
                  />
                )
                : (
                  <ManpowerEntryForm
                    projectId={projectId}
                    groups={entry}
                    actual={data.actual}
                    admin={admin}
                    todayKey={todayKey}
                    day={day}
                    onDayChange={setDay}
                    onChanged={reload}
                  />
                )}
            </div>
          )}
          <ManpowerHistoryTable
            projectId={projectId}
            groups={historyGroups}
            actual={data.actual}
            canEdit={admin}
            onEdit={editDay}
            onChanged={reload}
            dayExtra={dayExtra}
          />
          <RulesDisclosure rules={RULES} />
        </div>
      </SectionCard>

      {data.plan.length > 0 && <PlanCard projectId={projectId} groups={data.groups} plan={data.plan} />}
      {notes.drawer}
    </div>
  )
}

/** The plan as imported, one row per day, folded away (read-only). */
function PlanCard({ projectId, groups, plan }: { projectId: string; groups: ManpowerGroup[]; plan: ManpowerValue[] }) {
  const pin = useFieldPhone() ? ('left' as const) : undefined
  const rows = useMemo(() => manpowerDays(groups, plan), [groups, plan])
  const columns = useMemo(() => chartGroups(groups, plan, []), [groups, plan])
  const pagination = useTablePagination(rows.length, projectId)
  return (
    <SectionCard
      title="Plan"
      collapsible
      defaultOpen={false}
      facts={[{ value: formatQty(rows.length), label: 'ngày' }]}
    >
      <Table<ManpowerDayRow>
        rowKey="day"
        dataSource={rows}
        pagination={pagination}
        scroll={{ x: 'max-content' }}
        columns={dayGridColumns<ManpowerDayRow>(columns, pin)}
      />
    </SectionCard>
  )
}
