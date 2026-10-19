import { DownOutlined, RightOutlined, SearchOutlined } from '@ant-design/icons'
import { Button, Input, Select, Table, Tooltip, type TableColumnsType } from 'antd'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { EmptyState } from '../../../components/EmptyState'
import { InfoTip } from '../../../components/InfoTip'
import { SectionCard } from '../../../components/SectionCard'
import { searchSelectProps, useFullOptionsProps } from '../../../components/searchSelect'
import { StatusPill, type StatusTone } from '../../../components/StatusPill'
import { useTablePagination } from '../../../components/tablePagination'
import { SEARCH_DEBOUNCE_MS } from '../../../components/useDebouncedValue'
import {
  lateSpoolCount, MILESTONE_DEPARTMENT, MILESTONE_LABEL, MILESTONES, type LateWarning,
} from '../../../domain/piping/cam'
import type { Milestone } from '../../../domain/piping/types'
import { formatDayMonthYear } from '../../../domain/piping/week'
import { MISSING } from '../../../lib/format'
import { space } from '../../../theme'
import { useFieldPhone } from '../../gs/fieldSections'
import { HeaderActions } from '../HeaderActions'
import { formatQty } from '../pipingFormat'
import { ControlRow } from './ControlRow'
import { PHONE_CONTROL } from './controlStyle'
import { lateGroupRows, lateRule, lateSpoolRows, type LateGroupRow, type LateSpoolRow } from './lateGroups'

/**
 * The "Spool trễ" card of the Insulation tab (spec §7), for every role: the
 * late spools grouped by Package or Line (a searchable select, FLT-07), each
 * group with its late spools and late milestones per milestone; a group opens
 * to its own paged list -- SpoolNo, milestone, the department that answers for
 * it, plan, actual and the days late. The Spool level lists the late spools
 * themselves, one row each, with the same late info per milestone; a search
 * of SpoolNo, LineNo and Test Package No narrows every level (RV8-10).
 */

type LateBy = 'package' | 'line' | 'spool'

const GROUPINGS: Array<{ value: LateBy; label: string }> = [
  { value: 'package', label: 'Package' },
  { value: 'line', label: 'Line' },
  { value: 'spool', label: 'Spool' },
]

/** One colour per milestone, and its department the same: a milestone answers to one department. */
const MILESTONE_TONE: Record<Milestone, StatusTone> = { ph: 'accent', ih: 'info', iw: 'slate' }

const departmentInfo = (m: Milestone) =>
  `${MILESTONE_LABEL[m]}: ${MILESTONE_DEPARTMENT[m].department} ${MILESTONE_DEPARTMENT[m].duty}`

const DEPARTMENT_INFO = MILESTONES.map(departmentInfo).join('. ')

const DAYS_LATE_INFO = 'Tính từ ngày Plan đến ngày Actual, hoặc đến hôm nay khi chưa có Actual'

const NO_MATCH = 'Không có spool trễ khớp tìm kiếm'

const groupName = (key: string) => (key === '' ? MISSING : key)

/** A late milestone's cells, the same in a group's list and on the Spool level. */
const departmentCell = (w: LateWarning) => <StatusPill tone={MILESTONE_TONE[w.milestone]}>{w.department}</StatusPill>
const planCell = (w: LateWarning) => formatDayMonthYear(w.plan)
const actualCell = (w: LateWarning) => (w.actual === null ? MISSING : formatDayMonthYear(w.actual))
const daysLateCell = (w: LateWarning) => formatQty(w.daysLate)
const departmentTitle = (info: string) => <>Bộ phận<InfoTip text={info} /></>
const daysLateTitle = <>Số ngày trễ<InfoTip text={DAYS_LATE_INFO} /></>

/** The toggle's name says which group it opens; the "-" group is the spools with no Package or Line. */
const toggleName = (expanded: boolean, key: string, by: LateBy) =>
  `${expanded ? 'Ẩn' : 'Xem'} spool ${key === '' ? `không có ${by === 'line' ? 'Line' : 'Package'}` : `của ${key}`}`

export function LateSpools({ projectId, warnings, thresholdDays }: {
  projectId: string
  /** `lateWarnings` of the project's spools. */
  warnings: LateWarning[]
  thresholdDays: number
}) {
  const phone = useFieldPhone()
  const fullOptionsProps = useFullOptionsProps()
  const [by, setBy] = useState<LateBy>('package')
  /** What is typed in the search box, and what is applied once the typing pauses (FLT-08). */
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState('')
  const queryTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(queryTimer.current), [])

  const rows = useMemo(() => (by === 'spool' ? [] : lateGroupRows(warnings, by, search)), [warnings, by, search])
  const spoolRows = useMemo(() => (by === 'spool' ? lateSpoolRows(warnings, search) : []), [warnings, by, search])
  const shownCount = by === 'spool' ? spoolRows.length : lateSpoolCount(rows.flatMap((r) => r.warnings))
  const pagination = useTablePagination(by === 'spool' ? spoolRows.length : rows.length, `${projectId}|${by}|${search}`)
  /** On a phone the row's name stays in view while the rest scrolls under it (MOB-01). */
  const pin = phone ? ('left' as const) : undefined

  const columns = useMemo((): TableColumnsType<LateGroupRow> => [
    { title: by === 'line' ? 'LineNo' : 'Test Package No', key: 'key', fixed: pin, render: (_v, r) => groupName(r.key) },
    { title: 'Số spool trễ', key: 'spools', align: 'center', render: (_v, r) => formatQty(r.spoolCount) },
    ...MILESTONES.map((m) => ({
      title: MILESTONE_LABEL[m],
      key: m,
      align: 'center' as const,
      render: (_v: unknown, r: LateGroupRow) => formatQty(r.counts[m]),
    })),
  ], [by, pin])

  const spoolColumns = useMemo((): TableColumnsType<LateSpoolRow> => [
    { title: 'SpoolNo', key: 'spoolNo', fixed: pin, render: (_v, r) => r.spoolNo },
    { title: 'LineNo', key: 'lineNo', render: (_v, r) => groupName(r.lineNo?.trim() ?? '') },
    { title: 'Test Package No', key: 'testPackageNo', render: (_v, r) => groupName(r.testPackageNo?.trim() ?? '') },
    // A milestone on time for the spool has no late info: "-" in each of its cells.
    ...MILESTONES.map((m) => {
      const lateCell = (cell: (w: LateWarning) => ReactNode) => (_v: unknown, r: LateSpoolRow) => {
        const w = r.late[m]
        return w === undefined ? MISSING : cell(w)
      }
      return {
        title: MILESTONE_LABEL[m],
        key: m,
        children: [
          { title: departmentTitle(departmentInfo(m)), key: `${m}-department`, align: 'center' as const, render: lateCell(departmentCell) },
          { title: 'Plan', key: `${m}-plan`, align: 'center' as const, render: lateCell(planCell) },
          { title: 'Actual', key: `${m}-actual`, align: 'center' as const, render: lateCell(actualCell) },
          { title: daysLateTitle, key: `${m}-daysLate`, align: 'center' as const, render: lateCell(daysLateCell) },
        ],
      }
    }),
  ], [pin])

  const select = (
    <Select<LateBy>
      aria-label="Nhóm spool trễ theo"
      {...searchSelectProps}
      {...fullOptionsProps}
      style={phone ? PHONE_CONTROL : { width: 130 }}
      value={by}
      options={GROUPINGS}
      onChange={setBy}
    />
  )
  const applyQuery = (text: string) => {
    clearTimeout(queryTimer.current)
    setSearch(text)
  }
  const searchBox = (
    <Input
      allowClear
      aria-label="Tìm spool trễ"
      placeholder="Tìm Spool / Line / Package"
      prefix={<SearchOutlined aria-hidden />}
      style={phone ? PHONE_CONTROL : { width: 240 }}
      value={query}
      onChange={(e) => {
        const text = e.target.value
        setQuery(text)
        clearTimeout(queryTimer.current)
        // Cleared (its x, or emptied): at once. Typed: once the typing pauses.
        if (text === '') applyQuery(text)
        else queryTimer.current = setTimeout(() => applyQuery(text), SEARCH_DEBOUNCE_MS)
      }}
      onPressEnter={() => applyQuery(query)}
    />
  )

  return (
    <SectionCard
      title="Spool trễ"
      facts={[{ value: formatQty(shownCount), label: 'spool', info: lateRule(thresholdDays) }]}
      extra={phone ? undefined : <HeaderActions>{select}{searchBox}</HeaderActions>}
    >
      {phone && <div style={{ marginBottom: space.md }}><ControlRow>{select}{searchBox}</ControlRow></div>}
      {warnings.length === 0
        ? <EmptyState title="Không có spool trễ" />
        : by === 'spool'
          ? (
            <div data-testid="late-spools">
              <Table<LateSpoolRow>
                rowKey={(r) => `s:${r.spoolId}`}
                dataSource={spoolRows}
                columns={spoolColumns}
                pagination={pagination}
                scroll={{ x: 'max-content' }}
                locale={{ emptyText: NO_MATCH }}
              />
            </div>
          )
          : (
            <div data-testid="late-spools">
              <Table<LateGroupRow>
                rowKey={(r) => `g:${r.key}`}
                dataSource={rows}
                columns={columns}
                pagination={pagination}
                scroll={{ x: 'max-content' }}
                locale={{ emptyText: NO_MATCH }}
                expandable={{
                  expandedRowRender: (r) => (
                    <LateSpoolList resetKey={`${projectId}|${by}|${search}|${r.key}`} warnings={r.warnings} pin={pin} />
                  ),
                  // An icon-only toggle: its name is its tooltip (ACT-01).
                  expandIcon: ({ expanded, onExpand, record }) => (
                    <Tooltip title={toggleName(expanded, record.key, by)}>
                      <Button
                        type="text"
                        aria-label={toggleName(expanded, record.key, by)}
                        aria-expanded={expanded}
                        icon={expanded ? <DownOutlined aria-hidden /> : <RightOutlined aria-hidden />}
                        onClick={(e) => onExpand(record, e)}
                      />
                    </Tooltip>
                  ),
                }}
              />
            </div>
          )}
    </SectionCard>
  )
}

/** A group's late milestones, one row each, paged (UI-05). */
function LateSpoolList({ resetKey, warnings, pin }: {
  resetKey: string
  warnings: LateWarning[]
  pin: 'left' | undefined
}) {
  const pagination = useTablePagination(warnings.length, resetKey)
  return (
    <div data-testid="late-spool-list">
      <Table<LateWarning>
        rowKey={(w) => `${w.spoolId}|${w.milestone}`}
        dataSource={warnings}
        pagination={pagination}
        scroll={{ x: 'max-content' }}
        columns={[
          { title: 'SpoolNo', key: 'spoolNo', fixed: pin, render: (_v, w) => w.spoolNo },
          {
            title: 'Mốc',
            key: 'milestone',
            align: 'center',
            render: (_v, w) => <StatusPill tone={MILESTONE_TONE[w.milestone]}>{MILESTONE_LABEL[w.milestone]}</StatusPill>,
          },
          { title: departmentTitle(DEPARTMENT_INFO), key: 'department', align: 'center', render: (_v, w) => departmentCell(w) },
          { title: 'Plan', key: 'plan', align: 'center', render: (_v, w) => planCell(w) },
          { title: 'Actual', key: 'actual', align: 'center', render: (_v, w) => actualCell(w) },
          { title: daysLateTitle, key: 'daysLate', align: 'center', render: (_v, w) => daysLateCell(w) },
        ]}
      />
    </div>
  )
}
