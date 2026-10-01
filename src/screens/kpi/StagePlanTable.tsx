import { DatePicker, InputNumber, Table, Tooltip } from 'antd'
import dayjs, { type Dayjs } from 'dayjs'
import { useState } from 'react'
import { EmptyState } from '../../components/EmptyState'
import { IconAction } from '../../components/IconAction'
import { RulesDisclosure, type Rule } from '../../components/RulesDisclosure'
import { SectionCard } from '../../components/SectionCard'
import { useTablePagination, type PaginationResetKey } from '../../components/tablePagination'
import { viAreaInputProps } from '../../components/viNumberInput'
import { planDays, type StagePlan } from '../../domain/kpi'
import { DEFAULT_UNIT, unitOfWorks } from '../../domain/unit'
import { MISSING, formatAreaM2 } from '../../lib/format'
import { palette, type } from '../../theme'

/**
 * Kế hoạch KPI — the admin picks one date range per coat, and may override the
 * area the system worked out for it.
 *
 * Feedback Rv5 item 9, rules RV5-22, RV5-23, RV5-28 and RV5-38. Presentational: the
 * rows, the computed areas and the two writes all come in as props, the same
 * contract `ProductivityDashboard` has, so this file holds the entry rules and
 * nothing about where a plan is stored.
 */

/**
 * Helper text, one sentence each, checked against the code (RUL-01). The flat
 * daily split (RV5-24) is the first entry's; who may enter a plan (RV5-28) is
 * left out, since only an admin ever sees this table.
 */
const RULES: Rule[] = [
  { id: 'RV5-22', text: 'Kế hoạch chia đều cho mọi ngày từ ngày bắt đầu đến ngày kết thúc, kể cả chủ nhật và ngày lễ.' },
  { id: 'RV5-23', text: 'Để trống diện tích kế hoạch thì hệ thống tự tính phần còn lại của công đoạn từ ngày bắt đầu.' },
  { id: 'RV5-23-override', text: 'Số anh gõ ghi đè diện tích tự tính cho tới khi bấm Tự động tính cạnh Lưu.' },
  { id: 'RV5-23-zero', text: 'Gõ 0 nghĩa là không có diện tích kế hoạch, khác với để trống.' },
]

/** One coat of the project, with the window the admin has typed for it so far. */
export interface StagePlanRow {
  /** `deck_stages.id` — the key `stage_plans` is keyed on. */
  stageId: string
  /** Carried through to the write: `stage_plans` denormalises both. */
  workId: string
  deckId: string
  workName: string
  deckName: string
  stageName: string
  /** The stored window, or null when this coat has no plan yet. */
  plan: StagePlan | null
  /** The coat's work's quantity and unit (RV6-35). Absent reads as Diện tích / m². */
  quantityLabel?: string
  unit?: string
}

/** The window as the admin has it on screen right now. */
export interface StagePlanWindow {
  startDate: string
  endDate: string
  /** Null: leave it to the system (RV5-23). Never confused with 0. */
  plannedAreaM2: number | null
}

/** The draft of one row. Dates are null until the admin picks them. */
interface Draft {
  startDate: string | null
  endDate: string | null
  plannedAreaM2: number | null
}

const draftOf = (row: StagePlanRow): Draft => ({
  startDate: row.plan?.startDate ?? null,
  endDate: row.plan?.endDate ?? null,
  plannedAreaM2: row.plan?.plannedAreaM2 ?? null,
})

/**
 * A `Dayjs` back to the date-only string the column stores.
 *
 * `format('YYYY-MM-DD')` and never `toISOString()`: the picker's value is a
 * local midnight, and an ISO string would shift it a day west of UTC. The same
 * reason `Zone.startDate` and `work_decks.deadline` are date-only strings
 * throughout this app rather than Dates.
 */
const dateKey = (d: Dayjs | null): string | null => (d === null ? null : d.format('YYYY-MM-DD'))

export function StagePlanTable({
  rows,
  computedAreaFor,
  onSave,
  onClearArea,
  saving = false,
  scopeKey = null,
}: {
  rows: StagePlanRow[]
  /**
   * What the system computes as remaining for this coat on `startDate`
   * (RV5-23). A function and not a number, because the answer moves with the
   * date the admin is typing: the figure is the deck's state AS OF that day.
   */
  computedAreaFor: (row: StagePlanRow, startDate: string | null) => number
  onSave: (row: StagePlanRow, window: StagePlanWindow) => void | Promise<void>
  onClearArea: (stageId: string) => void | Promise<void>
  saving?: boolean
  /**
   * What the rows are of: the project. When it changes the pager goes back
   * to page 1 and the drafts typed under the scope before are dropped (M10,
   * UI-05).
   */
  scopeKey?: PaginationResetKey
}) {
  /**
   * The column is Diện tích (AD18), with the unit when every row's work
   * shares one (RV6-35); with mixed units each row's Tự động tính tooltip
   * names its own (RV6-36).
   */
  const sharedUnit = unitOfWorks(rows.map((r) => ({ unit: r.unit ?? DEFAULT_UNIT })))
  const areaTitle = sharedUnit === null ? 'Diện tích' : `Diện tích (${sharedUnit})`

  /**
   * Drafts by stage id, holding only the rows the admin has touched.
   *
   * Sparse on purpose: an untouched row reads straight off its prop, so a
   * reload that brings new plans in is reflected immediately instead of being
   * shadowed by a stale copy taken at mount. That was the defect behind Rv4's
   * "không sửa được" on the zone dialog -- it held a snapshot and went on
   * showing the old dates after the write landed.
   */
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  // Dropped on a new scope, during render rather than in an effect (React's
  // "state from the previous render" pattern), so no frame shows them (M10).
  const [draftScope, setDraftScope] = useState(scopeKey)
  if (scopeKey !== draftScope) {
    setDraftScope(scopeKey)
    setDrafts({})
  }
  const pagination = useTablePagination(rows.length, scopeKey)
  const draft = (row: StagePlanRow): Draft => drafts[row.stageId] ?? draftOf(row)
  /** Whether the row on screen differs from what is stored: Lưu has something to write (M10). */
  const dirty = (row: StagePlanRow): boolean => {
    const d = drafts[row.stageId]
    if (d === undefined) return false
    const s = draftOf(row)
    return d.startDate !== s.startDate || d.endDate !== s.endDate || d.plannedAreaM2 !== s.plannedAreaM2
  }
  const patch = (row: StagePlanRow, over: Partial<Draft>) =>
    setDrafts((d) => ({ ...d, [row.stageId]: { ...draft(row), ...over } }))

  /**
   * The one message this row is refused for, or null.
   *
   * The ordering check stays, against RV5-40's expectation that a RangePicker
   * makes it unreachable. Measured against antd 5.29: the calendar panel does
   * disable a date that would invert the range, but a date TYPED into the end
   * box is reported by `onCalendarChange` exactly as typed -- `01/08/2026`
   * against a start of `01/09/2026` reaches this draft -- and typing is how an
   * admin on a laptop uses this control. `stage_plans_window` in 0033 is the
   * real guard; this is what keeps the admin from meeting it as a raw write
   * failure.
   */
  const DATE_ERROR = 'Ngày kết thúc không được trước ngày bắt đầu.'
  const AREA_ERROR = 'Diện tích kế hoạch không được âm.'
  // Date-only 'YYYY-MM-DD' strings compare correctly as strings.
  const datesWrong = (d: Draft) => d.startDate !== null && d.endDate !== null && d.endDate < d.startDate
  const areaWrong = (d: Draft) => d.plannedAreaM2 !== null && !(d.plannedAreaM2 >= 0)
  const errorOf = (d: Draft): string | null => (datesWrong(d) ? DATE_ERROR : areaWrong(d) ? AREA_ERROR : null)

  const columns = [
    {
      title: 'Sàn',
      key: 'deck',
      width: 150,
      render: (_v: unknown, row: StagePlanRow) => (
        // Sàn, Công việc, Công đoạn: three names, one class, one colour (AD5, UI-06).
        <span style={{ ...type.body, color: palette.text }}>{row.deckName}</span>
      ),
    },
    {
      title: 'Công việc',
      key: 'work',
      width: 130,
      render: (_v: unknown, row: StagePlanRow) => (
        <span style={{ ...type.body, color: palette.text }}>{row.workName}</span>
      ),
    },
    {
      title: 'Công đoạn',
      key: 'stage',
      // A floor, not a cap: `Blast + Coat 1` wraps once at most (QA F9).
      width: 140,
      render: (_v: unknown, row: StagePlanRow) => (
        <span style={{ ...type.body, color: palette.text }}>{row.stageName}</span>
      ),
    },
    {
      /*
        One RangePicker per coat, not two DatePickers (RV5-38). The app already
        had a settled answer for a per-coat date range and this table did not
        use it: `DeckProgressPanel.tsx:582` -- "One RangePicker per coat writes
        both ends at once" -- used for the zone plan dates, which is the closest
        analogue to a KPI window, and the Năng suất filter uses one too. Plan D
        said "antd DatePicker" and named the wrong component; the owner asked
        why this screen had two fields, and it should not have.

        `onCalendarChange` and not `onChange`, matching that precedent: it
        reports each end as it is picked, so `Số ngày` recounts while the admin
        is still choosing and a half-typed window is visible rather than
        swallowed. `onChange` fires only on a complete, valid submit, which
        would leave the admin editing one end of a stored window with nothing
        happening at all.

        `allowEmpty` both ways so a half-picked range stays on screen. Storing
        one is a different matter: `stage_plans.start_date` and `end_date` are
        NOT NULL, so `Lưu` below stays disabled until both ends are set
        (RV5-39). Unlike a zone, whose finish may legitimately be unknown, a
        KPI window with one end is not a plan.
      */
      title: 'Dự kiến triển khai',
      align: 'center' as const,
      key: 'window',
      width: 280,
      render: (_v: unknown, row: StagePlanRow) => {
        const d = draft(row)
        // The refusal is the picker's own: its error status and its tooltip,
        // never a caption that makes the row two lines tall (M10, TBL-02).
        return (
          <Tooltip title={datesWrong(d) ? DATE_ERROR : undefined}>
            <DatePicker.RangePicker
              data-testid={`plan-range-${row.stageId}`}
              format="DD/MM/YYYY"
              status={datesWrong(d) ? 'error' : undefined}
              // Room for `DD/MM/YYYY → DD/MM/YYYY` (QA F9): squeezed, the
              // picker cut the year off both ends.
              style={{ minWidth: 250 }}
              allowEmpty={[true, true]}
              placeholder={['Bắt đầu', 'Kết thúc']}
              disabled={saving}
              value={[d.startDate ? dayjs(d.startDate) : null, d.endDate ? dayjs(d.endDate) : null]}
              onCalendarChange={(v) => {
                const range = v as [Dayjs | null, Dayjs | null] | null
                patch(row, {
                  startDate: dateKey(range?.[0] ?? null),
                  endDate: dateKey(range?.[1] ?? null),
                })
              }}
            />
          </Tooltip>
        )
      },
    },
    {
      title: 'Số ngày',
      key: 'days',
      width: 90,
      align: 'center' as const,
      render: (_v: unknown, row: StagePlanRow) => {
        const d = draft(row)
        const shown =
          d.startDate !== null && d.endDate !== null && errorOf(d) === null
            // `planDays` and not a subtraction here, so Số ngày on screen and
            // the divisor the chart uses cannot drift apart.
            ? String(planDays({ startDate: d.startDate, endDate: d.endDate }))
            : MISSING
        return (
          <span data-testid={`plan-days-${row.stageId}`} style={type.body}>
            {shown}
          </span>
        )
      },
    },
    {
      title: areaTitle,
      align: 'center' as const,
      key: 'area',
      width: 240,
      render: (_v: unknown, row: StagePlanRow) => {
        const d = draft(row)
        /*
          Null: there is no figure, as opposed to a figure of zero.

          The computed area is what remains ON the start date (RV5-23), so with
          no start date there is nothing to compute from -- `computedAreaFor`
          returns 0 there as a sentinel, and `Tự tính: 0,00` on screen read as
          though the system had worked the coat out and found nothing left. A
          coat that genuinely has nothing left still computes 0,00 and still
          says so, so the branch turns on the DATE and never on the value.
        */
        /*
          No placeholder (AD18): an empty field means the automatic figure,
          which Tự động tính's tooltip names, beside Lưu. The field takes the
          column's width; no slot is kept beside it any more.
        */
        return (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Tooltip title={areaWrong(d) ? AREA_ERROR : undefined}>
              <InputNumber
                aria-label="Diện tích kế hoạch"
                status={areaWrong(d) ? 'error' : undefined}
                value={d.plannedAreaM2}
                disabled={saving}
                style={{ width: '100%' }}
                // "1.234,5" m², not 1.2345, and "8.000" as eight thousand:
                // see viNumberInput for the rule.
                {...viAreaInputProps}
                onChange={(n) => patch(row, { plannedAreaM2: n === null ? null : Number(n) })}
              />
            </Tooltip>
          </div>
        )
      },
    },
    {
      title: 'Thao tác',
      key: 'save',
      width: 130,
      // Pinned: the table scrolls sideways at tablet widths (QA F9) and a
      // row's Lưu must stay in view with the dates it saves.
      fixed: 'right' as const,
      align: 'center' as const,
      render: (_v: unknown, row: StagePlanRow) => {
        const d = draft(row)
        // Complete, valid, and changed: an untouched row has nothing to write (M10).
        const ready = d.startDate !== null && d.endDate !== null && errorOf(d) === null && dirty(row)
        /*
          Null: there is no figure, as opposed to a figure of zero. The
          computed area is what remains ON the start date (RV5-23), so with no
          start date there is nothing to compute from -- `computedAreaFor`
          returns 0 there as a sentinel. A coat with genuinely nothing left
          still names 0,00, so the branch turns on the DATE, not the value.
        */
        const computed = d.startDate === null ? null : computedAreaFor(row, d.startDate)
        const autoTip = computed === null
          ? 'Tự động tính'
          : `Tự động tính · ${formatAreaM2(computed)} ${row.unit ?? DEFAULT_UNIT}`
        return (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            {/* One fixed slot on every row (AD18), disabled with its tooltip
                while the row has no override; enabled, it resets the override,
                locally at once and on the server. */}
            <IconAction
              verb="recompute"
              label="Tự động tính"
              tooltip={autoTip}
              disabled={saving || d.plannedAreaM2 === null}
              onClick={() => {
                patch(row, { plannedAreaM2: null })
                void onClearArea(row.stageId)
              }}
            />
            <IconAction
              verb="save"
              label="Lưu"
              type="primary"
              disabled={saving || !ready}
              onClick={() => {
                if (!ready) return
                void onSave(row, {
                  startDate: d.startDate as string,
                  endDate: d.endDate as string,
                  plannedAreaM2: d.plannedAreaM2,
                })
              }}
            />
          </div>
        )
      },
    },
  ]

  return (
    <SectionCard
      title="Kế hoạch KPI theo công đoạn"
      facts={[
        { value: rows.length, label: 'công đoạn' },
        { value: rows.filter((r) => r.plan !== null).length, label: 'đã có kế hoạch' },
      ]}
      bodyPadding={0}
      footer={<RulesDisclosure rules={RULES} />}
    >
      <Table<StagePlanRow>
        rowKey="stageId"
        size="middle"
        dataSource={rows}
        pagination={pagination}
        // `max-content`, not `true` (QA F9): with `true` antd lets the table
        // shrink to the card and the column widths become hints, which is how
        // the picker lost its years and "Số ngày" wrapped at 1024px. Sized to
        // its content, the card scrolls sideways and every column keeps the
        // width it asked for.
        scroll={{ x: 'max-content' }}
        onRow={(row) => ({ 'data-testid': `plan-row-${row.stageId}` } as React.HTMLAttributes<HTMLElement>)}
        locale={{
          emptyText: (
            <EmptyState
              title="Dự án chưa có công đoạn nào"
              description="Thêm công việc và công đoạn cho sàn trước, rồi quay lại đây."
            />
          ),
        }}
        columns={columns}
      />
    </SectionCard>
  )
}
