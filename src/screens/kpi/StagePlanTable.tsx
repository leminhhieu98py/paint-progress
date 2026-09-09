import { Button, DatePicker, InputNumber, Table, Tooltip } from 'antd'
import dayjs, { type Dayjs } from 'dayjs'
import { useState } from 'react'
import { EmptyState } from '../../components/EmptyState'
import { RulesDisclosure, type Rule } from '../../components/RulesDisclosure'
import { SectionCard } from '../../components/SectionCard'
import { planDays, type StagePlan } from '../../domain/kpi'
import { formatAreaM2 } from '../../lib/format'
import { palette } from '../../theme'

/**
 * Kế hoạch KPI — the admin types a start and an end date per coat, and may
 * override the area the system worked out for it.
 *
 * Feedback Rv5 item 9, rules RV5-22, RV5-23 and RV5-28. Presentational: the
 * rows, the computed areas and the two writes all come in as props, the same
 * contract `ProductivityDashboard` has, so this file holds the entry rules and
 * nothing about where a plan is stored.
 */

const RULES: Rule[] = [
  { id: 'RV5-22', text: 'Số ngày = ngày kết thúc − ngày bắt đầu + 1, tính cả hai đầu. Chia đều cho mọi ngày, không trừ chủ nhật hay ngày lễ.' },
  { id: 'RV5-23', text: 'Để trống diện tích kế hoạch thì hệ thống tự tính phần còn lại của công đoạn tính từ ngày bắt đầu. Anh gõ số vào là ghi đè, và hệ thống không tự tính lại nữa. Bấm "Về diện tích tự tính" để bỏ ghi đè.' },
  { id: 'RV5-23', text: 'Gõ số 0 là ghi đè "không có diện tích kế hoạch", khác với để trống.' },
  { id: 'RV5-24', text: 'Kế hoạch phẳng: mỗi ngày trong khoảng đều nhận cùng một số m² = diện tích kế hoạch ÷ số ngày.' },
  { id: 'RV5-28', text: 'Chỉ admin nhập được ngày kế hoạch. Giám sát và người xem đều đọc được biểu đồ KPI.' },
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

  /** The one message this row is refused for, or null. */
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
      render: (_v: unknown, row: StagePlanRow) => (
        <span style={{ fontWeight: 600 }}>{row.stageName}</span>
      ),
    },
    {
      title: 'Ngày bắt đầu',
      key: 'start',
      width: 160,
      render: (_v: unknown, row: StagePlanRow) => (
        <DatePicker
          aria-label="Ngày bắt đầu"
          placeholder="Bắt đầu"
          format="DD/MM/YYYY"
          allowClear
          disabled={saving}
          value={draft(row).startDate ? dayjs(draft(row).startDate) : null}
          onChange={(v) => patch(row, { startDate: dateKey(v) })}
        />
      ),
    },
    {
      title: 'Ngày kết thúc',
      key: 'end',
      width: 160,
      render: (_v: unknown, row: StagePlanRow) => (
        <DatePicker
          aria-label="Ngày kết thúc"
          placeholder="Kết thúc"
          format="DD/MM/YYYY"
          allowClear
          disabled={saving}
          value={draft(row).endDate ? dayjs(draft(row).endDate) : null}
          onChange={(v) => patch(row, { endDate: dateKey(v) })}
        />
      ),
    },
    {
      title: 'Số ngày',
      key: 'days',
      width: 90,
      render: (_v: unknown, row: StagePlanRow) => {
        const d = draft(row)
        const shown =
          d.startDate !== null && d.endDate !== null && errorOf(d) === null
            // `planDays` and not a subtraction here, so Số ngày on screen and
            // the divisor the chart uses cannot drift apart.
            ? String(planDays({ startDate: d.startDate, endDate: d.endDate }))
            : '—'
        return (
          <span data-testid={`plan-days-${row.stageId}`} style={{ fontWeight: 600 }}>
            {shown}
          </span>
        )
      },
    },
    {
      title: 'Diện tích kế hoạch (m²)',
      key: 'area',
      width: 220,
      render: (_v: unknown, row: StagePlanRow) => {
        const d = draft(row)
        const computed = computedAreaFor(row, d.startDate)
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <InputNumber
                aria-label="Diện tích kế hoạch"
                // The computed figure as the placeholder, so an empty field
                // shows what the system will use instead of showing nothing.
                placeholder={formatAreaM2(computed)}
                value={d.plannedAreaM2}
                disabled={saving}
                style={{ width: 130 }}
                onChange={(n) => patch(row, { plannedAreaM2: n === null ? null : Number(n) })}
              />
              {d.plannedAreaM2 !== null && (
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
              )}
            </div>
            <span
              data-testid={`plan-computed-${row.stageId}`}
              style={{ fontSize: 12, color: palette.textQuaternary }}
            >
              {`Tự tính: ${formatAreaM2(computed)}`}
            </span>
          </div>
        )
      },
    },
    {
      title: '',
      key: 'save',
      width: 120,
      render: (_v: unknown, row: StagePlanRow) => {
        const d = draft(row)
        const message = errorOf(d)
        const ready = d.startDate !== null && d.endDate !== null && message === null
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
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
              <span style={{ fontSize: 12, color: palette.error }}>{message}</span>
            )}
          </div>
        )
      },
    },
  ]

  return (
    <SectionCard
      title="Kế hoạch KPI theo công đoạn"
      summary={`${rows.length} công đoạn · ${rows.filter((r) => r.plan !== null).length} đã có kế hoạch`}
      bodyPadding={0}
      footer={<RulesDisclosure rules={RULES} />}
    >
      <Table<StagePlanRow>
        className="pp-table"
        rowKey="stageId"
        size="middle"
        dataSource={rows}
        pagination={false}
        scroll={{ x: true }}
        onRow={(row) => ({ 'data-testid': `plan-row-${row.stageId}` } as React.HTMLAttributes<HTMLElement>)}
        locale={{
          emptyText: (
            <EmptyState
              title="Dự án chưa có công đoạn nào"
              description="Kế hoạch KPI được nhập theo từng công đoạn của từng sàn. Thêm công việc và công đoạn cho sàn trước, rồi quay lại đây."
            />
          ),
        }}
        columns={columns}
      />
    </SectionCard>
  )
}
