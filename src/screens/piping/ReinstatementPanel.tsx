import { Alert, Button, Spin, Table } from 'antd'
import { useCallback, useMemo } from 'react'
import { EmptyState } from '../../components/EmptyState'
import type { KeyFact } from '../../components/KeyFacts'
import { RulesDisclosure } from '../../components/RulesDisclosure'
import { SectionCard } from '../../components/SectionCard'
import { useTablePagination } from '../../components/tablePagination'
import {
  diffReinstatementActual, diffReinstatementPlan, diffReinstatementPlanUpdate, parseReinstatementActual,
  parseReinstatementPlan, type KeyedDiff, type PlanImportMode, type SheetRows,
} from '../../domain/piping/imports'
import {
  checkReinstatementActualImport, reinstatementSeries, reinstatementSummary,
} from '../../domain/piping/reinstatement'
import type { DayKey, ReinstatementActualImportRow, ReinstatementPlanRow } from '../../domain/piping/types'
import { formatDayMonthYear } from '../../domain/piping/week'
import { formatPercent, MISSING } from '../../lib/format'
import {
  buildReinstatementActualTemplate, buildReinstatementPlanTemplate, templateFileName,
} from '../../lib/piping/templates'
import {
  getPipingSettings, importReinstatementActual, listReinstatementEntries, listReinstatementPlan, mergeReinstatementPlan,
  replaceReinstatementPlan, type ReinstatementEntry,
} from '../../lib/pipingApi'
import { space } from '../../theme'
import { ReinstatementChart } from './charts'
import type { PipingPanelProps } from './panelProps'
import { dayNotes, usePipingNotes } from './notes/usePipingNotes'
import { HeaderActions } from './HeaderActions'
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
 * in its header, with the Actual import beside it (RV8-6). Below it, the entries: the add form for a foreman and the
 * admin, the list with edit and delete for the admin. Last, the plan as
 * imported, folded away. The list, the rules and the plan are the admin's
 * alone (RV8-8): a foreman keeps the form, a viewer the summary and the chart.
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

/** The re-import preview: every changed day, old -> new (spec §8); Update Plan removes none (RV8-5). */
function planPreview(stored: ReinstatementPlanRow[], next: ReinstatementPlanRow[], mode: PlanImportMode): PlanImportPreview {
  return mode === 'update'
    ? diffPreview(diffReinstatementPlanUpdate(stored, next), false)
    : diffPreview(diffReinstatementPlan(stored, next), true)
}

/**
 * The Actual import preview (RV8-6): every day whose total the file sets or
 * changes, old -> new, the overwrites confirmed first. A file over the cap
 * (R-4) is refused as a file error before anything is written.
 */
function actualPreview(
  entries: ReinstatementEntry[], next: ReinstatementActualImportRow[], total: number | null,
): PlanImportPreview {
  const refusal = checkReinstatementActualImport(entries, next, total)
  if (refusal !== null) throw new Error(refusal)
  const preview = diffPreview(diffReinstatementActual(entries, next), false)
  return preview.changed === 0
    ? preview
    : { ...preview, overwrites: [`Ghi đè ${formatQty(preview.changed)} ngày đã có số liệu`] }
}

/** A day-by-day diff as preview lines, by day; with its removal count when the import removes. */
function diffPreview(diff: KeyedDiff<{ day: DayKey }>, removes: boolean): PlanImportPreview {
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
    ...(removes ? { removed: diff.removed.length } : {}),
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
  const preview = useCallback(
    (rows: ReinstatementPlanRow[], importMode: PlanImportMode) => planPreview(plan ?? [], rows, importMode),
    [plan],
  )
  const parseActual = useCallback((sheets: SheetRows[]) => parseReinstatementActual(sheets, todayKey), [todayKey])
  /**
   * The entries and total Test Pack read afresh when the file is read, not
   * taken from the page: an entry added since it opened must show as an
   * overwrite, and the cap is checked against the total as stored now.
   */
  const previewActual = useCallback(async (rows: ReinstatementActualImportRow[]) => {
    const [fresh, stored] = await Promise.all([listReinstatementEntries(projectId), getPipingSettings(projectId)])
    return actualPreview(fresh, rows, stored?.totalTestPacks ?? null)
  }, [projectId])
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
          <HeaderActions>
            <PlanImportFlow<ReinstatementPlanRow>
              planLabel="Reinstatement Plan"
              templateName={templateFileName('reinstatement_plan')}
              buildTemplate={buildReinstatementPlanTemplate}
              parse={parseReinstatementPlan}
              preview={preview}
              modes
              lineHeader="Ngày"
              commit={({ rows, fileName, summary, mode: importMode }) => (importMode === 'update'
                ? mergeReinstatementPlan(projectId, rows, fileName, summary)
                : replaceReinstatementPlan(projectId, rows, fileName, summary))}
              onImported={reload}
            />
            <PlanImportFlow<ReinstatementActualImportRow>
              planLabel="Reinstatement Actual"
              templateLabel="Tải file mẫu Actual"
              importText="Nhập Actual"
              okText="Nhập Actual"
              primary={false}
              templateName={templateFileName('reinstatement_actual')}
              buildTemplate={buildReinstatementActualTemplate}
              parse={parseActual}
              preview={previewActual}
              lineHeader="Ngày"
              leadLine={(days) => `${formatQty(days)} ngày trong file thay số lượng đã nhập của ngày đó, ngày khác giữ nguyên.`}
              commit={({ rows, fileName, summary }) => importReinstatementActual(projectId, rows, fileName, summary)}
              onImported={reload}
            />
          </HeaderActions>
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

      {role !== 'viewer' && (
        <SectionCard
          title="Số lượng đã nhập"
          facts={[{ value: formatQty(data.entries.length), label: 'lần nhập' }]}
          extra={notes.byDay?.('reinstatement_day', 'Reinstatement', todayKey)}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: space.md }}>
            <EntryForm
              projectId={projectId}
              entries={data.entries}
              totalTestPacks={total}
              todayKey={todayKey}
              onAdded={reload}
            />
            {admin && (
              <>
                <EntriesTable
                  projectId={projectId}
                  entries={data.entries}
                  totalTestPacks={total}
                  todayKey={todayKey}
                  canEdit
                  onChanged={reload}
                  dayExtra={dayExtra}
                />
                <RulesDisclosure rules={RULES} />
              </>
            )}
          </div>
        </SectionCard>
      )}

      {admin && data.plan.length > 0 && <PlanCard projectId={projectId} plan={data.plan} />}
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
