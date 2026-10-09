import { Alert, App, Button, Input, Space, Table } from 'antd'
import { useRef, useState, type KeyboardEvent } from 'react'
import { ConsequenceModal } from '../../../components/ConsequenceModal'
import { IconAction } from '../../../components/IconAction'
import { RulesDisclosure } from '../../../components/RulesDisclosure'
import { builtInSpoolHeader } from '../../../domain/piping/imports'
import type { Spool, SpoolColumn } from '../../../domain/piping/types'
import {
  addSpoolColumn, deleteSpoolColumn, listSpoolColumns, listSpools, renameSpoolColumn, reorderSpoolColumns,
} from '../../../lib/pipingApi'
import { space } from '../../../theme'
import { moveRow, nextSort, useRowDrag } from './ordering'
import { spoolsRenamed, spoolsWithColumn } from './spoolCounts'
import { useProjectList } from './useProjectList'

const RULES = [
  { id: 'order', text: 'Kéo hàng để đổi thứ tự; thứ tự được lưu ngay khi thả.' },
  { id: 'rewrite', text: 'Đổi tên hoặc xoá cột ghi lại giá trị của cột đó ở mọi spool của dự án.' },
  { id: 'header', text: 'Tên cột không được trùng tên cột chuẩn của file spool (SpoolNo, LineNo, …).' },
]

const COUNT = new Intl.NumberFormat('vi-VN')

const sameLabel = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

/**
 * Why a column cannot take `label`, in the API's and the database's words, or
 * null: blank, a built-in spool header, or another column's label in any case.
 */
function renameRefusal(label: string, column: SpoolColumn, columns: readonly SpoolColumn[]): string | null {
  if (label === '') return 'Tên cột không được để trống'
  const builtIn = builtInSpoolHeader(label)
  if (builtIn) return `Tên cột "${label}" trùng tên cột chuẩn ${builtIn}`
  if (columns.some((c) => c.id !== column.id && sameLabel(c.label, label))) return `Cột "${label}" đã có trong dự án`
  return null
}

/** A rename or a delete waiting on its confirm, with the spools it rewrites once counted. */
type Pending =
  | { kind: 'rename'; column: SpoolColumn; label: string; count: number | null; error: string | null }
  | { kind: 'delete'; column: SpoolColumn; count: number | null; error: string | null }

/**
 * Cột thêm của spool (spec §6.1, Q21A): the admin's extra text columns. A
 * rename or a delete rewrites the values of every spool of the project in one
 * transaction (0039), so each asks first, saying how many spools it touches.
 */
export function ColumnsSection({ projectId, onChanged }: { projectId: string; onChanged: () => void }) {
  const { message } = App.useApp()
  const list = useProjectList(projectId, listSpoolColumns)
  const columns = list.rows ?? []
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null)
  const [pending, setPending] = useState<Pending | null>(null)

  const run = async (work: () => Promise<unknown>, success?: string): Promise<boolean> => {
    setBusy(true)
    try {
      await work()
      if (success) message.success(success)
      onChanged()
      return true
    } catch (e) {
      message.error((e as Error).message)
      return false
    } finally {
      setBusy(false)
      list.reload()
    }
  }

  // A ref as well as state: a second Enter can land before the re-render that disables the button.
  const adding = useRef(false)
  const [addBusy, setAddBusy] = useState(false)
  const add = async () => {
    const text = label.trim()
    if (text === '' || adding.current) return
    adding.current = true
    setAddBusy(true)
    try {
      if (await run(() => addSpoolColumn(projectId, text, nextSort(columns)), `Đã thêm cột ${text}`)) setLabel('')
    } finally {
      adding.current = false
      setAddBusy(false)
    }
  }

  /** Esc leaves the rename only; without stopPropagation the dialog would close on it too. */
  const cancelOnEscape = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return
    e.stopPropagation()
    setEditing(null)
  }

  /** Opens the confirm at once and counts the spools behind it; a failed count is said, not guessed. */
  const ask = (next: Pending, count: (spools: Spool[]) => number) => {
    setPending(next)
    listSpools(projectId)
      .then((spools) => setPending((p) => (p?.column.id === next.column.id ? { ...p, count: count(spools) } : p)))
      .catch((e: Error) => setPending((p) => (p?.column.id === next.column.id ? { ...p, error: e.message } : p)))
  }

  const askRename = () => {
    if (editing === null) return
    const column = columns.find((c) => c.id === editing.id)
    if (column === undefined || editing.text.trim() === column.label) {
      setEditing(null)
      return
    }
    const text = editing.text.trim()
    // The API's own refusals, asked here first: no confirm and no spool count for a rename that cannot happen.
    const refusal = renameRefusal(text, column, columns)
    if (refusal !== null) {
      message.error(refusal)
      return
    }
    ask({ kind: 'rename', column, label: text, count: null, error: null }, (s) => spoolsRenamed(s, column.label, text))
  }

  const confirm = async () => {
    if (pending === null) return
    setBusy(true)
    try {
      if (pending.kind === 'rename') {
        const { spoolsUpdated } = await renameSpoolColumn(projectId, pending.column.id, pending.label)
        message.success(`Đã đổi tên cột, ${COUNT.format(spoolsUpdated)} spool được cập nhật`)
        setEditing(null)
      } else {
        const { spoolsUpdated } = await deleteSpoolColumn(projectId, pending.column.id)
        message.success(`Đã xoá cột ${pending.column.label}, ${COUNT.format(spoolsUpdated)} spool được cập nhật`)
      }
      setPending(null)
      onChanged()
      list.reload()
    } catch (e) {
      setPending((p) => (p === null ? p : { ...p, error: (e as Error).message }))
    } finally {
      setBusy(false)
    }
  }

  const drag = useRowDrag((from, to) => {
    const next = moveRow(columns, from, to)
    list.setRows(next)
    void run(() => reorderSpoolColumns(projectId, next.map((c) => c.id)))
  }, !busy && editing === null)

  if (list.error) return <Alert type="error" showIcon message="Không tải được cột thêm" description={list.error} />

  const counting = pending !== null && pending.count === null && pending.error === null
  const counted = pending === null ? ''
    : pending.count !== null ? `${COUNT.format(pending.count)} spool`
      : pending.error !== null ? 'Không đếm được số spool' : 'Đang đếm spool…'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: space.md }}>
      <div style={{ display: 'flex', gap: space.sm }}>
        <Input
          aria-label="Tên cột mới"
          placeholder="Tên cột"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onPressEnter={() => void add()}
          style={{ maxWidth: 320 }}
        />
        <Button type="primary" disabled={label.trim() === ''} loading={addBusy} onClick={() => void add()}>
          Thêm cột
        </Button>
      </div>
      <Table<SpoolColumn>
        rowKey="id"
        loading={list.rows === null}
        dataSource={columns}
        pagination={false}
        onRow={drag.onRow}
        locale={{ emptyText: 'Chưa có cột thêm' }}
        columns={[
          drag.handleColumn,
          {
            title: 'Tên cột',
            dataIndex: 'label',
            render: (value: string, row) => (editing?.id === row.id
              ? (
                <Input
                  aria-label="Tên cột"
                  autoFocus
                  value={editing.text}
                  onChange={(e) => setEditing({ id: row.id, text: e.target.value })}
                  onPressEnter={askRename}
                  onKeyDown={cancelOnEscape}
                />
              )
              : value),
          },
          {
            title: 'Thao tác',
            key: 'actions',
            align: 'center',
            width: 120,
            render: (_v, row) => (editing?.id === row.id
              ? (
                <Space size={space.xs}>
                  <IconAction verb="save" label="Lưu tên cột" type="primary" onClick={askRename} />
                  <IconAction verb="close" label="Huỷ đổi tên" onClick={() => setEditing(null)} />
                </Space>
              )
              : (
                <Space size={space.xs}>
                  <IconAction
                    verb="edit"
                    label="Đổi tên cột"
                    disabled={busy}
                    onClick={() => setEditing({ id: row.id, text: row.label })}
                  />
                  <IconAction
                    verb="delete"
                    label="Xoá cột"
                    danger
                    disabled={busy}
                    onClick={() => ask(
                      { kind: 'delete', column: row, count: null, error: null },
                      (s) => spoolsWithColumn(s, row.label),
                    )}
                  />
                </Space>
              )),
          },
        ]}
      />
      <RulesDisclosure rules={RULES} />
      <ConsequenceModal
        open={pending?.kind === 'rename'}
        tone="warn"
        title={pending?.kind === 'rename' ? `Đổi tên cột "${pending.column.label}" thành "${pending.label}"?` : ''}
        description="Ghi lại theo tên mới:"
        items={[{ label: counted }]}
        okText="Đổi tên cột"
        confirmLoading={busy || counting}
        error={pending?.error}
        onCancel={() => setPending(null)}
        onOk={() => void confirm()}
      />
      <ConsequenceModal
        open={pending?.kind === 'delete'}
        tone="danger"
        title={pending?.kind === 'delete' ? `Xoá cột "${pending.column.label}"?` : ''}
        description="Mất giá trị của cột ở:"
        items={[{ label: counted }]}
        consequences={['Không khôi phục được']}
        okText="Xoá cột"
        confirmLoading={busy || counting}
        error={pending?.error}
        onCancel={() => setPending(null)}
        onOk={() => void confirm()}
      />
    </div>
  )
}
