import { Alert, App, Button, Input, InputNumber, Modal, Space, Switch, Table, Tooltip, Typography } from 'antd'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { SectionCard } from '../../components/SectionCard'
import { modalProps } from '../../components/modalChrome'
import { effortCoverage } from '../../domain/effort'
import { type DeckEvent, type Effort } from '../../domain/types'
import { listGsUsers } from '../../lib/adminApi'
import { formatDateTimeVN } from '../../lib/format'
import { listDeckEvents, setCellEventEffort } from '../../lib/progressApi'
import { palette } from '../../theme'

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

const HOURS = new Intl.NumberFormat('vi-VN', { minimumFractionDigits: 1, maximumFractionDigits: 2 })
const hours = (n: number | null) => (n === null ? '' : HOURS.format(n))

const fieldLabel = { display: 'block', marginBottom: 4, fontSize: 12, fontWeight: 600 } as const

export function EffortHistoryPanel({ deckId, editable }: { deckId: string; editable: boolean }) {
  const { message } = App.useApp()
  const [events, setEvents] = useState<DeckEvent[] | null>(null)
  const [names, setNames] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [onlyMissing, setOnlyMissing] = useState(false)
  const [editing, setEditing] = useState<DeckEvent | null>(null)
  const [draft, setDraft] = useState<Effort | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setError(null)
    try {
      // Hidden accounts included: a bay ticked last month by someone since
      // hidden still has to be attributed on this list.
      const [rows, users] = await Promise.all([listDeckEvents(deckId), listGsUsers(true).catch(() => [])])
      setEvents([...rows].reverse())
      setNames(Object.fromEntries(users.map((u) => [u.id, u.fullName])))
    } catch (e) {
      setError((e as Error).message)
    }
  }, [deckId])

  useEffect(() => {
    void load()
  }, [load])

  const shown = useMemo(() => {
    if (events === null) return []
    return onlyMissing ? events.filter((ev) => ev.effort.workHours === null) : events
  }, [events, onlyMissing])

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
      await setCellEventEffort(editing.id, (draft.wasteHours ?? 0) > 0 ? draft : { ...draft, wasteReason: '' })
      message.success('Đã lưu giờ công')
      closeEdit()
      await load()
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <SectionCard
      code="A3.5"
      title="Giờ công theo lần cập nhật"
      summary={events === null ? undefined : `${coverage.withHours} / ${coverage.total} lần cập nhật có giờ công`}
      extra={(
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: palette.textTertiary }}>
          <Switch size="small" checked={onlyMissing} onChange={setOnlyMissing} />
          Chỉ hiện lần chưa có giờ công
        </label>
      )}
    >
      {error && (
        <Alert
          type="error"
          showIcon
          message="Không tải được lịch sử cập nhật"
          description={error}
          action={<Button size="small" onClick={() => void load()}>Thử lại</Button>}
          style={{ marginBottom: 12 }}
        />
      )}
      <Table<DeckEvent>
        size="small"
        rowKey="id"
        loading={events === null && !error}
        dataSource={shown}
        pagination={{ pageSize: 20, hideOnSinglePage: true, size: 'small' }}
        locale={{ emptyText: onlyMissing ? 'Mọi lần cập nhật đã có giờ công' : 'Sàn này chưa có lần cập nhật nào' }}
        columns={[
          { title: 'Mã ô', dataIndex: 'cellCode', width: 80 },
          { title: 'Công việc', dataIndex: 'workName', width: 120, render: (v: string | null) => v ?? '' },
          { title: 'Công đoạn', dataIndex: 'toStageName', width: 140, render: (v: string | null) => v ?? 'Chưa bắt đầu' },
          { title: 'Cập nhật lúc', dataIndex: 'at', width: 160, render: (v: string) => formatDateTimeVN(v) },
          { title: 'Bởi', dataIndex: 'byId', width: 140, render: (v: string | null) => (v === null ? '' : names[v] ?? v) },
          { title: 'Nhóm trưởng', render: (_, ev) => ev.effort.leadName },
          { title: 'Thợ chính', render: (_, ev) => ev.effort.painterName },
          { title: 'Giờ công', align: 'right', width: 90, render: (_, ev) => hours(ev.effort.workHours) },
          { title: 'Giờ hao phí', align: 'right', width: 100, render: (_, ev) => hours(ev.effort.wasteHours) },
          { title: 'Lý do hao phí', render: (_, ev) => ev.effort.wasteReason },
          {
            title: '',
            width: 90,
            render: (_, ev) => (
              <Space size={4}>
                {ev.effortEditedAt && (
                  <Tooltip title={`Sửa bởi ${ev.effortEditedByName ?? 'quản trị viên'} lúc ${formatDateTimeVN(ev.effortEditedAt)}`}>
                    <Typography.Text type="secondary" style={{ fontSize: 11 }}>đã sửa</Typography.Text>
                  </Tooltip>
                )}
                {editable && <Button size="small" onClick={() => openEdit(ev)}>Sửa</Button>}
              </Space>
            ),
          },
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
              <Input id="effort-lead" value={draft.leadName} onChange={(e) => setDraft({ ...draft, leadName: e.target.value })} />
            </div>
            <div>
              <label htmlFor="effort-painter" style={fieldLabel}>Thợ chính</label>
              <Input id="effort-painter" value={draft.painterName} onChange={(e) => setDraft({ ...draft, painterName: e.target.value })} />
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
              <div style={{ gridColumn: '1 / -1' }}>
                <label htmlFor="effort-waste-reason" style={fieldLabel}>Lý do hao phí</label>
                <Input
                  id="effort-waste-reason"
                  value={draft.wasteReason}
                  onChange={(e) => setDraft({ ...draft, wasteReason: e.target.value })}
                  placeholder="Ví dụ: chờ vật tư, mưa"
                />
              </div>
            )}
          </div>
        )}
      </Modal>
    </SectionCard>
  )
}
