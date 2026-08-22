import { Alert, Button, Form, Input, Modal, Popconfirm, Select, Space, Switch, Table, Typography } from 'antd'
import { useCallback, useEffect, useState } from 'react'
import {
  createGsUser,
  deactivateGsUser,
  listGsUsers,
  revealPassword,
  setPassword,
  type GsUser,
} from '../../lib/adminApi'
import { supabase } from '../../lib/supabase'

interface ProjectOption {
  value: string
  label: string
}

interface CreateValues {
  username: string
  fullName: string
  password: string
  projectId: string
}

export function UsersScreen() {
  const [users, setUsers] = useState<GsUser[]>([])
  const [projects, setProjects] = useState<ProjectOption[]>([])
  const [revealed, setRevealed] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [createOpen, setCreateOpen] = useState(false)
  const [pwTarget, setPwTarget] = useState<GsUser | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      setUsers(await listGsUsers())
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
    void supabase
      .from('projects')
      .select('id, name')
      .order('name')
      .then(({ data, error: projectsError }) => {
        if (projectsError) {
          // Every other failure in this screen surfaces through setError; an
          // empty Select with no explanation is the worst of both worlds.
          setError(projectsError.message)
          return
        }
        setProjects((data ?? []).map((p) => ({ value: p.id, label: p.name })))
      })
  }, [refresh])

  const run = async (fn: () => Promise<void>) => {
    try {
      await fn()
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <Space direction="vertical" style={{ width: '100%' }} size="middle">
      {error && <Alert type="error" message={error} closable onClose={() => setError(null)} />}

      <Space>
        <Typography.Title level={4} style={{ margin: 0 }}>
          Người dùng GS
        </Typography.Title>
        <Button type="primary" onClick={() => setCreateOpen(true)}>
          Tạo tài khoản
        </Button>
      </Space>

      <Table<GsUser>
        rowKey="id"
        loading={loading}
        dataSource={users}
        pagination={false}
        columns={[
          { title: 'Tên đăng nhập', dataIndex: 'username' },
          { title: 'Họ tên', dataIndex: 'fullName' },
          { title: 'Dự án', dataIndex: 'projectName', render: (v: string | null) => v ?? '—' },
          {
            title: 'Trạng thái',
            dataIndex: 'active',
            render: (active: boolean) => (active ? 'Đang dùng' : 'Đã tắt'),
          },
          {
            title: 'Mật khẩu',
            key: 'password',
            render: (_, user) =>
              revealed[user.id] ? (
                <Space>
                  <Typography.Text copyable code>
                    {revealed[user.id]}
                  </Typography.Text>
                  <Button
                    size="small"
                    onClick={() =>
                      setRevealed((prev) => {
                        // A revealed password otherwise stays on screen for
                        // the rest of the mount — this closes that window
                        // back down after the deliberate look.
                        const next = { ...prev }
                        delete next[user.id]
                        return next
                      })
                    }
                  >
                    Ẩn
                  </Button>
                </Space>
              ) : (
                <Button
                  size="small"
                  onClick={() =>
                    void run(async () => {
                      const pw = await revealPassword(user.id)
                      setRevealed((prev) => ({ ...prev, [user.id]: pw }))
                    })
                  }
                >
                  Xem mật khẩu
                </Button>
              ),
          },
          {
            title: '',
            key: 'actions',
            render: (_, user) => (
              <Space>
                <Button size="small" onClick={() => setPwTarget(user)}>
                  Đổi mật khẩu
                </Button>
                <Popconfirm
                  title="Vô hiệu hoá tài khoản này?"
                  description="Không thể hoàn tác trong phiên bản này."
                  okText="Vô hiệu hoá"
                  cancelText="Huỷ"
                  disabled={!user.active}
                  onConfirm={() =>
                    void run(async () => {
                      await deactivateGsUser(user.id)
                      await refresh()
                    })
                  }
                >
                  <Switch
                    checked={user.active}
                    checkedChildren="Bật"
                    unCheckedChildren="Tắt"
                    disabled={!user.active}
                  />
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />

      <Modal
        open={createOpen}
        title="Tạo tài khoản GS"
        onCancel={() => setCreateOpen(false)}
        footer={null}
        destroyOnClose
      >
        <Form<CreateValues>
          layout="vertical"
          onFinish={(values) =>
            void run(async () => {
              await createGsUser(values)
              setCreateOpen(false)
              await refresh()
            })
          }
        >
          <Form.Item name="username" label="Tên đăng nhập" rules={[{ required: true, message: 'Nhập tên đăng nhập' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="fullName" label="Họ tên" rules={[{ required: true, message: 'Nhập họ tên' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="password" label="Mật khẩu" rules={[{ required: true, message: 'Nhập mật khẩu' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="projectId" label="Dự án" rules={[{ required: true, message: 'Chọn dự án' }]}>
            <Select options={projects} />
          </Form.Item>
          <Button type="primary" htmlType="submit" block>
            Tạo
          </Button>
        </Form>
      </Modal>

      <Modal
        open={pwTarget !== null}
        title={`Đổi mật khẩu — ${pwTarget?.username ?? ''}`}
        onCancel={() => setPwTarget(null)}
        footer={null}
        destroyOnClose
      >
        <Form<{ password: string }>
          layout="vertical"
          onFinish={({ password }) =>
            void run(async () => {
              await setPassword(pwTarget!.id, password)
              setRevealed((prev) => ({ ...prev, [pwTarget!.id]: password }))
              setPwTarget(null)
            })
          }
        >
          <Form.Item name="password" label="Mật khẩu mới" rules={[{ required: true, message: 'Nhập mật khẩu mới' }]}>
            <Input />
          </Form.Item>
          <Button type="primary" htmlType="submit" block>
            Lưu
          </Button>
        </Form>
      </Modal>
    </Space>
  )
}
