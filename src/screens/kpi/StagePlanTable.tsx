import { Button, DatePicker, InputNumber, Table, Tooltip } from 'antd'
import dayjs, { type Dayjs } from 'dayjs'
import { useState } from 'react'
import { EmptyState } from '../../components/EmptyState'
import { RulesDisclosure, type Rule } from '../../components/RulesDisclosure'
import { SectionCard } from '../../components/SectionCard'
import { tablePagination } from '../../components/tablePagination'
import { planDays, type StagePlan } from '../../domain/kpi'
import {
  DEFAULT_QUANTITY_LABEL, DEFAULT_UNIT, labelOfWorks, MIXED_QUANTITY_LABEL, unitOfWorks,
} from '../../domain/unit'
import { formatAreaM2 } from '../../lib/format'
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
  { id: 'RV5-23-override', text: 'Số anh gõ ghi đè phần tự tính, nút bỏ ghi đè cạnh ô đưa về số tự tính.' },
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
}) {
  /**
   * The heading names the quantity when every row's work agrees on it --
   * `Diện tích kế hoạch (m²)` -- and falls back to `Số lượng kế hoạch` with
   * the unit on each row when the works differ (RV6-35, RV6-36).
   */
  const quantities = rows.map((r) => ({
    quantityLabel: r.quantityLabel ?? DEFAULT_QUANTITY_LABEL, unit: r.unit ?? DEFAULT_UNIT,
  }))
  const sharedUnit = unitOfWorks(quantities)
  const sharedLabel = labelOfWorks(quantities)
  const areaTitle = sharedUnit === null
    ? `${MIXED_QUANTITY_LABEL} kế hoạch`
    : `${sharedLabel ?? MIXED_QUANTITY_LABEL} kế hoạch (${sharedUnit})`
  const rowUnit = (row: StagePlanRow) => (sharedUnit === null ? ` ${row.unit ?? DEFAULT_UNIT}` : '')

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
  const draft = (row: StagePlanRow): Draft => drafts[row.stageId] ?? draftOf(row)
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
  const errorOf = (d: Draft): string | null => {
    if (d.startDate !== null && d.endDate !== null && d.endDate < d.startDate) {
      // Date-only 'YYYY-MM-DD' strings compare correctly as strings.
      return 'Ngày kết thúc không được trước ngày bắt đầu.'
    }
    if (d.plannedAreaM2 !== null && !(d.plannedAreaM2 >= 0)) {
      return 'Diện tích kế hoạch không được âm.'
    }
    return null
  }

  const columns = [
    {
      title: 'Sàn',
      key: 'deck',
      width: 150,
      render: (_v: unknown, row: StagePlanRow) => (
        <span style={{ color: palette.textSecondary }}>{row.deckName}</span>
      ),
    },
    {
      title: 'Công việc',
      key: 'work',
      width: 130,
      render: (_v: unknown, row: StagePlanRow) => (
        <span style={{ color: palette.textSecondary }}>{row.workName}</span>
      ),
    },
    {
      title: 'Công đoạn',
      key: 'stage',
      // A floor, not a cap: `Blast + Coat 1` wraps once at most (QA F9).
      width: 140,
      render: (_v: unknown, row: StagePlanRow) => (
        <span style={type.body}>{row.stageName}</span>
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
      title: 'Khoảng kế hoạch',
      align: 'center' as const,
      key: 'window',
      width: 280,
      render: (_v: unknown, row: StagePlanRow) => {
        const d = draft(row)
        return (
          <DatePicker.RangePicker
            size="small"
            data-testid={`plan-range-${row.stageId}`}
            format="DD/MM/YYYY"
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
            : '—'
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
        const computed = d.startDate === null ? null : computedAreaFor(row, d.startDate)
        /*
          The computed figure lives in the placeholder and its tooltip, not on
          a line under the field (TBL-02). The helper line made this cell two
          lines tall while the picker and Lưu beside it stayed one, so the
          three controls of a row sat on three different axes. The
          placeholder says what the system will use while the field is empty;
          the tooltip keeps the figure readable once a value is typed over it.
          No placeholder at all while there is no figure to show.
        */
        const computedLabel = computed === null ? undefined : `Tự tính ${formatAreaM2(computed)}${rowUnit(row)}`
        return (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            <Tooltip title={computedLabel}>
              <InputNumber
                size="small"
                aria-label="Diện tích kế hoạch"
                placeholder={computedLabel}
                value={d.plannedAreaM2}
                disabled={saving}
                // Room for `Tự tính 99.999,99 m²` (R3-B): at 130 the
                // placeholder was cut to `Tự tính 2.880,0…`.
                style={{ width: 176 }}
                onChange={(n) => patch(row, { plannedAreaM2: n === null ? null : Number(n) })}
              />
            </Tooltip>
            {/* Always laid out, shown only on an override: the group is
                centred, so a button that appeared on the first keystroke
                re-centred it and moved the field under the caret. Hidden,
                it is out of the tab order and the accessibility tree. */}
            <span style={{ visibility: d.plannedAreaM2 !== null ? 'visible' : 'hidden' }}>
              <Tooltip title="Bỏ ghi đè, để hệ thống tự tính lại phần còn lại từ ngày bắt đầu">
                <Button
                  size="small"
                  aria-label="Về diện tích tự tính"
                  disabled={saving}
                  onClick={() => {
                    // Cleared locally as well as on the server, so the field
                    // shows the computed placeholder at once rather than
                    // waiting for a reload to catch up.
                    patch(row, { plannedAreaM2: null })
                    void onClearArea(row.stageId)
                  }}
                >
                  Tự tính
                </Button>
              </Tooltip>
            </span>
          </div>
        )
      },
    },
    {
      title: '',
      key: 'save',
      width: 120,
      // Pinned: the table scrolls sideways at tablet widths (QA F9) and a
      // row's Lưu must stay in view with the dates it saves.
      fixed: 'right' as const,
      align: 'center' as const,
      render: (_v: unknown, row: StagePlanRow) => {
        const d = draft(row)
        const message = errorOf(d)
        const ready = d.startDate !== null && d.endDate !== null && message === null
        return (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
            <Button
              size="small"
              type="primary"
              aria-label="Lưu kế hoạch"
              disabled={saving || !ready}
              onClick={() => {
                if (!ready) return
                void onSave(row, {
                  startDate: d.startDate as string,
                  endDate: d.endDate as string,
                  plannedAreaM2: d.plannedAreaM2,
                })
              }}
            >
              Lưu
            </Button>
            {message !== null && (
              <span style={{ ...type.caption, color: palette.error }}>{message}</span>
            )}
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
        pagination={tablePagination(rows.length)}
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
