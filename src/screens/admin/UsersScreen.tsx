import { EyeOutlined, KeyOutlined, UserAddOutlined, UserDeleteOutlined } from '@ant-design/icons'
import { Alert, App, Button, Form, Input, Modal, Select, Table, Tooltip, Typography } from 'antd'
import dayjs from 'dayjs'
import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../../auth/AuthProvider'
import { ConsequenceModal } from '../../components/ConsequenceModal'
import { PageBody, PageHeader } from '../../components/PageHeader'
import { RulesDisclosure } from '../../components/RulesDisclosure'
import { SectionCard } from '../../components/SectionCard'
import { modalStyles } from '../../components/modalChrome'
import { StatusPill } from '../../components/StatusPill'
import {
  createGsUser,
  deactivateGsUser,
  listGsUsers,
  revealPassword,
  setPassword,
  type GsUser,
} from '../../lib/adminApi'
import { initialsOf } from '../../lib/initials'
import { listProjectNames } from '../../lib/projectsApi'
import { palette } from '../../theme'

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

/** How many project chips fit a row before the rest collapse into "+N". */
const CHIPS_SHOWN = 2

const RULES = [
  {
    id: 'USR-R5',
    text: 'Tài khoản chỉ bị tắt, không bị xoá — mọi ghi nhận tiến độ mang tên người này vẫn phải tra được.',
  },
  {
    id: 'USR-R7',
    text: 'Mỗi lần xem mật khẩu đều được ghi vào nhật ký, kèm tên người xem, tài khoản đích và thời điểm.',
  },
]

function ProjectChips({ user }: { user: GsUser }) {
  if (user.projects.length === 0) {
    return <span style={{ color: palette.textTertiary }}>—</span>
  }
  const shown = user.projects.slice(0, CHIPS_SHOWN)
  const rest = user.projects.length - shown.length
  const chip = (label: string, more: boolean) => (
    <span
      key={label}
      style={{
        fontSize: 11.5,
        fontWeight: 500,
        padding: '5px 9px',
        borderRadius: 7,
        whiteSpace: 'nowrap',
        background: more ? 'transparent' : user.active ? palette.bgHover : palette.bgApp,
        border: `1px ${more ? 'dashed' : 'solid'} ${palette.borderCard}`,
        color: user.active ? palette.textSecondary : palette.textQuaternary,
      }}
    >
      {label}
    </span>
  )
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
      {shown.map((p) => chip(p.name, false))}
      {/* The overflow chip names the projects it stands for, so the count is
          not a dead end on the only screen that shows the assignment. */}
      {rest > 0 && (
        <Tooltip title={user.projects.slice(CHIPS_SHOWN).map((p) => p.name).join(' · ')}>
          {chip(`+${rest}`, true)}
        </Tooltip>
      )}
    </div>
  )
}

export function UsersScreen() {
  const { profile } = useAuth()
  const [users, setUsers] = useState<GsUser[]>([])
  const [projects, setProjects] = useState<ProjectOption[]>([])
  const [revealed, setRevealed] = useState<{ user: GsUser; password: string; at: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [createOpen, setCreateOpen] = useState(false)
  const [pwTarget, setPwTarget] = useState<GsUser | null>(null)
  const [offTarget, setOffTarget] = useState<GsUser | null>(null)
  /**
   * A reset the admin has typed but not yet confirmed.
   *
   * The password sits here for the length of one dialog, and the dialog never
   * prints it -- it names the account being locked out, which is the fact the
   * admin has to weigh. Cleared on both exits.
   */
  const [pwPending, setPwPending] = useState<{ user: GsUser; password: string } | null>(null)
  const { message } = App.useApp()
  // Held here rather than submitted from inside the sheet: the actions moved to
  // the dialog's footer strip, which is outside the <Form>.
  const [createForm] = Form.useForm<CreateValues>()
  const [pwForm] = Form.useForm<{ password: string }>()

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
    void listProjectNames()
      .then((data) => {
        setProjects(data.map((p) => ({ value: p.id, label: p.name })))
      })
      .catch((e) => {
        // Every other failure in this screen surfaces through setError; an
        // empty Select with no explanation is the worst of both worlds.
        setError((e as Error).message)
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
    <>
      <PageHeader
        title="Người dùng"
        subtitle="Cấp tài khoản GS, gán dự án, giao mật khẩu. Chỉ tắt, không xoá."
        extra={
          <Button
            type="primary"
            icon={<UserAddOutlined aria-hidden />}
            onClick={() => setCreateOpen(true)}
          >
            Tạo tài khoản GS
          </Button>
        }
      />

      <PageBody>
        {error && <Alert type="error" message={error} closable onClose={() => setError(null)} />}

        <SectionCard bodyPadding={0} footer={<RulesDisclosure rules={RULES} />}>
          <Table<GsUser>
            className="pp-table"
            rowKey="id"
            loading={loading}
            dataSource={users}
            pagination={false}
            columns={[
              {
                title: 'Người dùng',
                key: 'user',
                width: 280,
                render: (_v, user) => (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span
                      style={{
                        width: 34,
                        height: 34,
                        borderRadius: 10,
                        flex: 'none',
                        textAlign: 'center',
                        fontSize: 11,
                        fontWeight: 600,
                        lineHeight: '34px',
                        background: user.active ? palette.bgHover : palette.bgApp,
                        color: user.active ? palette.textSecondary : palette.textQuaternary,
                      }}
                    >
                      {initialsOf(user.fullName)}
                    </span>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600, lineHeight: 1.35 }}>{user.fullName}</div>
                      <span style={{ fontSize: 11, color: palette.textTertiary }}>
                        {user.username}
                      </span>
                    </div>
                  </div>
                ),
              },
              {
                title: 'Dự án',
                key: 'projects',
                render: (_v, user) => <ProjectChips user={user} />,
              },
              {
                title: 'Trạng thái',
                dataIndex: 'active',
                width: 140,
                render: (active: boolean) => (
                  <StatusPill tone={active ? 'ok' : 'off'}>
                    {active ? 'Đang dùng' : 'Đã tắt'}
                  </StatusPill>
                ),
              },
              {
                title: 'Thao tác',
                key: 'actions',
                width: 150,
                align: 'right',
                render: (_v, user) => (
                  <div style={{ display: 'flex', gap: 7, justifyContent: 'flex-end' }}>
                    <Tooltip title="Đặt lại mật khẩu">
                      <Button
                        size="small"
                        aria-label="Đổi mật khẩu"
                        icon={<KeyOutlined />}
                        onClick={() => setPwTarget(user)}
                      />
                    </Tooltip>
                    <Tooltip title="Xem mật khẩu · được ghi log">
                      <Button
                        size="small"
                        aria-label="Xem mật khẩu"
                        icon={<EyeOutlined style={{ color: palette.warning }} />}
                        onClick={() =>
                          void run(async () => {
                            const password = await revealPassword(user.id)
                            setRevealed({ user, password, at: dayjs().format('DD.MM.YYYY HH:mm') })
                          })
                        }
                      />
                    </Tooltip>
                    {user.active && (
                      <Tooltip title="Tắt tài khoản">
                        <Button
                          size="small"
                          danger
                          aria-label="Tắt tài khoản"
                          icon={<UserDeleteOutlined />}
                          onClick={() => setOffTarget(user)}
                        />
                      </Tooltip>
                    )}
                  </div>
                ),
              },
            ]}
          />
        </SectionCard>
      </PageBody>

      {/*
        The reveal lives in a modal rather than in a table cell. A password
        rendered inline stays on screen behind whatever the admin does next --
        scrolling, opening another row, walking away from the laptop -- and
        this screen is used with the customer's own staff in the room.

        Mounted conditionally rather than left mounted with open={false}, which
        is what every other dialog in this app does. antd animates a Modal out
        and only then honours destroyOnHidden, so for the length of that
        animation the closed dialog still holds the password in the DOM. Here
        the whole subtree goes on the same tick the admin dismisses it. The
        cost is the fade-out on one dialog; the gain is that the guarantee does
        not depend on an animation finishing.
      */}
      {revealed !== null && (
      <Modal
        open
        title={`Mật khẩu của ${revealed.user.username}`}
        onCancel={() => setRevealed(null)}
        onOk={() => setRevealed(null)}
        okText="Đã ghi nhận"
        cancelButtonProps={{ style: { display: 'none' } }}
        styles={modalStyles}
        destroyOnHidden
      >
        <p style={{ marginTop: 0, fontSize: 13, lineHeight: 1.5, color: palette.textSecondary }}>
          Mỗi lần xem đều được ghi log kèm tên bạn, tài khoản đích và thời điểm. Log chỉ ghi thêm.
        </p>
        <div
          style={{
            minHeight: 52,
            border: `1px solid ${palette.border}`,
            borderRadius: 11,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '0 12px 0 15px',
            background: palette.bgSubtle,
          }}
        >
          <Typography.Text copyable style={{ fontFamily: 'inherit' }}>
            <span style={{ fontSize: 16, fontWeight: 600, letterSpacing: '0.06em' }}>
              {revealed.password}
            </span>
          </Typography.Text>
        </div>
        <span style={{ display: 'block', marginTop: 9, fontSize: 11, color: palette.textTertiary }}>
          {`Đã ghi log · ${revealed.at} · ${profile?.fullName ?? ''} → ${revealed.user.username}`}
        </span>
      </Modal>
      )}

      <ConsequenceModal
        open={offTarget !== null}
        tone="danger"
        tag="Thao tác phá huỷ"
        title={`Tắt tài khoản ${offTarget?.username ?? ''}?`}
        description="Tài khoản sẽ bị tắt, không bị xoá:"
        items={
          offTarget
            ? [
                {
                  label: offTarget.fullName,
                  meta: offTarget.projects.map((p) => p.name).join(' · ') || 'chưa gán dự án',
                },
              ]
            : []
        }
        consequence="GS mất quyền truy cập ngay. Toàn bộ lịch sử ghi nhận mang tên người này vẫn còn — vì thế hệ thống chỉ tắt, không xoá (USR-R5). Phiên bản này chưa bật lại được."
        okText="Vẫn tắt"
        onCancel={() => setOffTarget(null)}
        onOk={() =>
          void run(async () => {
            await deactivateGsUser(offTarget!.id)
            setOffTarget(null)
            await refresh()
            message.success('Đã tắt tài khoản')
          })
        }
      />

      <Modal
        open={createOpen}
        title="Tạo tài khoản GS"
        onCancel={() => setCreateOpen(false)}
        styles={modalStyles}
        destroyOnHidden
        footer={[
          <Button key="cancel" onClick={() => setCreateOpen(false)}>
            Huỷ
          </Button>,
          <Button key="ok" type="primary" onClick={() => createForm.submit()}>
            Tạo
          </Button>,
        ]}
      >
        <Form<CreateValues>
          form={createForm}
          layout="vertical"
          onFinish={(values) =>
            void run(async () => {
              await createGsUser(values)
              setCreateOpen(false)
              await refresh()
              message.success('Đã tạo tài khoản GS')
            })
          }
        >
          <Form.Item
            name="username"
            label="Tên đăng nhập"
            rules={[{ required: true, message: 'Nhập tên đăng nhập' }]}
          >
            <Input placeholder="Ví dụ: gs.hieu" />
          </Form.Item>
          <Form.Item name="fullName" label="Họ tên" rules={[{ required: true, message: 'Nhập họ tên' }]}>
            <Input placeholder="Ví dụ: Lê Trung Hiếu" />
          </Form.Item>
          <Form.Item
            name="password"
            label="Mật khẩu"
            rules={[{ required: true, message: 'Nhập mật khẩu' }]}
            extra="Bạn giao mật khẩu này cho GS. Xem lại được, nhưng mỗi lần xem đều ghi log."
          >
            <Input placeholder="Nhập mật khẩu" />
          </Form.Item>
          <Form.Item name="projectId" label="Dự án" rules={[{ required: true, message: 'Chọn dự án' }]}>
            <Select options={projects} placeholder="Chọn dự án" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={pwTarget !== null}
        title={`Đổi mật khẩu — ${pwTarget?.username ?? ''}`}
        onCancel={() => setPwTarget(null)}
        styles={modalStyles}
        destroyOnHidden
        footer={[
          <Button key="cancel" onClick={() => setPwTarget(null)}>
            Huỷ
          </Button>,
          <Button key="ok" type="primary" onClick={() => pwForm.submit()}>
            Lưu
          </Button>,
        ]}
      >
        <Form<{ password: string }>
          form={pwForm}
          layout="vertical"
          // Submitting the form asks; it does not write. The write is behind
          // the dialog below, because the moment it lands the foreman on the
          // platform is locked out with no way to know why.
          onFinish={({ password }) => {
            setPwPending({ user: pwTarget!, password })
            setPwTarget(null)
          }}
        >
          <Form.Item
            name="password"
            label="Mật khẩu mới"
            rules={[{ required: true, message: 'Nhập mật khẩu mới' }]}
            extra="Mật khẩu cũ ngừng hiệu lực ngay. GS không đăng nhập được cho tới khi bạn giao mật khẩu mới."
          >
            <Input placeholder="Nhập mật khẩu mới" />
          </Form.Item>
        </Form>
      </Modal>

      <ConsequenceModal
        open={pwPending !== null}
        tone="danger"
        tag="Thao tác phá huỷ"
        title={`Đổi mật khẩu cho ${pwPending?.user.username ?? ''}?`}
        description="Mật khẩu cũ ngừng hiệu lực ngay khi bạn xác nhận:"
        items={
          pwPending
            ? [
                {
                  label: pwPending.user.fullName,
                  meta: pwPending.user.projects.map((p) => p.name).join(' · ') || 'chưa gán dự án',
                },
              ]
            : []
        }
        consequence="GS đang cầm mật khẩu cũ sẽ không đăng nhập được và không nhận được thông báo nào. Anh phải giao mật khẩu mới cho họ. Mật khẩu mới hiện ra ngay sau bước này."
        okText="Vẫn đổi"
        onCancel={() => setPwPending(null)}
        onOk={() =>
          void run(async () => {
            const { user, password } = pwPending!
            await setPassword(user.id, password)
            setPwPending(null)
            // Straight into the reveal modal: the admin has to read this value
            // out to the foreman, and it appears nowhere else.
            setRevealed({ user, password, at: dayjs().format('DD.MM.YYYY HH:mm') })
            message.success('Đã đặt lại mật khẩu')
          })
        }
      />
    </>
  )
}
