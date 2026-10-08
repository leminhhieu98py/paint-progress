import { DownOutlined, RightOutlined } from '@ant-design/icons'
import { Button, Select, Table, Tooltip, type TableColumnsType } from 'antd'
import { useMemo, useState } from 'react'
import { EmptyState } from '../../../components/EmptyState'
import { InfoTip } from '../../../components/InfoTip'
import { SectionCard } from '../../../components/SectionCard'
import { searchSelectProps, useFullOptionsProps } from '../../../components/searchSelect'
import { StatusPill, type StatusTone } from '../../../components/StatusPill'
import { useTablePagination } from '../../../components/tablePagination'
import {
  lateSpoolCount, MILESTONE_DEPARTMENT, MILESTONE_LABEL, MILESTONES, type LateWarning,
} from '../../../domain/piping/cam'
import type { Milestone } from '../../../domain/piping/types'
import { formatDayMonthYear } from '../../../domain/piping/week'
import { MISSING } from '../../../lib/format'
import { useFieldPhone } from '../../gs/fieldSections'
import { formatQty } from '../pipingFormat'
import { ControlRow } from './ControlRow'
import { PHONE_CONTROL } from './controlStyle'
import { lateGroupRows, lateRule, type LateGroupRow } from './lateGroups'

/**
 * The "Spool trễ" card of the Insulation tab (spec §7), for every role: the
 * late spools grouped by Package or Line (a searchable select, FLT-07), each
 * group with its late spools and late milestones per milestone; a group opens
 * to its own paged list -- SpoolNo, milestone, the department that answers for
 * it, plan, actual and the days late.
 */

type LateBy = 'package' | 'line'

const GROUPINGS: Array<{ value: LateBy; label: string }> = [
  { value: 'package', label: 'Package' },
  { value: 'line', label: 'Line' },
]

/** One colour per milestone, and its department the same: a milestone answers to one department. */
const MILESTONE_TONE: Record<Milestone, StatusTone> = { ph: 'accent', ih: 'info', iw: 'slate' }

const DEPARTMENT_INFO = MILESTONES
  .map((m) => `${MILESTONE_LABEL[m]}: ${MILESTONE_DEPARTMENT[m].department} ${MILESTONE_DEPARTMENT[m].duty}`)
  .join('. ')

const DAYS_LATE_INFO = 'Tính từ ngày Plan đến ngày Actual, hoặc đến hôm nay khi chưa có Actual'

const groupName = (key: string) => (key === '' ? MISSING : key)

export function LateSpools({ projectId, warnings, thresholdDays }: {
  projectId: string
  /** `lateWarnings` of the project's spools. */
  warnings: LateWarning[]
  thresholdDays: number
}) {
  const phone = useFieldPhone()
  const fullOptionsProps = useFullOptionsProps()
  const [by, setBy] = useState<LateBy>('package')
  const rows = useMemo(() => lateGroupRows(warnings, by), [warnings, by])
  const pagination = useTablePagination(rows.length, `${projectId}|${by}`)
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

  return (
    <SectionCard
      title="Spool trễ"
      facts={[{ value: formatQty(lateSpoolCount(warnings)), label: 'spool', info: lateRule(thresholdDays) }]}
      extra={phone ? undefined : select}
    >
      {phone && <div style={{ marginBottom: 12 }}><ControlRow>{select}</ControlRow></div>}
      {warnings.length === 0
        ? <EmptyState title="Không có spool trễ" />
        : (
          <div data-testid="late-spools">
            <Table<LateGroupRow>
              rowKey={(r) => `g:${r.key}`}
              dataSource={rows}
              columns={columns}
              pagination={pagination}
              scroll={{ x: 'max-content' }}
              expandable={{
                expandedRowRender: (r) => <LateSpoolList resetKey={`${projectId}|${by}|${r.key}`} warnings={r.warnings} pin={pin} />,
                // An icon-only toggle: its name is its tooltip (ACT-01).
                expandIcon: ({ expanded, onExpand, record }) => (
                  <Tooltip title={expanded ? 'Ẩn spool' : 'Xem spool'}>
                    <Button
                      type="text"
                      aria-label={expanded ? 'Ẩn spool' : 'Xem spool'}
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
            title: 'Milestone',
            key: 'milestone',
            align: 'center',
            render: (_v, w) => <StatusPill tone={MILESTONE_TONE[w.milestone]}>{MILESTONE_LABEL[w.milestone]}</StatusPill>,
          },
          {
            title: <>Bộ phận<InfoTip text={DEPARTMENT_INFO} /></>,
            key: 'department',
            align: 'center',
            render: (_v, w) => <StatusPill tone={MILESTONE_TONE[w.milestone]}>{w.department}</StatusPill>,
          },
          { title: 'Plan', key: 'plan', align: 'center', render: (_v, w) => formatDayMonthYear(w.plan) },
          {
            title: 'Actual',
            key: 'actual',
            align: 'center',
            render: (_v, w) => (w.actual === null ? MISSING : formatDayMonthYear(w.actual)),
          },
          {
            title: <>Số ngày trễ<InfoTip text={DAYS_LATE_INFO} /></>,
            key: 'daysLate',
            align: 'center',
            render: (_v, w) => formatQty(w.daysLate),
          },
        ]}
      />
    </div>
  )
}
