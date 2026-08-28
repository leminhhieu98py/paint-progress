import { Alert, Button, Form, Input, Modal, Space, Table, Typography } from 'antd'
import { useCallback, useEffect, useState } from 'react'
import { formatAreaM2, formatPercent } from '../../lib/format'
import { createProject, listProjects, updateProject, type ProjectRow } from '../../lib/projectsApi'
import { PageBody } from '../../components/PageHeader'

interface CreateValues {
  name: string
  code: string
}

export function ProjectsScreen() {
  const [rows, setRows] = useState<ProjectRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [editing, setEditing] = useState<ProjectRow | null>(null)

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

  const onCreate = async (values: CreateValues) => {
    try {
      await createProject(values)
      setCreateOpen(false)
      setError(null)
      await refresh()
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
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <PageBody>
      <Space direction="vertical" style={{ width: '100%' }} size="middle">
        {error && <Alert type="error" message={error} closable onClose={() => setError(null)} />}

        <Space>
          <Typography.Title level={4} style={{ margin: 0 }}>
            Dự án
          </Typography.Title>
          <Button type="primary" onClick={() => setCreateOpen(true)}>
            Tạo dự án
          </Button>
        </Space>

        <Table<ProjectRow>
          rowKey="id"
          loading={loading}
          dataSource={rows}
          pagination={false}
          columns={[
            { title: 'Tên dự án', dataIndex: 'name' },
            { title: 'Mã', dataIndex: 'code', width: 120 },
            { title: 'Số sàn', dataIndex: 'deckCount', width: 100 },
            {
              title: 'Tổng diện tích (m²)',
              dataIndex: 'totalAreaM2',
              width: 180,
              render: (v: number) => formatAreaM2(v),
            },
            {
              title: 'Tiến độ',
              dataIndex: 'progress',
              width: 120,
              render: (v: number) => formatPercent(v),
            },
            {
              title: '',
              key: 'actions',
              width: 90,
              render: (_v, row) => (
                <Button size="small" onClick={() => setEditing(row)}>
                  Sửa
                </Button>
              ),
            },
          ]}
        />

        <Modal
          open={createOpen || editing !== null}
          title={editing ? 'Sửa dự án' : 'Tạo dự án'}
          onCancel={() => {
            setCreateOpen(false)
            setEditing(null)
          }}
          footer={null}
          destroyOnHidden
        >
          <Form<CreateValues>
            layout="vertical"
            initialValues={editing ? { name: editing.name, code: editing.code } : undefined}
            onFinish={(v) => void (editing ? onUpdate(editing.id, v) : onCreate(v))}
          >
            <Form.Item name="name" label="Tên dự án" rules={[{ required: true, message: 'Nhập tên dự án' }]}>
              <Input />
            </Form.Item>
            <Form.Item name="code" label="Mã dự án" rules={[{ required: true, message: 'Nhập mã dự án' }]}>
              <Input />
            </Form.Item>
            <Button type="primary" htmlType="submit" block>
              {editing ? 'Lưu' : 'Tạo'}
            </Button>
          </Form>
        </Modal>
      </Space>
    </PageBody>
  )
}
