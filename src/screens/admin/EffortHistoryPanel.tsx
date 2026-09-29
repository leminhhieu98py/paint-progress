import {
  Alert, App, Button, Input, InputNumber, Modal, Select, Space, Switch, Table, Tooltip, Typography,
} from 'antd'
import { useEffect, useMemo, useState } from 'react'
import { SectionCard } from '../../components/SectionCard'
import { modalProps } from '../../components/modalChrome'
import { searchSelectProps } from '../../components/searchSelect'
import { useTablePagination } from '../../components/tablePagination'
import { effortCoverage, WASTE_REASONS, wasteReasonLabel } from '../../domain/effort'
import { type DeckEvent, type Effort } from '../../domain/types'
import { listGsUsers } from '../../lib/adminApi'
import { listEmployees } from '../../lib/employeesApi'
import { listCoworkerNames } from '../../lib/gsApi'
import { MISSING, formatDateTimeVN, formatHours } from '../../lib/format'
import { setCellEventEffort } from '../../lib/progressApi'
import { palette, space, type } from '../../theme'

/**
 * Every stage change on the deck with the effort recorded against it, and --
 * in Sửa mode -- a way to fill in the ones that have none (Feedback Rv2, item
 * 11; Linh: "Các bản ghi cũ không có giờ công. Admin có thể nhập bổ sung hoặc
 * bỏ trống").
 *
 * A table of EVENTS, not the note thread on the progress panel: the thread
 * drops events without a note, and the rows that need hours are exactly the
 * ones nobody wrote anything on. Newest first, because the rows an admin
 * comes here to fix are the ones from this week.
 */

const hours = (n: number | null) => (n === null ? MISSING : formatHours(n))
/** Typed text, or the missing mark for an empty one (I7). */
const text = (v: string | null) => (v === null || v.trim() === '' ? MISSING : v)

const fieldLabel = { display: 'block', marginBottom: 4, ...type.label } as const

export function EffortHistoryPanel({
  deckId,
  editable,
  events,
  error,
  onRetry,
  onSaved,
}: {
  /** The deck the events are of: the scope the pager pages, so a new deck starts at page 1. */
  deckId: string
  editable: boolean
  /**
   * Every stage change on the deck, OLDEST first, as the API returns them.
   * Null while loading. Handed in by the screen rather than read here: the
   * forecast panel beside this one needs the same rows, and a deck like Main
   * Deck carries over a thousand of them.
   */
  events: DeckEvent[] | null
  error: string | null
  onRetry: () => void
  /** Re-read the events after a backfill lands. */
  onSaved: () => void
}) {
  const { message } = App.useApp()
  const [names, setNames] = useState<Record<string, string>>({})
  const [onlyMissing, setOnlyMissing] = useState(false)
  const [editing, setEditing] = useState<DeckEvent | null>(null)
  const [draft, setDraft] = useState<Effort | null>(null)
  const [saving, setSaving] = useState(false)
  /**
   * The roster the crew names are picked from, active names only, as on the
   * GS's cell dialog (M21): a typed name the dashboard then groups apart is
   * how "Tổ 1" and "Tổ 01" became two crews. Its failure is not fatal: the
   * row's own names stay on offer.
   */
  const [roster, setRoster] = useState<string[]>([])
  useEffect(() => {
    let cancelled = false
    listEmployees()
      .then((rows) => { if (!cancelled) setRoster(rows.map((e) => e.fullName)) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])
  /** The roster, and the row's current name when it is not on it, marked (M21). */
  const crewOptions = (current: string) => [
    ...roster.map((name) => ({ value: name, label: name })),
    ...(current !== '' && !roster.includes(current)
      ? [{ value: current, label: `${current} (ghi tự do cũ)` }]
      : []),
  ]

  useEffect(() => {
    let cancelled = false
    // Two name sources, neither fatal: listGsUsers for the field accounts,
    // hidden ones included (a bay ticked last month by someone since hidden is
    // still theirs), and coworker_names for the admins, who tick bays too and
    // are not in the GS list. An id nobody resolves is printed as is.
    Promise.all([
      listGsUsers(true).catch(() => []),
      listCoworkerNames().catch(() => ({}) as Record<string, string>),
    ])
      .then(([users, admins]) => {
        if (cancelled) return
        setNames({ ...admins, ...Object.fromEntries(users.map((u) => [u.id, u.fullName])) })
      })
    return () => {
      cancelled = true
    }
  }, [])

  /** Newest first: the rows an admin comes here to fix are this week's. */
  const shown = useMemo(() => {
    if (events === null) return []
    const newestFirst = [...events].reverse()
    return onlyMissing ? newestFirst.filter((ev) => ev.effort.workHours === null) : newestFirst
  }, [events, onlyMissing])
  const pagination = useTablePagination(shown.length, `${deckId}|${onlyMissing}`)

  const coverage = effortCoverage(events ?? [])

  const openEdit = (ev: DeckEvent) => {
    setEditing(ev)
    setDraft({ ...ev.effort })
  }
  const closeEdit = () => {
    setEditing(null)
    setDraft(null)
  }
  const save = async () => {
    if (!editing || !draft) return
    setSaving(true)
    try {
      await setCellEventEffort(
        editing.id,
        (draft.wasteHours ?? 0) > 0 ? draft : { ...draft, wasteReason: '', wasteOrder: '' },
      )
      message.success('Đã lưu giờ công')
      closeEdit()
      onSaved()
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  /** Who backfilled this update's hours, and when; nothing on one never edited. */
  const editedMark = (ev: DeckEvent) => ev.effortEditedAt && (
    <Tooltip title={`Sửa bởi ${ev.effortEditedByName ?? 'quản trị viên'} lúc ${formatDateTimeVN(ev.effortEditedAt)}`}>
      <Typography.Text type="secondary" style={type.caption}>đã sửa</Typography.Text>
    </Tooltip>
  )

  return (
    <SectionCard
      code="A3.7"
      title="Giờ công theo lần cập nhật"
      facts={events === null ? undefined : [{
        value: `${coverage.withHours} / ${coverage.total}`,
        // The same words as Năng suất's coverage fact.
        label: 'lần cập nhật có ghi giờ công',
        // Missing hours are a data-quality warning (HLT-01).
        ...(coverage.withHours < coverage.total
          ? { tone: 'warning' as const, info: 'Các lần chưa ghi không tính vào hiệu suất.' }
          : {}),
      }]}
      // Flush, as every list card is: the table's edge columns carry the
      // card's inset (LAY-01) rather than sitting a cell's padding inboard.
      bodyPadding={0}
      extra={(
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, ...type.body, color: palette.textTertiary }}>
          <Switch size="small" checked={onlyMissing} onChange={setOnlyMissing} />
          Chỉ hiện lần chưa có giờ công
        </label>
      )}
    >
      {error && (
        <div style={{ padding: `${space.lg}px ${space.xl}px 0` }}>
          <Alert
            type="error"
            showIcon
            message="Không tải được lịch sử cập nhật"
            description={error}
            action={<Button onClick={onRetry}>Thử lại</Button>}
            style={{ marginBottom: space.md }}
          />
        </div>
      )}
      <Table<DeckEvent>
        size="small"
        rowKey="id"
        loading={events === null && !error}
        dataSource={shown}
        pagination={pagination}
        // Eleven columns: sideways, never a name squeezed to a word per line (I3, MOB-01).
        scroll={{ x: 'max-content' }}
        locale={{ emptyText: onlyMissing ? 'Mọi lần cập nhật đã có giờ công' : 'Sàn này chưa có lần cập nhật nào' }}
        columns={[
          { title: 'Mã ô', dataIndex: 'cellCode', width: 80 },
          { title: 'Công việc', dataIndex: 'workName', width: 120, render: (v: string | null) => text(v) },
          { title: 'Công đoạn', dataIndex: 'toStageName', width: 140, render: (v: string | null) => v ?? 'Chưa bắt đầu' },
          { title: 'Cập nhật lúc', dataIndex: 'at', width: 160, render: (v: string) => formatDateTimeVN(v), align: 'center' },
          { title: 'Bởi', dataIndex: 'byId', width: 140, render: (v: string | null) => (v === null ? MISSING : names[v] ?? v) },
          { title: 'Nhóm trưởng', width: 180, render: (_, ev) => text(ev.effort.leadName) },
          { title: 'Thợ chính', width: 180, render: (_, ev) => text(ev.effort.painterName) },
          {
            title: 'Giờ công',
            align: 'center',
            width: 90,
            // Outside Sửa there is no Thao tác column (R3): the edit marker sits by the hours it is about.
            render: (_, ev) => (editable || !ev.effortEditedAt ? hours(ev.effort.workHours) : (
              <Space size={4}>
                {hours(ev.effort.workHours)}
                {editedMark(ev)}
              </Space>
            )),
          },
          { title: 'Giờ hao phí', align: 'center', width: 100, render: (_, ev) => hours(ev.effort.wasteHours) },
          // A note, not a category (UI-04 amended): plain text, left like every note (UI-03).
          { title: 'Lý do hao phí', width: 220, render: (_, ev) => text(ev.effort.wasteReason) },
          { title: 'Lệnh sản xuất', width: 130, render: (_, ev) => text(ev.effort.wasteOrder) },
          // In Sửa only: in view mode it was an empty pinned 90 px (R3).
          ...(editable ? [{
            title: 'Thao tác',
            width: 90,
            align: 'center' as const,
            fixed: 'right' as const,
            render: (_: unknown, ev: DeckEvent) => (
              <Space size={4}>
                {editedMark(ev)}
                <Button size="small" onClick={() => openEdit(ev)}>Sửa</Button>
              </Space>
            ),
          }] : []),
        ]}
      />

      <Modal
        open={editing !== null}
        title={editing ? `Giờ công · Ô ${editing.cellCode} · ${editing.toStageName ?? 'Chưa bắt đầu'}` : ''}
        onCancel={closeEdit}
        onOk={() => void save()}
        okText="Lưu"
        cancelText="Huỷ"
        okButtonProps={{ loading: saving }}
        {...modalProps}
      >
        {draft && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 12px' }}>
            <div>
              <label htmlFor="effort-lead" style={fieldLabel}>Nhóm trưởng</label>
              <Select
                id="effort-lead"
                aria-label="Nhóm trưởng"
                {...searchSelectProps}
                allowClear
                style={{ width: '100%' }}
                placeholder="Gõ để tìm tên"
                value={draft.leadName === '' ? undefined : draft.leadName}
                onChange={(v) => setDraft({ ...draft, leadName: v ?? '' })}
                options={crewOptions(draft.leadName)}
              />
            </div>
            <div>
              <label htmlFor="effort-painter" style={fieldLabel}>Thợ chính</label>
              <Select
                id="effort-painter"
                aria-label="Thợ chính"
                {...searchSelectProps}
                allowClear
                style={{ width: '100%' }}
                placeholder="Gõ để tìm tên"
                value={draft.painterName === '' ? undefined : draft.painterName}
                onChange={(v) => setDraft({ ...draft, painterName: v ?? '' })}
                options={crewOptions(draft.painterName)}
              />
            </div>
            <div>
              <label htmlFor="effort-work-hours" style={fieldLabel}>Số giờ công (Mhr)</label>
              <InputNumber
                id="effort-work-hours"
                min={0}
                step={0.5}
                style={{ width: '100%' }}
                value={draft.workHours}
                onChange={(v) => setDraft({ ...draft, workHours: v === null || v === undefined ? null : Number(v) })}
              />
            </div>
            <div>
              <label htmlFor="effort-waste-hours" style={fieldLabel}>Giờ hao phí (Mhr)</label>
              <InputNumber
                id="effort-waste-hours"
                min={0}
                step={0.5}
                style={{ width: '100%' }}
                value={draft.wasteHours}
                onChange={(v) => setDraft({ ...draft, wasteHours: v === null || v === undefined ? null : Number(v) })}
              />
            </div>
            {(draft.wasteHours ?? 0) > 0 && (
              <>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label htmlFor="effort-waste-order" style={fieldLabel}>Lệnh sản xuất hao phí</label>
                  <Input
                    id="effort-waste-order"
                    value={draft.wasteOrder}
                    onChange={(e) => setDraft({ ...draft, wasteOrder: e.target.value })}
                    placeholder="Số lệnh sản xuất"
                  />
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label htmlFor="effort-waste-reason" style={fieldLabel}>Lý do hao phí</label>
                  {/*
                    The same fixed list the foreman picks from (Feedback Rv4),
                    so a backfilled row groups with the recorded ones on the
                    dashboard instead of becoming a category of its own. A row
                    that already carries free text from before keeps it: the
                    Select shows it as its current value.
                  */}
                  <Select
                    id="effort-waste-reason"
                    aria-label="Lý do hao phí"
                    {...searchSelectProps}
                    allowClear
                    style={{ width: '100%' }}
                    placeholder="Chọn lý do"
                    value={draft.wasteReason === '' ? undefined : draft.wasteReason}
                    onChange={(v) => setDraft({ ...draft, wasteReason: v ?? '' })}
                    options={[
                      ...WASTE_REASONS.map((r) => ({
                        value: wasteReasonLabel(r), label: wasteReasonLabel(r),
                      })),
                      // Whatever this row already says, when it is not on the
                      // list: a value the Select cannot offer is a value it
                      // would silently blank on save.
                      ...(draft.wasteReason !== ''
                        && !WASTE_REASONS.some((r) => wasteReasonLabel(r) === draft.wasteReason)
                        ? [{ value: draft.wasteReason, label: `${draft.wasteReason} (ghi tự do cũ)` }]
                        : []),
                    ]}
                  />
                </div>
              </>
            )}
          </div>
        )}
      </Modal>
    </SectionCard>
  )
}
