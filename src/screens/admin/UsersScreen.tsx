import {
  EditOutlined, EyeInvisibleOutlined, EyeOutlined, KeyOutlined, LockOutlined, ReloadOutlined,
  TeamOutlined, UnlockOutlined, UserAddOutlined,
} from '@ant-design/icons'
import {
  Alert, App, Button, Checkbox, Form, Input, Modal, Segmented, Select, Space, Switch, Table, Tooltip,
  Typography,
} from 'antd'
import dayjs from 'dayjs'
import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../../auth/AuthProvider'
import { ConsequenceModal } from '../../components/ConsequenceModal'
import { PageBody, PageHeader } from '../../components/PageHeader'
import { RulesDisclosure } from '../../components/RulesDisclosure'
import { SectionCard } from '../../components/SectionCard'
import { modalProps } from '../../components/modalChrome'
import { StatusPill } from '../../components/StatusPill'
import {
  createGsUser,
  deactivateGsUser,
  hideUser,
  listGsUsers,
  reactivateUser,
  renameUser,
  revealPassword,
  setMemberships,
  setPassword,
  unhideUser,
  type AccountRole,
  type GsUser,
  type MembershipDraft,
} from '../../lib/adminApi'
import { initialsOf } from '../../lib/initials'
import { MIN_PASSWORD_LENGTH, generatePassword } from '../../lib/passwordGen'
import { listProjectNames } from '../../lib/projectsApi'
import { listWorks } from '../../lib/worksApi'
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
  role: AccountRole
}

const ROLE_LABEL: Record<AccountRole, string> = { gs: 'GS', viewer: 'Chỉ xem' }

/** How many project chips fit a row before the rest collapse into "+N". */
const CHIPS_SHOWN = 2

const RULES = [
  {
    id: 'USR-R5',
    text: 'Tài khoản chỉ bị khoá hoặc ẩn, không bị xoá — mọi ghi nhận tiến độ mang tên người này vẫn phải tra được.',
  },
  {
    id: 'USR-R7',
    text: 'Mỗi lần xem mật khẩu đều được ghi vào nhật ký, kèm tên người xem, tài khoản đích và thời điểm.',
  },
  {
    id: 'USR-R8',
    text: 'Tài khoản Chỉ xem đọc được đúng những gì một GS cùng dự án đọc được, tải được báo cáo, nhưng không ghi được gì.',
  },
  {
    id: 'USR-R9',
    text: 'Giới hạn công việc chỉ thu hẹp những gì tài khoản thấy: sàn vẫn hiện, công việc không được gán thì không hiện tiến độ.',
  },
]

function ProjectChips({ user }: { user: GsUser }) {
  if (user.projects.length === 0) {
    return <span style={{ color: palette.textTertiary }}>—</span>
  }
  const shown = user.projects.slice(0, CHIPS_SHOWN)
  const rest = user.projects.length - shown.length
  // A restricted membership says how much of the project it sees (item 1c);
  // the common case -- every work -- stays a bare name.
  const labelOf = (p: GsUser['projects'][number]) =>
    p.allWorks ? p.name : `${p.name} · ${p.workIds.length}/${p.workCount} công việc`
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
      {shown.map((p) => chip(labelOf(p), false))}
      {/* The overflow chip names the projects it stands for, so the count is
          not a dead end on the only screen that shows the assignment. */}
      {rest > 0 && (
        <Tooltip title={user.projects.slice(CHIPS_SHOWN).map(labelOf).join(' · ')}>
          {chip(`+${rest}`, true)}
        </Tooltip>
      )}
    </div>
  )
}

interface PermissionRow {
  member: boolean
  allWorks: boolean
  workIds: string[]
}

/**
 * "Phân quyền": one dialog per account, one line per project (items 1b, 1c).
 *
 * Membership, and within it either every work or the listed ones. Saved as
 * one statement through setMemberships, so what the admin sees on Lưu is
 * exactly what the account gets -- no per-checkbox writes that can leave the
 * two halves disagreeing when the tether drops mid-way.
 */
function PermissionsDialog({
  user, projects, onClose, onSaved, onError,
}: {
  user: GsUser
  projects: ProjectOption[]
  onClose: () => void
  onSaved: () => Promise<void>
  onError: (message: string) => void
}) {
  const [rows, setRows] = useState<Record<string, PermissionRow>>(() =>
    Object.fromEntries(projects.map((p) => {
      const current = user.projects.find((m) => m.id === p.value)
      return [p.value, {
        member: Boolean(current),
        allWorks: current?.allWorks ?? true,
        workIds: current?.workIds ?? [],
      }]
    })),
  )
  const [works, setWorks] = useState<Record<string, { value: string; label: string }[]>>({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    void Promise.all(projects.map(async (p) => [p.value, await listWorks(p.value)] as const))
      .then((pairs) => {
        if (cancelled) return
        setWorks(Object.fromEntries(
          pairs.map(([id, list]) => [id, list.map((w) => ({ value: w.id, label: w.name }))]),
        ))
      })
      .catch((e) => onError((e as Error).message))
    return () => { cancelled = true }
  }, [projects, onError])

  const patch = (projectId: string, change: Partial<PermissionRow>) =>
    setRows((prev) => ({ ...prev, [projectId]: { ...prev[projectId], ...change } }))

  const save = async () => {
    setSaving(true)
    try {
      const drafts: MembershipDraft[] = projects
        .filter((p) => rows[p.value]?.member)
        .map((p) => ({
          projectId: p.value,
          allWorks: rows[p.value].allWorks,
          workIds: rows[p.value].allWorks ? [] : rows[p.value].workIds,
        }))
      await setMemberships(user.id, drafts)
      await onSaved()
    } catch (e) {
      onError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      title={`Phân quyền · ${user.username}`}
      onCancel={onClose}
      width={640}
      {...modalProps}
      footer={[
        <Button key="cancel" onClick={onClose}>Huỷ</Button>,
        <Button key="ok" type="primary" loading={saving} onClick={() => void save()}>Lưu quyền</Button>,
      ]}
    >
      <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 12, fontSize: 12 }}>
        Tick dự án tài khoản được vào. Trong mỗi dự án, để «Tất cả công việc» hoặc chọn đúng những công việc được thấy (USR-R9).
      </Typography.Text>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {projects.map((p) => {
          const row = rows[p.value]
          return (
            <div
              key={p.value}
              style={{
                border: `1px solid ${palette.borderCard}`,
                borderRadius: 10,
                padding: '10px 12px',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              <Checkbox
                aria-label={`Thành viên ${p.label}`}
                checked={row?.member ?? false}
                onChange={(e) => patch(p.value, { member: e.target.checked })}
              >
                <span style={{ fontWeight: 600 }}>{p.label}</span>
              </Checkbox>
              {row?.member && (
                <Space size={12} wrap>
                  <Space size={6}>
                    <Switch
                      size="small"
                      aria-label={`Tất cả công việc ${p.label}`}
                      checked={row.allWorks}
                      onChange={(on) => patch(p.value, { allWorks: on })}
                    />
                    <span style={{ fontSize: 12 }}>Tất cả công việc</span>
                  </Space>
                  {!row.allWorks && (
                    <Select
                      mode="multiple"
                      aria-label={`Công việc ${p.label}`}
                      placeholder="Chọn công việc"
                      // Typing filters by the work's NAME. antd's default
                      // filters by value, which here is a uuid: every
                      // keystroke produced "No data" in Chrome.
                      optionFilterProp="label"
                      style={{ minWidth: 260 }}
                      value={row.workIds}
                      onChange={(ids) => patch(p.value, { workIds: ids })}
                      options={works[p.value] ?? []}
                    />
                  )}
                </Space>
              )}
            </div>
          )
        })}
      </div>
    </Modal>
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
  const [hideTarget, setHideTarget] = useState<GsUser | null>(null)
  const [renameTarget, setRenameTarget] = useState<GsUser | null>(null)
  const [permTarget, setPermTarget] = useState<GsUser | null>(null)
  /** Hidden accounts (0028) stay out of the list until asked for. */
  const [showHidden, setShowHidden] = useState(false)
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
  const [renameForm] = Form.useForm<{ username: string }>()

  /** Every dismissal path of the create dialog -- X, mask, Escape, Huỷ. */
  const closeCreate = () => {
    setCreateOpen(false)
    createForm.resetFields()
  }
  /** Same for the reset dialog, and it clears a password out of memory. */
  const closePw = () => {
    setPwTarget(null)
    pwForm.resetFields()
  }

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      setUsers(await listGsUsers(showHidden))
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [showHidden])

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
  const reportError = useCallback((m: string) => setError(m), [])

  const statusOf = (user: GsUser) =>
    user.hidden
      ? <StatusPill tone="off">Đã ẩn</StatusPill>
      : user.active
        ? <StatusPill tone="ok">Đang dùng</StatusPill>
        : <StatusPill tone="off">Đã khoá</StatusPill>

  return (
    <>
      <PageHeader
        title="Người dùng"
        subtitle="Cấp tài khoản GS và Chỉ xem, gán dự án và công việc, giao mật khẩu. Khoá hoặc ẩn, không xoá."
        extra={
          <Space size={12}>
            <Space size={6}>
              <Switch
                size="small"
                aria-label="Hiện tài khoản đã ẩn"
                checked={showHidden}
                onChange={setShowHidden}
              />
              <span style={{ fontSize: 12, color: palette.textSecondary }}>Hiện tài khoản đã ẩn</span>
            </Space>
            <Button
              type="primary"
              icon={<UserAddOutlined aria-hidden />}
              onClick={() => { createForm.resetFields(); setCreateOpen(true) }}
            >
              Tạo tài khoản
            </Button>
          </Space>
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
                        <Button
                          type="text"
                          size="small"
                          aria-label="Đổi tên đăng nhập"
                          icon={<EditOutlined style={{ fontSize: 11 }} />}
                          style={{ marginLeft: 2, height: 18, width: 18, minWidth: 18 }}
                          onClick={() => {
                            renameForm.setFieldsValue({ username: user.username })
                            setRenameTarget(user)
                          }}
                        />
                      </span>
                    </div>
                  </div>
                ),
              },
              {
                title: 'Loại',
                dataIndex: 'role',
                width: 90,
                render: (role: AccountRole) => ROLE_LABEL[role],
              },
              {
                title: 'Dự án',
                key: 'projects',
                render: (_v, user) => <ProjectChips user={user} />,
              },
              {
                title: 'Trạng thái',
                key: 'status',
                width: 120,
                render: (_v, user) => statusOf(user),
              },
              {
                title: 'Thao tác',
                key: 'actions',
                width: 220,
                align: 'right',
                render: (_v, user) => (
                  <div style={{ display: 'flex', gap: 7, justifyContent: 'flex-end' }}>
                    <Tooltip title="Phân quyền dự án và công việc">
                      <Button
                        size="small"
                        aria-label="Phân quyền"
                        icon={<TeamOutlined />}
                        onClick={() => setPermTarget(user)}
                      />
                    </Tooltip>
                    <Tooltip title="Đặt lại mật khẩu">
                      <Button
                        size="small"
                        aria-label="Đổi mật khẩu"
                        icon={<KeyOutlined />}
                        onClick={() => { pwForm.resetFields(); setPwTarget(user) }}
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
                    {user.active ? (
                      <Tooltip title="Khoá tài khoản">
                        <Button
                          size="small"
                          danger
                          aria-label="Khoá tài khoản"
                          icon={<LockOutlined />}
                          onClick={() => setOffTarget(user)}
                        />
                      </Tooltip>
                    ) : (
                      !user.hidden && (
                        <Tooltip title="Mở khoá · đăng nhập lại được, dự án giữ nguyên">
                          <Button
                            size="small"
                            aria-label="Mở khoá"
                            icon={<UnlockOutlined />}
                            onClick={() =>
                              void run(async () => {
                                await reactivateUser(user.id)
                                await refresh()
                                message.success('Đã mở khoá tài khoản')
                              })
                            }
                          />
                        </Tooltip>
                      )
                    )}
                    {user.hidden ? (
                      <Button
                        size="small"
                        onClick={() =>
                          void run(async () => {
                            await unhideUser(user.id)
                            await refresh()
                            message.success('Đã hiện lại tài khoản')
                          })
                        }
                      >
                        Hiện lại
                      </Button>
                    ) : (
                      <Tooltip title="Ẩn khỏi danh sách · không xoá">
                        <Button
                          size="small"
                          aria-label="Ẩn tài khoản"
                          icon={<EyeInvisibleOutlined />}
                          onClick={() => setHideTarget(user)}
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
        {...modalProps}
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
          {/*
            `copyable={{ text }}`, not a bare `copyable`. antd copies its own
            children when no text is given, and children here is a React
            element -- so the clipboard got "[object Object]" and the admin
            pasted that into the message they were sending the foreman.
          */}
          <Typography.Text
            copyable={{ text: revealed.password, tooltips: ['Sao chép', 'Đã sao chép'] }}
            style={{ fontFamily: 'inherit' }}
          >
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
        tag="Xác nhận"
        title={`Khoá tài khoản ${offTarget?.username ?? ''}?`}
        description="Tài khoản sẽ bị khoá, không bị xoá:"
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
        consequence="Tài khoản không đăng nhập được nữa và mất quyền truy cập ngay. Dự án và công việc đã gán giữ nguyên, mở khoá là dùng lại được. Lịch sử ghi nhận mang tên người này vẫn còn (USR-R5)."
        okText="Vẫn khoá"
        onCancel={() => setOffTarget(null)}
        onOk={() =>
          void run(async () => {
            await deactivateGsUser(offTarget!.id)
            setOffTarget(null)
            await refresh()
            message.success('Đã khoá tài khoản')
          })
        }
      />

      <ConsequenceModal
        open={hideTarget !== null}
        tone="danger"
        tag="Xác nhận"
        title={`Ẩn tài khoản ${hideTarget?.username ?? ''}?`}
        description="Tài khoản sẽ bị khoá và ẩn khỏi danh sách, không bị xoá:"
        items={
          hideTarget
            ? [{
                label: hideTarget.fullName,
                meta: hideTarget.projects.map((p) => p.name).join(' · ') || 'chưa gán dự án',
              }]
            : []
        }
        consequence="Mọi ghi chú và lịch sử ghi nhận vẫn mang tên người này (USR-R5). Bật «Hiện tài khoản đã ẩn» để tìm lại và mở khoá khi cần."
        okText="Vẫn ẩn"
        onCancel={() => setHideTarget(null)}
        onOk={() =>
          void run(async () => {
            await hideUser(hideTarget!.id)
            setHideTarget(null)
            await refresh()
            message.success('Đã ẩn tài khoản')
          })
        }
      />

      <Modal
        open={renameTarget !== null}
        title={`Đổi tên đăng nhập — ${renameTarget?.username ?? ''}`}
        onCancel={() => setRenameTarget(null)}
        {...modalProps}
        footer={[
          <Button key="cancel" onClick={() => setRenameTarget(null)}>Huỷ</Button>,
          <Button key="ok" type="primary" onClick={() => renameForm.submit()}>Lưu</Button>,
        ]}
      >
        <Form<{ username: string }>
          form={renameForm}
          layout="vertical"
          onFinish={({ username }) =>
            void run(async () => {
              await renameUser(renameTarget!.id, username.trim().toLowerCase())
              setRenameTarget(null)
              await refresh()
              message.success('Đã đổi tên đăng nhập')
            })
          }
        >
          <Form.Item
            name="username"
            label="Tên đăng nhập mới"
            rules={[
              { required: true, message: 'Nhập tên đăng nhập' },
              { pattern: /^[a-z0-9._-]{3,32}$/i, message: 'Chỉ chữ, số, dấu chấm, gạch ngang, gạch dưới (3-32 ký tự)' },
            ]}
            extra="Mật khẩu giữ nguyên. Từ lần đăng nhập sau, người này dùng tên mới."
          >
            <Input placeholder="Ví dụ: gs.hieu" />
          </Form.Item>
        </Form>
      </Modal>

      {permTarget !== null && (
        <PermissionsDialog
          user={permTarget}
          projects={projects}
          onClose={() => setPermTarget(null)}
          onError={reportError}
          onSaved={async () => {
            setPermTarget(null)
            await refresh()
            message.success('Đã cập nhật quyền')
          }}
        />
      )}

      <Modal
        open={createOpen}
        title="Tạo tài khoản"
        onCancel={closeCreate}
        {...modalProps}
        footer={[
          <Button key="cancel" onClick={closeCreate}>
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
          initialValues={{ role: 'gs' }}
          onFinish={(values) =>
            void run(async () => {
              await createGsUser({ ...values, role: values.role ?? 'gs' })
              setCreateOpen(false)
              await refresh()
              message.success('Đã tạo tài khoản')
            })
          }
        >
          <Form.Item
            name="role"
            label="Loại tài khoản"
            extra="GS ghi tiến độ trên tablet. Chỉ xem dành cho người chỉ cần theo dõi và tải báo cáo (USR-R8)."
          >
            <Segmented
              options={[
                { value: 'gs', label: ROLE_LABEL.gs },
                { value: 'viewer', label: ROLE_LABEL.viewer },
              ]}
            />
          </Form.Item>
          <Form.Item
            name="username"
            label="Tên đăng nhập"
            rules={[
              { required: true, message: 'Nhập tên đăng nhập' },
              { pattern: /^[a-z0-9._-]{3,32}$/i, message: 'Chỉ chữ, số, dấu chấm, gạch ngang, gạch dưới (3-32 ký tự)' },
            ]}
          >
            <Input placeholder="Ví dụ: gs.hieu" />
          </Form.Item>
          <Form.Item name="fullName" label="Họ tên" rules={[{ required: true, message: 'Nhập họ tên' }]}>
            <Input placeholder="Ví dụ: Lê Trung Hiếu" />
          </Form.Item>
          <Form.Item
            name="password"
            label="Mật khẩu"
            rules={[
              { required: true, message: 'Nhập mật khẩu' },
              { min: MIN_PASSWORD_LENGTH, message: `Tối thiểu ${MIN_PASSWORD_LENGTH} ký tự` },
            ]}
            extra="Bạn giao mật khẩu này cho GS. Xem lại được, nhưng mỗi lần xem đều ghi log."
          >
            <Input
              placeholder="Nhập mật khẩu"
              addonAfter={
                /*
                  A rule the admin has to satisfy is a rule the admin works
                  around -- they find the shortest string that passes and reuse
                  it. Not asking them to invent one is the actual fix.
                */
                <Tooltip title="Sinh mật khẩu ngẫu nhiên, dễ đọc qua bộ đàm">
                  <Button
                    type="text"
                    size="small"
                    aria-label="Sinh mật khẩu"
                    icon={<ReloadOutlined aria-hidden />}
                    onClick={() => createForm.setFieldsValue({ password: generatePassword() })}
                  />
                </Tooltip>
              }
            />
          </Form.Item>
          <Form.Item name="projectId" label="Dự án" rules={[{ required: true, message: 'Chọn dự án' }]}>
            <Select options={projects} placeholder="Chọn dự án" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={pwTarget !== null}
        title={`Đổi mật khẩu — ${pwTarget?.username ?? ''}`}
        onCancel={closePw}
        {...modalProps}
        footer={[
          <Button key="cancel" onClick={closePw}>
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
            // The typed password does not outlive the dialog it was typed in.
            // It is already held in `pwPending` for the length of the
            // confirmation; a second copy sitting in a Form store the admin
            // cannot see is a credential with nothing watching it.
            pwForm.resetFields()
          }}
        >
          <Form.Item
            name="password"
            label="Mật khẩu mới"
            rules={[
              { required: true, message: 'Nhập mật khẩu mới' },
              { min: MIN_PASSWORD_LENGTH, message: `Tối thiểu ${MIN_PASSWORD_LENGTH} ký tự` },
            ]}
            extra="Mật khẩu cũ ngừng hiệu lực ngay. GS không đăng nhập được cho tới khi bạn giao mật khẩu mới."
          >
            <Input
              placeholder="Nhập mật khẩu mới"
              addonAfter={
                <Tooltip title="Sinh mật khẩu ngẫu nhiên, dễ đọc qua bộ đàm">
                  <Button
                    type="text"
                    size="small"
                    aria-label="Sinh mật khẩu"
                    icon={<ReloadOutlined aria-hidden />}
                    onClick={() => pwForm.setFieldsValue({ password: generatePassword() })}
                  />
                </Tooltip>
              }
            />
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
