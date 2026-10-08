import { Alert, App, Button, DatePicker, Form, InputNumber, Modal, Space, Table } from 'antd'
import dayjs, { type Dayjs } from 'dayjs'
import { useMemo, useState, type ReactNode } from 'react'
import { ConsequenceModal } from '../../../components/ConsequenceModal'
import { IconAction } from '../../../components/IconAction'
import { modalProps } from '../../../components/modalChrome'
import { useTablePagination } from '../../../components/tablePagination'
import { useTypeScale } from '../../../components/typeScale'
import { viNumberInputProps } from '../../../components/viNumberInput'
import { checkReinstatementEntry } from '../../../domain/piping/reinstatement'
import type { DayKey } from '../../../domain/piping/types'
import { formatDayMonthYear } from '../../../domain/piping/week'
import { formatDateTimeVN, MISSING } from '../../../lib/format'
import { deleteReinstatementEntry, updateReinstatementEntry, type ReinstatementEntry } from '../../../lib/pipingApi'
import { palette, space } from '../../../theme'
import { useFieldPhone } from '../../gs/fieldSections'
import { formatQty } from '../pipingFormat'

/** Newest day first; on one day, the latest entry first. */
function newestFirst(a: ReinstatementEntry, b: ReinstatementEntry): number {
  if (a.day !== b.day) return a.day < b.day ? 1 : -1
  const at = a.createdAt ?? ''
  const bt = b.createdAt ?? ''
  if (at !== bt) return at < bt ? 1 : -1
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0
}

interface EditValues {
  day: Dayjs | null
  qty: number | null
}

/**
 * The Reinstatement entries (spec §4, R-3, Q8C), newest first, paged (UI-05):
 * day, quantity, who entered it and when, who last edited it. Everyone reads
 * them; only the admin edits (a dialog; a raise is checked against the cap)
 * or deletes (after a confirmation). Edits are stamped by the
 * database, which also holds the future-day rule and the cap for the admin.
 */
export function EntriesTable({ projectId, entries, totalTestPacks, todayKey, canEdit, onChanged, dayExtra }: {
  projectId: string
  entries: ReinstatementEntry[]
  totalTestPacks: number | null
  todayKey: DayKey
  /** The admin's edit and delete actions. */
  canEdit: boolean
  /** After a write: the panel reads its data again. */
  onChanged: () => void
  /**
   * Beside a day, the admin's note icon for that day (spec §9): on the day's
   * first (newest) row only, as a day may have several entries. Not passed
   * for a foreman or a viewer.
   */
  dayExtra?: (day: DayKey) => ReactNode
}) {
  const { message } = App.useApp()
  const type = useTypeScale()
  /** On a phone the day stays in view while the rest scrolls under it (MOB-01). */
  const pin = useFieldPhone() ? ('left' as const) : undefined
  const rows = useMemo(() => [...entries].sort(newestFirst), [entries])
  /** A day's first (newest) entry: the one row of the day that carries `dayExtra`. */
  const firstOfDay = useMemo(() => new Set(rows.filter((r, i) => i === 0 || rows[i - 1].day !== r.day).map((r) => r.id)), [rows])
  const pagination = useTablePagination(rows.length, projectId)
  const [editing, setEditing] = useState<ReinstatementEntry | null>(null)
  const [removing, setRemoving] = useState<ReinstatementEntry | null>(null)
  /** The delete in flight, and its refusal (shown inside the confirmation, which stays open). */
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const remove = async () => {
    if (removing === null) return
    setBusy(true)
    setError(null)
    try {
      await deleteReinstatementEntry(removing.id)
      message.success('Đã xoá số lượng')
      setRemoving(null)
      onChanged()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div data-testid="reinstatement-entries">
        <Table<ReinstatementEntry>
          rowKey="id"
          dataSource={rows}
          pagination={pagination}
          scroll={{ x: 'max-content' }}
          locale={{ emptyText: 'Chưa có số lượng nào' }}
          columns={[
            {
              title: 'Ngày',
              dataIndex: 'day',
              align: 'center',
              fixed: pin,
              render: (day: DayKey, row: ReinstatementEntry) => (
                <>
                  {formatDayMonthYear(day)}
                  {firstOfDay.has(row.id) && dayExtra?.(day)}
                </>
              ),
            },
            { title: 'Số lượng', dataIndex: 'qty', align: 'center', render: (qty: number) => formatQty(qty) },
            { title: 'Người nhập', dataIndex: 'createdByName', render: (name: string | null) => name ?? MISSING },
            {
              title: 'Thời gian',
              dataIndex: 'createdAt',
              align: 'center',
              render: (at: string | null) => formatDateTimeVN(at) || MISSING,
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
                render: (_v: unknown, row: ReinstatementEntry) => (
                  <Space size={space.xs}>
                    <IconAction verb="edit" label="Sửa số lượng" disabled={busy} onClick={() => setEditing(row)} />
                    <IconAction
                      verb="delete"
                      label="Xoá số lượng"
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

      {editing !== null && (
        <EditEntryModal
          entry={editing}
          entries={entries}
          totalTestPacks={totalTestPacks}
          todayKey={todayKey}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            onChanged()
          }}
        />
      )}

      <ConsequenceModal
        open={removing !== null}
        tone="danger"
        title={removing ? `Xoá số lượng ngày ${formatDayMonthYear(removing.day)}?` : ''}
        items={removing ? [{ label: `Số lượng ${formatQty(removing.qty)}`, meta: removing.createdByName ?? undefined }] : undefined}
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

/**
 * Sửa số lượng: the admin corrects an entry's day or quantity; only a raise
 * is checked against the cap, without the entry itself, as the trigger does.
 * Mounted only while open, so each opening starts on the entry as stored; a
 * refusal stays in the dialog.
 */
function EditEntryModal({ entry, entries, totalTestPacks, todayKey, onClose, onSaved }: {
  entry: ReinstatementEntry
  entries: ReinstatementEntry[]
  totalTestPacks: number | null
  todayKey: DayKey
  onClose: () => void
  onSaved: () => void
}) {
  const { message } = App.useApp()
  const [form] = Form.useForm<EditValues>()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async (values: EditValues) => {
    if (values.day === null || values.qty === null) return
    const day = values.day.format('YYYY-MM-DD')
    const refused = checkReinstatementEntry({
      entries, totalTestPacks, day, qty: values.qty, todayKey, editing: { id: entry.id, qty: entry.qty },
    })
    if (refused !== null) {
      setError(refused)
      return
    }
    setSaving(true)
    setError(null)
    try {
      await updateReinstatementEntry(entry.id, { day, qty: values.qty })
      message.success('Đã sửa số lượng')
      onSaved()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      title="Sửa số lượng"
      onCancel={() => !saving && onClose()}
      {...modalProps}
      footer={[
        <Button key="cancel" disabled={saving} onClick={onClose}>Huỷ</Button>,
        <Button key="ok" type="primary" loading={saving} onClick={() => form.submit()}>Lưu</Button>,
      ]}
    >
      {error && <Alert type="error" showIcon message={error} style={{ marginBottom: space.lg }} />}
      <Form<EditValues>
        form={form}
        layout="vertical"
        initialValues={{ day: dayjs(entry.day), qty: entry.qty }}
        onFinish={(v) => void save(v)}
      >
        <Form.Item name="day" label="Ngày" rules={[{ required: true, message: 'Chọn ngày' }]}>
          <DatePicker
            format="DD/MM/YYYY"
            disabledDate={(d) => d.format('YYYY-MM-DD') > todayKey}
            style={{ width: '100%' }}
          />
        </Form.Item>
        <Form.Item name="qty" label="Số lượng" rules={[{ required: true, message: 'Nhập số lượng' }]}>
          <InputNumber<number> {...viNumberInputProps} style={{ width: '100%' }} />
        </Form.Item>
      </Form>
    </Modal>
  )
}
