import { App, Space, Table } from 'antd'
import { useMemo, useRef, useState, type ReactNode } from 'react'
import { ConsequenceModal } from '../../../components/ConsequenceModal'
import { IconAction } from '../../../components/IconAction'
import { useTablePagination } from '../../../components/tablePagination'
import { useTypeScale } from '../../../components/typeScale'
import { manpowerDays, type ManpowerDayRow } from '../../../domain/piping/manpower'
import type { DayKey, ManpowerGroup } from '../../../domain/piping/types'
import { formatDayMonthYear } from '../../../domain/piping/week'
import { formatDateTimeVN, MISSING } from '../../../lib/format'
import { setManpowerActual, type ManpowerActualEntry } from '../../../lib/pipingApi'
import { palette, space } from '../../../theme'
import { useFieldPhone } from '../../gs/fieldSections'
import { formatQty } from '../pipingFormat'
import { dayGridColumns } from './dayGridColumns'

/** A history row: the day grid plus who entered its cells and the day's latest edit. */
interface HistoryRow extends ManpowerDayRow {
  creators: string[]
  editedByName: string | null
  editedAt: string | null
}

/** Newest day first. The cells are indexed by day once, so a long history stays one pass. */
function historyRows(groups: ManpowerGroup[], actual: ManpowerActualEntry[]): HistoryRow[] {
  const byDay = new Map<DayKey, ManpowerActualEntry[]>()
  for (const c of actual) {
    const cells = byDay.get(c.day)
    if (cells) cells.push(c)
    else byDay.set(c.day, [c])
  }
  return manpowerDays(groups, actual).reverse().map((row) => {
    const cells = (byDay.get(row.day) ?? []).filter((c) => row.byGroup[c.groupId] !== undefined)
    const creators = [...new Set(cells.flatMap((c) => (c.createdByName === null ? [] : [c.createdByName])))]
    let edited: ManpowerActualEntry | null = null
    for (const c of cells) {
      if (c.editedAt !== null && (edited === null || c.editedAt > (edited.editedAt ?? ''))) edited = c
    }
    return { ...row, creators, editedByName: edited?.editedByName ?? null, editedAt: edited?.editedAt ?? null }
  })
}

/**
 * The Manpower actual as entered (spec §5, R-8): one row per day, newest
 * first, paged (UI-05) -- each group (a hidden one with history included),
 * the total, who entered the day's cells and its latest edit. Everyone reads
 * it; the admin opens a day in the entry form (Sửa) or deletes the whole day
 * after a confirmation (Xoá), hidden groups' cells included.
 */
export function ManpowerHistoryTable({ projectId, groups, actual, canEdit, onEdit, onChanged, dayExtra }: {
  projectId: string
  /** The columns, in order (`chartGroups` of the actual); stable across renders (memoised by the caller). */
  groups: ManpowerGroup[]
  actual: ManpowerActualEntry[]
  /** The admin's edit and delete actions. */
  canEdit: boolean
  /** Sửa: the panel opens the day in the entry form. */
  onEdit: (day: DayKey) => void
  /** After a write: the panel reads its data again. */
  onChanged: () => void
  /**
   * Beside a day, what the admin's notes on that day add (spec §9). The seam
   * for the notes task; nothing renders here until it passes one.
   */
  dayExtra?: (day: DayKey) => ReactNode
}) {
  const { message } = App.useApp()
  const type = useTypeScale()
  /** On a phone the day stays in view while the rest scrolls under it (MOB-01). */
  const pin = useFieldPhone() ? ('left' as const) : undefined
  const rows = useMemo(() => historyRows(groups, actual), [groups, actual])
  const gridColumns = useMemo(() => dayGridColumns<HistoryRow>(groups, pin, dayExtra), [groups, pin, dayExtra])
  const pagination = useTablePagination(rows.length, projectId)
  const [removing, setRemoving] = useState<HistoryRow | null>(null)
  /** The delete in flight, and its refusal (shown inside the confirmation, which stays open). */
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** Set synchronously, unlike `busy`: a fast double click on Xoá must not send the delete twice. */
  const deleting = useRef(false)

  const remove = async () => {
    if (removing === null || deleting.current) return
    deleting.current = true
    setBusy(true)
    setError(null)
    try {
      await setManpowerActual(
        projectId,
        removing.day,
        groups.filter((g) => removing.byGroup[g.id] !== undefined).map((g) => ({ groupId: g.id, value: null })),
      )
      message.success('Đã xoá nhân lực')
      setRemoving(null)
      onChanged()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      deleting.current = false
      setBusy(false)
    }
  }

  return (
    <>
      <div data-testid="manpower-history">
        <Table<HistoryRow>
          rowKey="day"
          dataSource={rows}
          pagination={pagination}
          scroll={{ x: 'max-content' }}
          locale={{ emptyText: 'Chưa có nhân lực nào' }}
          columns={[
            ...gridColumns,
            {
              title: 'Người nhập',
              key: 'creators',
              render: (_v, row) => (row.creators.length === 0 ? MISSING : row.creators.join(', ')),
            },
            {
              title: 'Sửa bởi',
              key: 'edited',
              render: (_v, row) => (row.editedAt === null
                ? MISSING
                : (
                  <div>
                    <div>{row.editedByName ?? MISSING}</div>
                    <div style={{ ...type.caption, color: palette.textTertiary }}>{formatDateTimeVN(row.editedAt)}</div>
                  </div>
                )),
            },
            ...(canEdit
              ? [{
                title: 'Thao tác',
                key: 'actions',
                align: 'center' as const,
                fixed: 'right' as const,
                width: 120,
                render: (_v: unknown, row: HistoryRow) => (
                  <Space size={space.xs}>
                    <IconAction verb="edit" label="Sửa nhân lực" disabled={busy} onClick={() => onEdit(row.day)} />
                    <IconAction
                      verb="delete"
                      label="Xoá nhân lực"
                      danger
                      disabled={busy}
                      onClick={() => {
                        setError(null)
                        setRemoving(row)
                      }}
                    />
                  </Space>
                ),
              }]
              : []),
          ]}
        />
      </div>

      <ConsequenceModal
        open={removing !== null}
        tone="danger"
        title={removing ? `Xoá nhân lực ngày ${formatDayMonthYear(removing.day)}?` : ''}
        items={removing
          ? groups
            .filter((g) => removing.byGroup[g.id] !== undefined)
            .map((g) => ({ label: g.name, meta: formatQty(removing.byGroup[g.id]) }))
          : undefined}
        consequences={['Không khôi phục được']}
        okText="Xoá"
        confirmLoading={busy}
        error={error}
        onOk={() => void remove()}
        onCancel={() => !busy && setRemoving(null)}
      />
    </>
  )
}
