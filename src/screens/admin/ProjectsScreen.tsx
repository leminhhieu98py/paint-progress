import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons'
import { Alert, App, Button, Form, Input, Modal, Space, Table, Tooltip } from 'antd'
import dayjs from 'dayjs'
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ConsequenceModal } from '../../components/ConsequenceModal'
import { PageBody, PageHeader } from '../../components/PageHeader'
import { ProgressBar } from '../../components/ProgressBar'
import { SectionCard } from '../../components/SectionCard'
import { modalProps } from '../../components/modalChrome'
import { StatCard } from '../../components/StatCard'
import { formatAreaM2 } from '../../lib/format'
import { latestProgressEvent, type ProgressEvent } from '../../lib/progressApi'
import {
  createProject, deleteProject, listProjects, updateProject, type ProjectRow,
} from '../../lib/projectsApi'
import { APP_BASE_PATH } from '../../config'
import { palette } from '../../theme'

interface CreateValues {
  name: string
  code: string
}

const COUNT = new Intl.NumberFormat('vi-VN')

/**
 * When the last stage change happened, at the precision that is useful.
 *
 * A bare "09:42" is what the prototype shows and it is right for the common
 * case -- somebody recorded something this morning. It is wrong for the case
 * that matters more: nothing has been recorded in three weeks, and "09:42"
 * reads as though the site is busy.
 */
function eventTime(iso: string): string {
  const at = dayjs(iso)
  return at.isSame(dayjs(), 'day') ? at.format('HH:mm') : at.format('DD.MM · HH:mm')
}

function eventDetail(e: ProgressEvent): string {
  const who = e.byUsername ?? e.byName ?? 'không rõ'
  // A null stage is a bay sent back to the start -- a real and consequential
  // thing a foreman does. Printing "R7C11 → " would read as a rendering bug.
  return `${who} · ${e.cellCode} → ${e.toStageName ?? 'Chưa bắt đầu'}`
}

export function ProjectsScreen() {
  const navigate = useNavigate()
  const [rows, setRows] = useState<ProjectRow[]>([])
  const [event, setEvent] = useState<ProgressEvent | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [editing, setEditing] = useState<ProjectRow | null>(null)
  /** The project whose deletion is being confirmed, and the write in flight. */
  const [removingProject, setRemovingProject] = useState<ProjectRow | null>(null)
  const [removing, setRemoving] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      setRows(await listProjects())
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  /*
    Fetched separately from the project list, and its failure is swallowed on
    purpose. The counters are a nicety; the table is the screen. A permission
    problem on cell_events must not blank the projects the admin came for, and
    an empty counter says the same thing as an error would.
  */
  useEffect(() => {
    let cancelled = false
    latestProgressEvent()
      .then((e) => {
        if (!cancelled) setEvent(e)
      })
      .catch(() => {
        if (!cancelled) setEvent(null)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const { message } = App.useApp()

  /**
   * Hard delete behind the typed name (Feedback Rv1, item 1): every deck,
   * bay, zone, note, membership and event under the project goes with the
   * row. Drawing files are cleaned up after; ones that would not go are
   * reported, not treated as a failed delete -- see projectsApi.deleteProject.
   */
  const removeProject = async () => {
    if (!removingProject) return
    setRemoving(true)
    try {
      const { drawingsRemoved, drawingsTotal } = await deleteProject(removingProject.id)
      setRemovingProject(null)
      message.success(`Đã xóa dự án ${removingProject.name}`)
      if (drawingsRemoved < drawingsTotal) {
        message.warning('Đã xóa, nhưng chưa dọn được file bản vẽ trên kho lưu trữ')
      }
      await refresh()
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setRemoving(false)
    }
  }
  // The dialog's actions live in its footer strip, outside the <Form>.
  const [form] = Form.useForm<CreateValues>()

  /**
   * Opens the one dialog, on a project or on nothing.
   *
   * The fields are written here rather than through `initialValues`: the Form
   * instance is held outside the tree so the footer's buttons can submit it,
   * and antd keeps that store alive across destroyOnHidden -- so initialValues
   * loses to whatever the last open left behind, and the dialog reopens
   * holding a project the admin has already walked away from.
   */
  const openDialog = (project: ProjectRow | null) => {
    form.setFieldsValue({ name: project?.name ?? '', code: project?.code ?? '' })
    setEditing(project)
    setCreateOpen(project === null)
  }

  /** Every dismissal path -- the X, the mask, Escape, Huỷ -- ends here. */
  const closeDialog = () => {
    setCreateOpen(false)
    setEditing(null)
    form.resetFields()
  }

  const onCreate = async (values: CreateValues) => {
    try {
      await createProject(values)
      setCreateOpen(false)
      setError(null)
      await refresh()
      message.success('Đã tạo dự án')
    } catch (e) {
      // Deliberately leaves the modal open so the typed values survive.
      setError((e as Error).message)
    }
  }

  const onUpdate = async (id: string, values: CreateValues) => {
    try {
      await updateProject(id, values)
      setEditing(null)
      setError(null)
      await refresh()
      message.success('Đã lưu dự án')
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const totals = rows.reduce(
    (a, r) => ({
      area: a.area + r.totalAreaM2,
      decks: a.decks + r.deckCount,
      drawn: a.drawn + r.decksWithDrawing,
      cells: a.cells + r.cellCount,
    }),
    { area: 0, decks: 0, drawn: 0, cells: 0 },
  )

  return (
    <>
      <PageHeader
        title="Dự án"
        subtitle={`${rows.length} dự án · ${totals.decks} sàn · tiến độ theo công việc`}
        extra={
          /*
            aria-hidden on an icon that sits beside its own visible label.
            @ant-design/icons renders role="img" aria-label="plus", which
            would otherwise join the button's accessible name -- the button
            stops being reachable as "Tạo dự án" by a screen reader, and by a
            test. Icon-only buttons carry their own aria-label instead, which
            overrides the icon's.
          */
          <Button
            type="primary"
            icon={<PlusOutlined aria-hidden />}
            onClick={() => openDialog(null)}
          >
            Tạo dự án
          </Button>
        }
      />

      <PageBody>
        {error && <Alert type="error" message={error} closable onClose={() => setError(null)} />}

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(196px, 1fr))',
            gap: 14,
          }}
        >
          <StatCard
            label="Tổng diện tích"
            value={formatAreaM2(totals.area)}
            sub={`m² trên ${rows.length} dự án`}
          />
          <StatCard
            label="Số sàn theo dõi"
            value={COUNT.format(totals.decks)}
            sub={`${totals.drawn} sàn đã có bản vẽ`}
          />
          <StatCard
            label="Ô đã dựng"
            value={COUNT.format(totals.cells)}
            sub="trên toàn bộ bản vẽ"
          />
          <StatCard
            label="Ghi nhận gần nhất"
            tone="accent"
            live={event !== null}
            value={event ? eventTime(event.at) : '—'}
            sub={event ? eventDetail(event) : 'Chưa có ghi nhận nào'}
          />
        </div>

        <SectionCard bodyPadding={0}>
          <Table<ProjectRow>
            className="pp-table"
            rowKey="id"
            loading={loading}
            dataSource={rows}
            pagination={false}
            /*
              The whole row opens the project. The decks screen has its own
              project picker, so the id travels in the query string rather than
              in the path -- which also means the URL an admin bookmarks or
              sends to Linh opens on the right project.
            */
            onRow={(row) => ({
              style: { cursor: 'pointer' },
              onClick: () => navigate(`${APP_BASE_PATH}/admin/decks?project=${row.id}`),
            })}
            columns={[
              {
                title: 'Tên dự án',
                dataIndex: 'name',
                render: (_v, row) => (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: 9,
                        background: palette.bgHover,
                        color: palette.textSecondary,
                        fontSize: 12,
                        fontWeight: 600,
                        lineHeight: '32px',
                        textAlign: 'center',
                        flex: 'none',
                      }}
                    >
                      {row.code.slice(0, 2).toUpperCase()}
                    </span>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600, lineHeight: 1.35 }}>{row.name}</div>
                      <span style={{ fontSize: 11, color: palette.textTertiary }}>{row.code}</span>
                    </div>
                  </div>
                ),
              },
              { title: 'Số sàn', dataIndex: 'deckCount', width: 100, align: 'right' },
              {
                title: 'Tổng diện tích (m²)',
                dataIndex: 'totalAreaM2',
                width: 180,
                align: 'right',
                render: (v: number) => formatAreaM2(v),
              },
              {
                title: 'Tiến độ',
                dataIndex: 'progress',
                width: 240,
                render: (v: number) => <ProgressBar ratio={v} />,
              },
              {
                title: 'Thao tác',
                key: 'actions',
                width: 140,
                align: 'right',
                render: (_v, row) => (
                  <Space size={6}>
                    <Tooltip title="Sửa dự án">
                      <Button
                        size="small"
                        aria-label="Sửa"
                        icon={<EditOutlined />}
                        onClick={(e) => {
                          // The button sits inside a row that navigates. Without
                          // this, editing also opens the project's decks behind
                          // the modal, and closing it strands the admin there.
                          e.stopPropagation()
                          openDialog(row)
                        }}
                      />
                    </Tooltip>
                    <Tooltip title="Xóa dự án">
                      <Button
                        size="small"
                        danger
                        aria-label="Xóa dự án"
                        icon={<DeleteOutlined />}
                        onClick={(e) => {
                          e.stopPropagation()
                          setRemovingProject(row)
                        }}
                      />
                    </Tooltip>
                  </Space>
                ),
              },
            ]}
          />
        </SectionCard>
      </PageBody>

      <ConsequenceModal
        open={removingProject !== null}
        tone="danger"
        tag="Thao tác phá huỷ"
        title={`Xóa dự án ${removingProject?.name ?? ''}?`}
        description="Xóa vĩnh viễn, không khôi phục được. Mất theo dự án:"
        items={[
          { label: `${removingProject?.deckCount ?? 0} sàn`, meta: removingProject ? `${formatAreaM2(removingProject.totalAreaM2)} m²` : undefined },
          { label: 'Toàn bộ ô và lịch sử công đoạn', meta: removingProject ? `${removingProject.cellCount} ô` : undefined },
          { label: 'Zone và kế hoạch' },
          { label: 'Ghi chú của GS' },
          { label: 'Bản vẽ đã tải lên' },
          { label: 'Phân quyền GS vào dự án' },
        ]}
        consequence="GS đang mở dự án này trên máy tính bảng sẽ không ghi được nữa cho tới khi tải lại."
        okText="Xóa dự án"
        confirmText={removingProject?.name}
        confirmLoading={removing}
        onCancel={() => setRemovingProject(null)}
        onOk={() => void removeProject()}
      />

      <Modal
        open={createOpen || editing !== null}
        title={editing ? 'Sửa dự án' : 'Tạo dự án'}
        onCancel={closeDialog}
        {...modalProps}
        footer={[
          <Button key="cancel" onClick={closeDialog}>
            Huỷ
          </Button>,
          <Button key="ok" type="primary" onClick={() => form.submit()}>
            {editing ? 'Lưu' : 'Tạo'}
          </Button>,
        ]}
      >
        <Form<CreateValues>
          form={form}
          layout="vertical"
          onFinish={(v) => void (editing ? onUpdate(editing.id, v) : onCreate(v))}
        >
          <Form.Item name="name" label="Tên dự án" rules={[{ required: true, message: 'Nhập tên dự án' }]}>
            <Input placeholder="Ví dụ: Bạch Hổ BH-7 Repaint" />
          </Form.Item>
          <Form.Item
            name="code"
            label="Mã dự án"
            rules={[{ required: true, message: 'Nhập mã dự án' }]}
            extra="Mã là duy nhất trên toàn hệ thống."
          >
            <Input placeholder="Ví dụ: BH7-RPT" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  )
}
