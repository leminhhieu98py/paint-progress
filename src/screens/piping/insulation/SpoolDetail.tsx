import { SearchOutlined } from '@ant-design/icons'
import { Input, Select, Space, Table, type TableColumnsType } from 'antd'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { settleFilters, useAppliedFilters } from '../../../components/appliedFilters'
import { FilterBar } from '../../../components/FilterBar'
import { FilterSheet } from '../../../components/FilterSheet'
import { SectionCard } from '../../../components/SectionCard'
import { searchSelectProps, useFullOptionsProps } from '../../../components/searchSelect'
import { StatusPill } from '../../../components/StatusPill'
import { useTablePagination } from '../../../components/tablePagination'
import { SEARCH_DEBOUNCE_MS } from '../../../components/useDebouncedValue'
import {
  ACTUAL_FIELD, camGroupRows, filterOptions, filterSpools, MILESTONE_LABEL, MILESTONES, PLAN_FIELD,
  type CamGroupRow, type CamSpoolFlags,
} from '../../../domain/piping/cam'
import type { CamLevel, DayKey, Spool, SpoolColumn } from '../../../domain/piping/types'
import { formatDayMonthYear } from '../../../domain/piping/week'
import { MISSING } from '../../../lib/format'
import { useFieldPhone } from '../../gs/fieldSections'
import { formatQty } from '../pipingFormat'
import { HeaderActions } from '../HeaderActions'
import { ControlRow } from './ControlRow'
import { PHONE_CONTROL } from './controlStyle'
import { spoolFlagItems } from './spoolFlags'

/**
 * The Insulation detail table (spec §6.4, Q16B): one level at a time --
 * Package, Line (grouped on its own, not under Package) or Spool. A Package or
 * Line row counts its spools done of all per milestone, with the group's plan
 * date (its spools' latest, none while one lacks it) and the day it reached
 * the milestone (its last spool's, once all have it) -- R-13. A Spool row
 * shows the master fields, the admin's extra columns, the six dates and its
 * flags. The spools with no package (or line) share one `-` row, last, with
 * counts but no dates, and are not counted as a group.
 *
 * Filtered by InsuType, Painting System, Test Package No and a search of
 * SpoolNo / LineNo, each applied as it changes (FLT-02; the search once the
 * typing pauses, at once on Enter or clear, as on Nhân lực). Paged (UI-05), so
 * a project's 20 000 spools never render at once.
 *
 * The level select and `toolbar` sit in the card's header; on a phone in a
 * wrapping row at the top of the body, the filters in their own sheet.
 *
 * Seams for the later tasks: `toolbar` (Cập nhật Actual, Nhập Actual) and
 * `rowActions`, a Thao tác column on Spool rows (clear an actual, a note).
 */

interface DetailFilters {
  insuType: string
  paintingSystem: string
  testPackageNo: string
  search: string
}

const ALL = ''
const DEFAULT_FILTERS: DetailFilters = { insuType: ALL, paintingSystem: ALL, testPackageNo: ALL, search: '' }

const SELECTS = [
  { key: 'insuType', label: 'InsuType', options: 'insuTypes', width: 170 },
  { key: 'paintingSystem', label: 'Painting System', options: 'paintingSystems', width: 200 },
  { key: 'testPackageNo', label: 'Test Package No', options: 'testPackageNos', width: 200 },
] as const

type Options = ReturnType<typeof filterOptions>

const LEVELS: Array<{ value: CamLevel; label: string }> = [
  { value: 'package', label: 'Package' },
  { value: 'line', label: 'Line' },
  { value: 'spool', label: 'Spool' },
]

/** What the count beside the title counts, per level. */
const LEVEL_NOUN: Record<CamLevel, string> = { package: 'Test Package', line: 'Line', spool: 'spool' }

const dateCell = (day: DayKey | null) => (day === null ? MISSING : formatDayMonthYear(day))
/** A group's date; the row of spools with no package or line is no group, so it has none. */
const groupDate = (row: CamGroupRow, day: DayKey | null) => (row.key === '' ? MISSING : dateCell(day))
const textCell = (value: string | null | undefined) => {
  const v = value?.trim() ?? ''
  return v === '' ? MISSING : v
}

/** A filter value the options no longer hold (after a re-import) goes back to all. */
function settle(applied: DetailFilters, options: Options): DetailFilters {
  const next = { ...applied }
  for (const s of SELECTS) {
    if (next[s.key] !== ALL && !options[s.options].includes(next[s.key])) next[s.key] = ALL
  }
  return next
}

export function SpoolDetail({ projectId, spools, columns, flags, admin, toolbar, rowActions }: {
  projectId: string
  /** Every spool of the project, in file order. */
  spools: Spool[]
  /** The admin's extra columns, in their order. */
  columns: SpoolColumn[]
  /** `camSpoolFlags` of the same spools. */
  flags: Map<string, CamSpoolFlags>
  admin: boolean
  /** Actions in the card's header, after the level toggle. */
  toolbar?: ReactNode
  /** A Thao tác column on Spool rows, when given. */
  rowActions?: (spool: Spool) => ReactNode
}) {
  const phone = useFieldPhone()
  const fullOptionsProps = useFullOptionsProps()
  const [level, setLevel] = useState<CamLevel>('package')
  const scope = useAppliedFilters(DEFAULT_FILTERS)
  /** What is typed in the search box; applied once the typing pauses (FLT-08). */
  const [query, setQuery] = useState('')
  const queryTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(queryTimer.current), [])

  const options = useMemo(() => filterOptions(spools), [spools])
  const applied = settleFilters(scope, options, settle)
  const shown = useMemo(() => filterSpools(spools, {
    insuTypes: applied.insuType === ALL ? [] : [applied.insuType],
    paintingSystems: applied.paintingSystem === ALL ? [] : [applied.paintingSystem],
    testPackageNos: applied.testPackageNo === ALL ? [] : [applied.testPackageNo],
    search: applied.search,
  }), [spools, applied.insuType, applied.paintingSystem, applied.testPackageNo, applied.search])
  // The spools with no package (or line) are no group: their row comes last and is not counted as one.
  const groups = useMemo(() => {
    if (level === 'spool') return []
    const rows = camGroupRows(shown, level)
    return [...rows.filter((r) => r.key !== ''), ...rows.filter((r) => r.key === '')]
  }, [shown, level])
  const spoolRows = useMemo(() => (level === 'spool' ? [...shown].sort((a, b) => a.seq - b.seq) : []), [shown, level])
  const rowCount = level === 'spool' ? spoolRows.length : groups.length
  const counted = level === 'spool' ? rowCount : groups.filter((r) => r.key !== '').length
  const pagination = useTablePagination(rowCount, `${projectId}|${level}|${scope.version}`)
  /** On a phone the row's name stays in view while the rest scrolls under it (MOB-01). */
  const pin = phone ? ('left' as const) : undefined

  const applyQuery = (search: string) => scope.apply({ search })
  const searchBox = (
    <Input
      allowClear
      aria-label="Tìm spool"
      placeholder="Tìm SpoolNo, LineNo"
      prefix={<SearchOutlined aria-hidden />}
      style={{ width: phone ? '100%' : 240 }}
      value={query}
      onChange={(e) => {
        const text = e.target.value
        setQuery(text)
        clearTimeout(queryTimer.current)
        // Cleared (its x, or emptied): at once. Typed: once the typing pauses.
        if (text === '') applyQuery(text)
        else queryTimer.current = setTimeout(() => applyQuery(text), SEARCH_DEBOUNCE_MS)
      }}
      onPressEnter={() => {
        clearTimeout(queryTimer.current)
        applyQuery(query)
      }}
    />
  )
  const selects = SELECTS.map((s) => (
    <Select<string>
      key={s.key}
      aria-label={s.label}
      {...searchSelectProps}
      {...fullOptionsProps}
      style={{ width: phone ? '100%' : s.width }}
      value={applied[s.key]}
      options={[{ value: ALL, label: `Tất cả ${s.label}` }, ...options[s.options].map((v) => ({ value: v, label: v }))]}
      onChange={(value) => scope.apply({ [s.key]: value })}
    />
  ))
  const offDefaults = SELECTS.filter((s) => applied[s.key] !== ALL).length

  const groupColumns = useMemo((): TableColumnsType<CamGroupRow> => [
    {
      title: level === 'line' ? 'LineNo' : 'Test Package No',
      key: 'key',
      fixed: pin,
      render: (_v, row) => textCell(row.key),
    },
    { title: 'Số spool', key: 'count', align: 'center', render: (_v, row) => formatQty(row.spools.length) },
    ...MILESTONES.map((m) => ({
      title: MILESTONE_LABEL[m],
      key: m,
      children: [
        {
          title: 'Hoàn thành',
          key: `${m}-done`,
          align: 'center' as const,
          render: (_v: unknown, row: CamGroupRow) => `${formatQty(row.counts[m].done)}/${formatQty(row.counts[m].total)}`,
        },
        { title: 'Plan', key: `${m}-plan`, align: 'center' as const, render: (_v: unknown, row: CamGroupRow) => groupDate(row, row.plan[m]) },
        { title: 'Actual', key: `${m}-actual`, align: 'center' as const, render: (_v: unknown, row: CamGroupRow) => groupDate(row, row.actual[m]) },
      ],
    })),
  ], [level, pin])

  const spoolColumns = useMemo((): TableColumnsType<Spool> => [
    { title: 'SpoolNo', key: 'spoolNo', fixed: pin, render: (_v, s) => textCell(s.spoolNo) },
    { title: 'LineNo', key: 'lineNo', render: (_v, s) => textCell(s.lineNo) },
    { title: 'InsuType', key: 'insuType', render: (_v, s) => textCell(s.insuType) },
    { title: 'DrawingNo', key: 'drawingNo', render: (_v, s) => textCell(s.drawingNo) },
    { title: 'Test Package No', key: 'testPackageNo', render: (_v, s) => textCell(s.testPackageNo) },
    { title: 'Painting System', key: 'paintingSystem', render: (_v, s) => textCell(s.paintingSystem) },
    ...columns.map((c) => ({
      title: c.label,
      key: `extra-${c.id}`,
      render: (_v: unknown, s: Spool) => textCell(s.extra[c.label]),
    })),
    ...MILESTONES.map((m) => ({
      title: MILESTONE_LABEL[m],
      key: m,
      children: [
        { title: 'Plan', key: `${m}-plan`, align: 'center' as const, render: (_v: unknown, s: Spool) => dateCell(s[PLAN_FIELD[m]]) },
        { title: 'Actual', key: `${m}-actual`, align: 'center' as const, render: (_v: unknown, s: Spool) => dateCell(s[ACTUAL_FIELD[m]]) },
      ],
    })),
    {
      title: 'Cảnh báo',
      key: 'flags',
      align: 'center' as const,
      render: (_v: unknown, s: Spool) => {
        const items = spoolFlagItems(flags.get(s.id) ?? { duplicate: false, planOrder: false, late: [] }, admin)
        if (items.length === 0) return MISSING
        return (
          <Space size={4} wrap style={{ justifyContent: 'center' }}>
            {items.map((f) => <StatusPill key={f.key} tone={f.tone}>{f.label}</StatusPill>)}
          </Space>
        )
      },
    },
    ...(rowActions
      ? [{
        title: 'Thao tác',
        key: 'actions',
        align: 'center' as const,
        fixed: 'right' as const,
        render: (_v: unknown, s: Spool) => rowActions(s),
      }]
      : []),
  ], [columns, flags, admin, rowActions, pin])

  /** The level select and the toolbar: in the header, or on a phone in a row of the body that wraps. */
  const controls = (
    <>
      <Select<CamLevel>
        aria-label="Cấp hiển thị"
        {...searchSelectProps}
        {...fullOptionsProps}
        style={phone ? PHONE_CONTROL : { width: 130 }}
        value={level}
        options={LEVELS}
        onChange={setLevel}
      />
      {toolbar}
    </>
  )

  const emptyText = spools.length === 0 ? 'Chưa có spool nào' : 'Không có spool phù hợp'

  return (
    <SectionCard
      title="Chi tiết"
      facts={[{ value: formatQty(counted), label: LEVEL_NOUN[level] }]}
      extra={phone ? undefined : <HeaderActions>{controls}</HeaderActions>}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {phone && <ControlRow>{controls}</ControlRow>}
        {phone
          ? <FilterSheet count={offDefaults} inline={searchBox} label="Lọc spool">{selects}</FilterSheet>
          : <FilterBar label="Lọc spool">{searchBox}{selects}</FilterBar>}
        <div data-testid="spool-detail">
          {level === 'spool'
            ? (
              <Table<Spool>
                rowKey="id"
                dataSource={spoolRows}
                columns={spoolColumns}
                pagination={pagination}
                scroll={{ x: 'max-content' }}
                locale={{ emptyText }}
              />
            )
            : (
              <Table<CamGroupRow>
                rowKey={(row) => `g:${row.key}`}
                dataSource={groups}
                columns={groupColumns}
                pagination={pagination}
                scroll={{ x: 'max-content' }}
                locale={{ emptyText }}
              />
            )}
        </div>
      </div>
    </SectionCard>
  )
}
