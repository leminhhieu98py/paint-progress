import { Alert, Button, Spin, Table } from 'antd'
import { useCallback, useMemo } from 'react'
import { EmptyState } from '../../components/EmptyState'
import type { KeyFact } from '../../components/KeyFacts'
import { RulesDisclosure } from '../../components/RulesDisclosure'
import { SectionCard } from '../../components/SectionCard'
import { useTablePagination } from '../../components/tablePagination'
import { diffReinstatementPlan, parseReinstatementPlan } from '../../domain/piping/imports'
import { reinstatementSeries, reinstatementSummary } from '../../domain/piping/reinstatement'
import type { ReinstatementPlanRow } from '../../domain/piping/types'
import { formatDayMonthYear } from '../../domain/piping/week'
import { formatPercent, MISSING } from '../../lib/format'
import { buildReinstatementPlanTemplate, templateFileName } from '../../lib/piping/templates'
import {
  listReinstatementEntries, listReinstatementPlan, replaceReinstatementPlan, type ReinstatementEntry,
} from '../../lib/pipingApi'
import { space } from '../../theme'
import { ReinstatementChart } from './charts'
import type { PipingPanelProps } from './panelProps'
import { dayNotes, usePipingNotes } from './notes/usePipingNotes'
import { PlanImportFlow, type PlanImportPreview } from './PlanImportFlow'
import { formatQty } from './pipingFormat'
import { EntriesTable } from './reinstatement/EntriesTable'
import { EntryForm } from './reinstatement/EntryForm'
import { usePanelData } from './usePanelData'

/**
 * The Reinstatement tab of the Piping page (spec §4, R-3, R-4, R-5, Q8-Q10).
 *
 * The card "Reinstatement" carries the summary beside its title
 * (`235/1.022 – 22,99% TestPack`) and the chart; the admin's Plan import sits
 * in its header. Below it, the entries: the add form for a foreman and the
 * admin, the list for everyone, edit and delete for the admin. Last, the plan
 * as imported, folded away.
 */

interface ReinstatementData {
  plan: ReinstatementPlanRow[]
  entries: ReinstatementEntry[]
}

async function readReinstatement(projectId: string): Promise<ReinstatementData> {
  const [plan, entries] = await Promise.all([listReinstatementPlan(projectId), listReinstatementEntries(projectId)])
  return { plan, entries }
}

const RULES = [
  { id: 'day', text: 'Chỉ nhập được ngày từ hôm nay trở về trước.' },
  { id: 'cap', text: 'Tổng số lượng đã nhập không được vượt tổng Test Pack.' },
  { id: 'sum', text: 'Nhiều lần nhập trong một ngày được cộng dồn.' },
  { id: 'admin', text: 'Chỉ admin sửa hoặc xoá được số lượng đã nhập.' },
]

/** `235/1.022 – 22,99%` + TestPack; `-` for a total not set, with where to set it. */
function summaryFact(entries: ReinstatementEntry[], total: number | null, admin: boolean): KeyFact {
  const s = reinstatementSummary(entries, total)
  const value = `${formatQty(s.actual)}/${s.total === null ? MISSING : formatQty(s.total)}`
    + ` – ${s.ratio === null ? MISSING : formatPercent(s.ratio)}`
  if (s.total !== null) return { value, label: 'TestPack' }
  return {
    value,
    label: 'TestPack',
    tone: 'warning',
    info: admin ? 'Nhập tổng Test Pack trong Cấu hình' : 'Admin chưa nhập tổng Test Pack',
  }
}

/** The re-import preview: every changed day, old -> new (spec §8). */
function planPreview(stored: ReinstatementPlanRow[], next: ReinstatementPlanRow[]): PlanImportPreview {
  const diff = diffReinstatementPlan(stored, next)
  const lines = [
    ...diff.added.map((d) => ({ key: d.day, change: 'added' as const, from: null, to: formatQty(d.to), day: d.day })),
    ...diff.changed.map((d) => ({
      key: d.day, change: 'changed' as const, from: formatQty(d.from), to: formatQty(d.to), day: d.day,
    })),
    ...diff.removed.map((d) => ({ key: d.day, change: 'removed' as const, from: formatQty(d.from), to: null, day: d.day })),
  ]
    .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0))
    .map(({ day, ...line }) => ({ ...line, label: formatDayMonthYear(day) }))
  return {
    added: diff.added.length,
    changed: diff.changed.length,
    removed: diff.removed.length,
    unchanged: diff.unchangedCount,
    lines,
  }
}

export function ReinstatementPanel({ projectId, settings, mode, role, todayKey, refreshKey }: PipingPanelProps) {
  const { data, error, loading, reload } = usePanelData(projectId, refreshKey, readReinstatement)
  const admin = role === 'admin'
  const total = settings.totalTestPacks

  const series = useMemo(
    () => (data === null
      ? []
      : reinstatementSeries({
        plan: data.plan, actual: data.entries, mode, weekStart: settings.weekStartDate, todayKey,
      })),
    [data, mode, settings.weekStartDate, todayKey],
  )
  const plan = data?.plan
  const preview = useCallback((rows: ReinstatementPlanRow[]) => planPreview(plan ?? [], rows), [plan])
  /** The admin's notes on a day (spec §9); none for a foreman or a viewer. */
  const notes = usePipingNotes(projectId, refreshKey, admin)
  const noteAction = notes.action
  const dayExtra = useMemo(() => noteAction && dayNotes(noteAction, 'reinstatement_day', 'Reinstatement'), [noteAction])

  if (error !== null) {
    return (
      <Alert
        type="error"
        showIcon
        message="Không tải được Reinstatement"
        description={error}
        action={<Button onClick={reload}>Thử lại</Button>}
      />
    )
  }
  if (data === null) return <Spin style={{ display: 'block', margin: '15vh auto' }} />

  return (
    // Keyed on the project: a typed quantity or an open dialog never carries over to the next one.
    <div key={projectId} style={{ display: 'flex', flexDirection: 'column', gap: space.lg }}>
      {notes.alert}
      <SectionCard
        title="Reinstatement"
        facts={[summaryFact(data.entries, total, admin)]}
        extra={admin ? (
          <PlanImportFlow<ReinstatementPlanRow>
            planLabel="Reinstatement Plan"
            templateName={templateFileName('reinstatement_plan')}
            buildTemplate={buildReinstatementPlanTemplate}
            parse={parseReinstatementPlan}
            preview={preview}
            lineHeader="Ngày"
            commit={({ rows, fileName, summary }) => replaceReinstatementPlan(projectId, rows, fileName, summary)}
            onImported={reload}
          />
        ) : undefined}
      >
        {series.length === 0
          // An empty answer is not the last word while a re-read runs (after an import or a save).
          ? (loading
            ? <Spin style={{ display: 'block', margin: `${space.xxl}px auto` }} />
            : <EmptyState title="Chưa có Plan hoặc số lượng Reinstatement" />)
          // Keyed on the view: the Brush's zoom belongs to one axis, not to the next.
          : <ReinstatementChart key={mode} data={series} mode={mode} />}
      </SectionCard>

      <SectionCard
        title="Số lượng đã nhập"
        facts={[{ value: formatQty(data.entries.length), label: 'lần nhập' }]}
        extra={notes.byDay?.('reinstatement_day', 'Reinstatement', todayKey)}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: space.md }}>
          {role !== 'viewer' && (
            <EntryForm
              projectId={projectId}
              entries={data.entries}
              totalTestPacks={total}
              todayKey={todayKey}
              onAdded={reload}
            />
          )}
          <EntriesTable
            projectId={projectId}
            entries={data.entries}
            totalTestPacks={total}
            todayKey={todayKey}
            canEdit={admin}
            onChanged={reload}
            dayExtra={dayExtra}
          />
          <RulesDisclosure rules={RULES} />
        </div>
      </SectionCard>

      {data.plan.length > 0 && <PlanCard projectId={projectId} plan={data.plan} />}
      {notes.drawer}
    </div>
  )
}

/** The plan as imported, one row per day, folded away (read-only). */
function PlanCard({ projectId, plan }: { projectId: string; plan: ReinstatementPlanRow[] }) {
  const pagination = useTablePagination(plan.length, projectId)
  const sum = plan.reduce((acc, r) => acc + r.planQty, 0)
  return (
    <SectionCard
      title="Plan"
      collapsible
      defaultOpen={false}
      facts={[{ value: formatQty(plan.length), label: 'ngày' }, { prefix: 'tổng', value: formatQty(sum) }]}
    >
      <Table<ReinstatementPlanRow>
        rowKey="day"
        dataSource={plan}
        pagination={pagination}
        columns={[
          { title: 'Ngày', dataIndex: 'day', align: 'center', render: (day: string) => formatDayMonthYear(day) },
          { title: 'Plan', dataIndex: 'planQty', align: 'center', render: (qty: number) => formatQty(qty) },
        ]}
      />
    </SectionCard>
  )
}
