import { Alert, App, Button, Input, Space, Table } from 'antd'
import { useRef, useState, type KeyboardEvent } from 'react'
import { ConsequenceModal } from '../../../components/ConsequenceModal'
import { IconAction } from '../../../components/IconAction'
import { RulesDisclosure } from '../../../components/RulesDisclosure'
import { StatusPill } from '../../../components/StatusPill'
import type { ManpowerGroup } from '../../../domain/piping/types'
import {
  addManpowerGroup, deleteManpowerGroup, listManpowerGroups, renameManpowerGroup, reorderManpowerGroups,
  setManpowerGroupHidden,
} from '../../../lib/pipingApi'
import { space } from '../../../theme'
import { moveRow, nextSort, useRowDrag } from './ordering'
import { useProjectList } from './useProjectList'

const RULES = [
  { id: 'order', text: 'Kéo hàng để đổi thứ tự; thứ tự được lưu ngay khi thả.' },
  { id: 'hide', text: 'Nhóm đã ẩn không còn trong ô nhập của GS; số liệu cũ của nhóm vẫn hiện trên biểu đồ.' },
  { id: 'delete', text: 'Chỉ xoá được nhóm chưa có số liệu kế hoạch hoặc thực tế; nhóm đã có số liệu thì ẩn đi.' },
]

/**
 * Nhóm nhân lực (spec §5, R-6, R-8): add, rename, hide or show, drag to
 * reorder (saved on drop with the whole list, ORD-01), delete while unused --
 * the database refuses a group with data, and its message is shown as is.
 */
export function GroupsSection({ projectId, onChanged }: { projectId: string; onChanged: () => void }) {
  const { message } = App.useApp()
  const list = useProjectList(projectId, listManpowerGroups)
  const groups = list.rows ?? []
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null)
  const [removing, setRemoving] = useState<ManpowerGroup | null>(null)
  const [removeError, setRemoveError] = useState<string | null>(null)

  /** One write, then the list as stored; true when it went through. */
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
    const text = name.trim()
    if (text === '' || adding.current) return
    adding.current = true
    setAddBusy(true)
    try {
      if (await run(() => addManpowerGroup(projectId, text, nextSort(groups)), `Đã thêm nhóm ${text}`)) setName('')
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

  const rename = async () => {
    if (editing === null || busy) return
    const group = groups.find((g) => g.id === editing.id)
    if (group === undefined || editing.text.trim() === group.name) {
      setEditing(null)
      return
    }
    if (await run(() => renameManpowerGroup(editing.id, editing.text), 'Đã đổi tên nhóm')) setEditing(null)
  }

  const drag = useRowDrag((from, to) => {
    const next = moveRow(groups, from, to)
    list.setRows(next)
    void run(() => reorderManpowerGroups(projectId, next.map((g) => g.id)))
  }, !busy && editing === null)

  const remove = async () => {
    if (removing === null) return
    setBusy(true)
    setRemoveError(null)
    try {
      await deleteManpowerGroup(removing.id)
      message.success(`Đã xoá nhóm ${removing.name}`)
      setRemoving(null)
      onChanged()
      list.reload()
    } catch (e) {
      setRemoveError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (list.error) return <Alert type="error" showIcon message="Không tải được nhóm nhân lực" description={list.error} />

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: space.md }}>
      <div style={{ display: 'flex', gap: space.sm }}>
        <Input
          aria-label="Tên nhóm mới"
          placeholder="Tên nhóm"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onPressEnter={() => void add()}
          style={{ maxWidth: 320 }}
        />
        <Button type="primary" disabled={name.trim() === ''} loading={addBusy} onClick={() => void add()}>
          Thêm nhóm
        </Button>
      </div>
      <Table<ManpowerGroup>
        rowKey="id"
        loading={list.rows === null}
        dataSource={groups}
        pagination={false}
        onRow={drag.onRow}
        columns={[
          drag.handleColumn,
          {
            title: 'Tên nhóm',
            dataIndex: 'name',
            render: (value: string, row) => (editing?.id === row.id
              ? (
                <Input
                  aria-label="Tên nhóm"
                  autoFocus
                  value={editing.text}
                  onChange={(e) => setEditing({ id: row.id, text: e.target.value })}
                  onPressEnter={() => void rename()}
                  onKeyDown={cancelOnEscape}
                />
              )
              : value),
          },
          {
            title: 'Trạng thái',
            key: 'hidden',
            align: 'center',
            width: 120,
            render: (_v, row) => (row.hidden ? <StatusPill tone="off">Đã ẩn</StatusPill> : null),
          },
          {
            title: 'Thao tác',
            key: 'actions',
            align: 'center',
            width: 160,
            render: (_v, row) => (editing?.id === row.id
              ? (
                <Space size={space.xs}>
                  <IconAction verb="save" label="Lưu tên nhóm" type="primary" loading={busy} onClick={() => void rename()} />
                  <IconAction verb="close" label="Huỷ đổi tên" onClick={() => setEditing(null)} />
                </Space>
              )
              : (
                <Space size={space.xs}>
                  <IconAction
                    verb="edit"
                    label="Đổi tên nhóm"
                    disabled={busy}
                    onClick={() => setEditing({ id: row.id, text: row.name })}
                  />
                  {row.hidden
                    ? (
                      <IconAction
                        verb="unhide"
                        label="Hiện lại nhóm"
                        disabled={busy}
                        onClick={() => void run(() => setManpowerGroupHidden(row.id, false), `Đã hiện lại nhóm ${row.name}`)}
                      />
                    )
                    : (
                      <IconAction
                        verb="hide"
                        label="Ẩn nhóm"
                        disabled={busy}
                        onClick={() => void run(() => setManpowerGroupHidden(row.id, true), `Đã ẩn nhóm ${row.name}`)}
                      />
                    )}
                  <IconAction
                    verb="delete"
                    label="Xoá nhóm"
                    danger
                    disabled={busy}
                    onClick={() => {
                      setRemoveError(null)
                      setRemoving(row)
                    }}
                  />
                </Space>
              )),
          },
        ]}
      />
      <RulesDisclosure rules={RULES} />
      <ConsequenceModal
        open={removing !== null}
        tone="danger"
        title={`Xoá nhóm ${removing?.name ?? ''}?`}
        consequences={['Không khôi phục được']}
        okText="Xoá nhóm"
        confirmLoading={busy}
        error={removeError}
        onCancel={() => setRemoving(null)}
        onOk={() => void remove()}
      />
    </div>
  )
}
