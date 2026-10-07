import type { TableColumnType as ColumnType } from 'antd'
import type { ReactNode } from 'react'
import type { ManpowerDayRow } from '../../../domain/piping/manpower'
import type { DayKey, ManpowerGroup } from '../../../domain/piping/types'
import { formatDayMonthYear } from '../../../domain/piping/week'
import { MISSING } from '../../../lib/format'
import { formatQty } from '../pipingFormat'

/**
 * The columns a Manpower day grid shares (the actual history, the plan): the
 * day, one column per group in order -- a hidden group's header says so, its
 * history still shows (R-8) -- and the total. Numbers and dates centred
 * (UI-03); an empty cell is `-`. `pin` keeps the day in view on a phone
 * (MOB-01).
 */
export function dayGridColumns<T extends ManpowerDayRow>(
  groups: ManpowerGroup[],
  pin: 'left' | undefined,
  dayExtra?: (day: DayKey) => ReactNode,
): ColumnType<T>[] {
  return [
    {
      title: 'Ngày',
      dataIndex: 'day',
      align: 'center',
      fixed: pin,
      render: (day: DayKey) => (
        <>
          {formatDayMonthYear(day)}
          {dayExtra?.(day)}
        </>
      ),
    },
    ...groups.map((g): ColumnType<T> => ({
      title: g.hidden ? `${g.name} (ẩn)` : g.name,
      key: g.id,
      align: 'center',
      render: (_v, row) => {
        const value = row.byGroup[g.id]
        return value === undefined ? MISSING : formatQty(value)
      },
    })),
    { title: 'Tổng', dataIndex: 'total', align: 'center', render: (total: number) => formatQty(total) },
  ]
}
