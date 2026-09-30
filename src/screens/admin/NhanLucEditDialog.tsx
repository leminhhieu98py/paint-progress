import { Alert, Button, Checkbox, Form, Input, Modal, Radio, Select, Space, Switch, Typography } from 'antd'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ConsequenceModal } from '../../components/ConsequenceModal'
import { modalProps } from '../../components/modalChrome'
import { searchSelectProps } from '../../components/searchSelect'
import {
  changeRole, renameAccount, renameUser, revealPassword, setMemberships, setPassword,
  type GsUser, type MembershipDraft, type StaffRole,
} from '../../lib/adminApi'
import { updateEmployee } from '../../lib/employeesApi'
import { generatePassword } from '../../lib/passwordGen'
import { listWorks } from '../../lib/worksApi'
import { palette, type } from '../../theme'
import { PasswordInput } from './PasswordInput'
import { ROLE_DESCRIPTION, loginClash, nameClash, parkedAccountFor, type StaffRow } from './nhanLuc'
import {
  MIN_PASSWORD_RULE, PASSWORD_RULES, PROJECTS_FAILED_NOTE, RADIOGROUP, ROLE_RADIOS, USERNAME_RULES, clashRule, type ProjectOption,
} from './nhanLucForm'
import { planRoleChange, roleChangeMessage, type Confirmation, type RoleChangeRequest } from './nhanLucRoleChange'

interface EditValues {
  role: StaffRole
  fullName: string
  username?: string
  password?: string
  projectId?: string
}

interface Membership {
  member: boolean
  allWorks: boolean
  workIds: string[]
}

/** What Lưu does, one step per thing that changed, in this order (NL-09). */
interface Step {
  label: string
  /** The toast when this is the only step. */
  done: string
  run: () => Promise<void>
}

const membershipsOf = (user: GsUser, projects: ProjectOption[]): Record<string, Membership> =>
  Object.fromEntries(projects.map((p) => {
    const current = user.projects.find((m) => m.id === p.value)
    return [p.value, {
      member: Boolean(current),
      allWorks: current?.allWorks ?? true,
      workIds: current?.workIds ?? [],
    }]
  }))

/**
 * The memberships Lưu would save: the listed projects as the matrix has them,
 * then any project of the account the list does not carry, untouched -- a
 * project missing from the list is never read as "not a member" (C1).
 */
const draftsOf = (rows: Record<string, Membership>, projects: ProjectOption[], user: GsUser): MembershipDraft[] => [
  ...projects
    .filter((p) => rows[p.value]?.member)
    .map((p) => ({
      projectId: p.value,
      allWorks: rows[p.value].allWorks,
      workIds: rows[p.value].allWorks ? [] : [...rows[p.value].workIds].sort(),
    })),
  ...user.projects
    .filter((m) => !projects.some((p) => p.value === m.id))
    .map((m) => ({ projectId: m.id, allWorks: m.allWorks, workIds: m.allWorks ? [] : [...m.workIds].sort() })),
]

/**
 * "Sửa" (NL-09): one dialog, the create dialog's fields prefilled, for
 * everything a row used to spread over five icons -- Họ tên, Phân quyền (the
 * change-role flow, NL-04), and for an account its login, its password (a
 * masked field whose eye reveals the stored one only when clicked, logged as the reveal
 * always was; a new one typed or generated replaces it) and, for a GS, its
 * projects and the works within them.
 *
 * Lưu sends only what changed, in a fixed order -- Họ tên, Tên đăng nhập, Mật
 * khẩu, Dự án và công việc, Phân quyền -- behind a confirmation when the role
 * or the password changes. A failure stops there: the dialog stays open with
 * what was typed, and says what was saved and what was not. The client runs
 * the steps rather than one Edge Function action: each already exists, and
 * the Edge Function is not redeployed in this change.
 */
export function NhanLucEditDialog({
  row, rows, projects, projectsFailed = false, onClose, onPartial, onDone,
}: {
  row: StaffRow
  rows: StaffRow[]
  /** Null while the project list is loading, or when it failed: no matrix until it lands (C1). */
  projects: ProjectOption[] | null
  /** The project list failed: only what needs it (the GS matrix, a change to GS) is held back (N1). */
  projectsFailed?: boolean
  onClose: () => void
  /** Some steps were saved before one failed: re-read the list, keep the dialog. */
  onPartial: () => void
  onDone: (result: { message: string; revealed?: { user: GsUser; password: string } }) => void
}) {
  const [form] = Form.useForm<EditValues>()
  const ready = projects !== null
  const list = useMemo(() => projects ?? [], [projects])
  const target: StaffRole = Form.useWatch('role', form) ?? row.role
  const account = row.kind === 'account' ? row.account : null
  const roleChanged = target !== row.role
  /**
   * The row under the name typed: Họ tên is saved before Phân quyền, and the
   * server then looks for a hidden account under the new name, so the plan,
   * its confirmation and the clash check do too (M2).
   */
  const withName = (name: string | undefined): StaffRow => {
    const typed = (name ?? '').trim()
    return typed === '' || typed === row.fullName ? row : { ...row, fullName: typed }
  }
  const named = withName(Form.useWatch('fullName', form))
  /** The account keeps being an account of the same role: its own fields show. */
  const keepsAccount = account !== null && !roleChanged
  /**
   * The memberships as loaded, once the project list is here. The admin's
   * ticks are kept apart, per project, and laid over them: a list that
   * arrives after the dialog opened changes nothing by itself (C1).
   */
  const loadedMemberships = useMemo(
    () => (account && projects ? membershipsOf(account, projects) : {}),
    [account, projects],
  )
  const [edits, setEdits] = useState<Record<string, Membership>>({})
  const memberships = { ...loadedMemberships, ...edits }
  const [works, setWorks] = useState<Record<string, { value: string; label: string }[]>>({})
  /** The stored password, once the field's eye has fetched it (and the fetch logged it). */
  const [stored, setStored] = useState<string | null>(null)
  /** The same, for the length rule: the field changes before the next render (N4). */
  const storedNow = useRef<string | null>(null)
  /**
   * What earlier Lưu presses already saved (M3). The row is the list as it was
   * when the dialog opened, so a retry after a refusal compares against these,
   * re-runs only what is not saved yet, and "Đã lưu" stays true.
   */
  const [savedName, setSavedName] = useState(row.fullName)
  const [savedUsername, setSavedUsername] = useState(account?.username ?? '')
  const [savedPassword, setSavedPassword] = useState<string | null>(null)
  const [savedDrafts, setSavedDrafts] = useState<string | null>(null)
  const [savedLabels, setSavedLabels] = useState<string[]>([])
  const [pending, setPending] = useState<{ confirmation: Confirmation; values: EditValues } | null>(null)
  const [saving, setSaving] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  const showMatrix = keepsAccount && account.role === 'gs'
  useEffect(() => {
    if (!showMatrix || projects === null) return
    let cancelled = false
    void Promise.all(projects.map(async (p) => [p.value, await listWorks(p.value)] as const))
      .then((pairs) => {
        if (cancelled) return
        setWorks(Object.fromEntries(
          pairs.map(([id, list]) => [id, list.map((w) => ({ value: w.id, label: w.name }))]),
        ))
      })
      .catch((e) => { if (!cancelled) setFailure((e as Error).message) })
    return () => { cancelled = true }
  }, [projects, showMatrix])

  // The change-role fields, as NL-04 asks for them.
  const becomesAccount = row.kind === 'employee' && target !== 'employee'
  const parked = becomesAccount ? parkedAccountFor(rows, named.fullName) : null
  const needsProject = target === 'gs' && (row.kind === 'employee' || row.role === 'viewer')
  /**
   * What the missing list holds back (N1): a change to GS needs a project
   * from it; a GS's own dialog waits for its matrix while the list loads (C1),
   * and once it failed saves the other fields without the matrix.
   */
  const heldByList = projects === null && (needsProject || (showMatrix && !projectsFailed))
  const listNote = projectsFailed
    ? PROJECTS_FAILED_NOTE
    : 'Đang tải danh sách dự án…'
  const employeeClash = row.kind === 'account' && target === 'employee'
    ? nameClash(rows, named.fullName, 'employee', row.key)
    : null

  const patch = (projectId: string, change: Partial<Membership>) =>
    setEdits((prev) => ({ ...prev, [projectId]: { ...(prev[projectId] ?? loadedMemberships[projectId]), ...change } }))

  /** The steps Lưu would run for these values, only what changed, in order. */
  const stepsFor = (values: EditValues): Step[] => {
    const steps: Step[] = []
    const name = values.fullName.trim()
    if (name !== savedName) {
      steps.push({
        label: 'Họ tên',
        done: 'Đã đổi tên',
        run: async () => {
          await (row.kind === 'employee' ? updateEmployee(row.id, { fullName: name }) : renameAccount(row.id, name))
          setSavedName(name)
        },
      })
    }
    if (keepsAccount) {
      const username = (values.username ?? '').trim().toLowerCase()
      if (username !== '' && username !== savedUsername) {
        steps.push({
          label: 'Tên đăng nhập',
          done: 'Đã đổi tên đăng nhập',
          run: async () => {
            await renameUser(account.id, username)
            setSavedUsername(username)
          },
        })
      }
      const password = values.password ?? ''
      // The stored password shown by the eye is not a change, nor one already saved.
      if (password !== '' && password !== stored && password !== savedPassword) {
        steps.push({
          label: 'Mật khẩu',
          done: 'Đã đổi mật khẩu',
          run: async () => {
            await setPassword(account.id, password)
            setSavedPassword(password)
          },
        })
      }
      if (account.role === 'gs' && ready) {
        const before = savedDrafts ?? JSON.stringify(draftsOf(loadedMemberships, list, account))
        const after = draftsOf(memberships, list, account)
        if (JSON.stringify(after) !== before) {
          steps.push({
            label: 'Dự án và công việc',
            done: 'Đã cập nhật quyền',
            run: async () => {
              await setMemberships(account.id, after)
              setSavedDrafts(JSON.stringify(after))
            },
          })
        }
      }
    }
    return steps
  }

  const values = Form.useWatch([], form) as EditValues | undefined
  const nothingChanged = values !== undefined && !roleChanged
    && stepsFor({ ...values, fullName: values.fullName ?? row.fullName }).length === 0

  const apply = async (v: EditValues) => {
    const renamed = withName(v.fullName)
    const roleRequest: RoleChangeRequest | null = roleChanged ? planRoleChange(renamed, rows, list, v).request : null
    let roleDone = ''
    const steps = stepsFor(v)
    // The role last: it can turn the row into another kind of row.
    if (roleRequest) {
      steps.push({
        label: 'Phân quyền',
        done: '',
        run: async () => {
          const result = await changeRole(roleRequest)
          roleDone = roleChangeMessage(renamed, roleRequest, result)
        },
      })
    }
    setSaving(true)
    setFailure(null)
    const saved: string[] = []
    for (const step of steps) {
      try {
        await step.run()
        saved.push(step.label)
      } catch (e) {
        const notSaved = steps.slice(saved.length).map((s) => s.label)
        const all = [...savedLabels, ...saved]
        setFailure(
          `${all.length > 0 ? `Đã lưu: ${all.join(', ')}. ` : ''}Chưa lưu: ${notSaved.join(', ')} -- ${(e as Error).message}`,
        )
        setSavedLabels(all)
        setSaving(false)
        setPending(null)
        if (saved.length > 0) onPartial()
        return
      }
    }
    setSaving(false)
    setPending(null)
    // A new password saved now, or by an earlier press, is read out next.
    const password = steps.some((s) => s.label === 'Mật khẩu') ? v.password ?? '' : savedPassword ?? ''
    const all = [...savedLabels, ...saved]
    const login = steps.some((s) => s.label === 'Tên đăng nhập') ? (v.username ?? '').trim().toLowerCase() : savedUsername
    const only = all.length === 1 && steps.length === 1 ? steps[0] : null
    onDone({
      message: roleRequest && only?.label === 'Phân quyền'
        ? roleDone
        : only ? only.done : `Đã lưu: ${all.join(', ')}`,
      // Under the login it has now, when this save (or an earlier one) renamed it (N3).
      ...(password !== '' && account ? { revealed: { user: { ...account, username: login }, password } } : {}),
    })
  }

  const submit = (v: EditValues) => {
    if (roleChanged) {
      setPending({ confirmation: planRoleChange(withName(v.fullName), rows, list, v).confirmation, values: v })
    } else if (keepsAccount && (v.password ?? '') !== '' && v.password !== stored && v.password !== savedPassword) {
      setPending({
        values: v,
        confirmation: {
          tone: 'danger',
          icon: 'key',
          tag: 'Thao tác phá huỷ',
          // The login and name as typed: the same save renames them first (N3).
          title: `Đổi mật khẩu cho ${(v.username ?? '').trim().toLowerCase() || account.username}?`,
          description: 'Mật khẩu cũ ngừng hiệu lực ngay khi anh xác nhận:',
          items: [{
            label: withName(v.fullName).fullName,
            meta: account.role === 'viewer'
              ? 'Mọi dự án'
              : account.projects.map((p) => p.name).join(' · ') || 'chưa gán dự án',
          }],
          consequences: ['Người dùng không nhận được thông báo nào', 'Anh tự giao mật khẩu mới, hiện ra ngay sau bước này'],
        },
      })
    } else {
      void apply(v)
    }
  }

  /** The eye's first look: the stored password, fetched (and so logged) once. */
  const reveal = async (): Promise<string | null> => {
    if (!account) return null
    try {
      const password = await revealPassword(account.id)
      storedNow.current = password
      setStored(password)
      return password
    } catch (e) {
      setFailure((e as Error).message)
      return null
    }
  }

  return (
    <>
      <Modal
        open={pending === null}
        title={`Sửa · ${row.fullName}`}
        onCancel={onClose}
        {...modalProps}
        width={640}
        // Mounted while a confirmation is up, so Huỷ there comes back to what was typed.
        destroyOnHidden={false}
        footer={[
          <Button key="cancel" onClick={onClose}>Huỷ</Button>,
          <Button
            key="ok"
            type="primary"
            loading={saving}
            disabled={heldByList || nothingChanged || employeeClash !== null}
            onClick={() => form.submit()}
          >
            Lưu
          </Button>,
        ]}
      >
        {failure && <Alert type="error" showIcon message={failure} style={{ marginBottom: 12 }} />}
        <Form<EditValues>
          form={form}
          layout="vertical"
          initialValues={{ role: row.role, fullName: row.fullName, username: account?.username }}
          onFinish={submit}
        >
          <Form.Item name="role" label="Phân quyền" extra={ROLE_DESCRIPTION[target]}>
            <Radio.Group {...RADIOGROUP} aria-label="Phân quyền" options={ROLE_RADIOS} />
          </Form.Item>
          {employeeClash && <Alert type="error" showIcon message={employeeClash} style={{ marginBottom: 16 }} />}
          <Form.Item
            name="fullName"
            label="Họ tên"
            rules={[
              { required: true, whitespace: true, message: 'Nhập họ tên' },
              clashRule((v) => nameClash(rows, v, row.kind === 'employee' ? 'employee' : 'account', row.key)),
            ]}
          >
            <Input placeholder="Ví dụ: Lê Trung Hiếu" />
          </Form.Item>

          {keepsAccount && (
            <>
              <Form.Item
                name="username"
                label="Tên đăng nhập"
                extra="Từ lần đăng nhập sau người này dùng tên mới với mật khẩu cũ."
                rules={[...USERNAME_RULES, clashRule((v) => (
                  v.trim().toLowerCase() === account.username ? null : loginClash(rows, v)
                ))]}
              >
                <Input placeholder="Ví dụ: gs.hieu" />
              </Form.Item>
              <Form.Item
                name="password"
                label="Mật khẩu"
                // A new password is checked for length; the stored one the eye
                // shows is not, even when an old account's is shorter (N4).
                rules={[{
                  validator: (_rule, value?: string) => (
                    !value || value === storedNow.current || value.length >= MIN_PASSWORD_RULE.min
                      ? Promise.resolve()
                      : Promise.reject(new Error(MIN_PASSWORD_RULE.message))
                  ),
                }]}
              >
                <PasswordInput
                  placeholder="Để trống: giữ mật khẩu hiện tại"
                  onReveal={reveal}
                  onGenerate={() => form.setFieldsValue({ password: generatePassword() })}
                />
              </Form.Item>
              {account.role === 'viewer' && (
                <Typography.Text>Tài khoản Visitor thấy mọi dự án và mọi công việc.</Typography.Text>
              )}
              {showMatrix && !ready && (
                <Form.Item label="Dự án và công việc">
                  <Typography.Text type="secondary">{listNote}</Typography.Text>
                </Form.Item>
              )}
              {showMatrix && ready && (
                <Form.Item label="Dự án và công việc">
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {list.map((p) => {
                      const m = memberships[p.value]
                      return (
                        <div
                          key={p.value}
                          style={{
                            border: `1px solid ${palette.borderCard}`, borderRadius: 10, padding: '10px 12px',
                            display: 'flex', flexDirection: 'column', gap: 8,
                          }}
                        >
                          <Checkbox
                            aria-label={`Thành viên ${p.label}`}
                            checked={m?.member ?? false}
                            onChange={(e) => patch(p.value, { member: e.target.checked })}
                          >
                            <span style={type.label}>{p.label}</span>
                          </Checkbox>
                          {m?.member && (
                            <Space size={12} wrap>
                              <Space size={6}>
                                <Switch
                                  size="small"
                                  aria-label={`Tất cả công việc ${p.label}`}
                                  checked={m.allWorks}
                                  onChange={(on) => patch(p.value, { allWorks: on })}
                                />
                                <span style={type.body}>Tất cả công việc</span>
                              </Space>
                              {!m.allWorks && (
                                <Select
                                  mode="multiple"
                                  aria-label={`Công việc ${p.label}`}
                                  placeholder="Chọn công việc"
                                  {...searchSelectProps}
                                  style={{ minWidth: 260 }}
                                  value={m.workIds}
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
                </Form.Item>
              )}
            </>
          )}

          {becomesAccount && (
            <>
              {parked ? (
                <Alert type="info" showIcon style={{ marginBottom: 16 }} message={`Mở lại tài khoản đã ẩn ${parked.username}`} />
              ) : (
                <Form.Item
                  name="username"
                  label="Tên đăng nhập"
                  rules={[...USERNAME_RULES, clashRule((v) => loginClash(rows, v))]}
                >
                  <Input placeholder="Ví dụ: gs.hieu" />
                </Form.Item>
              )}
              <Form.Item name="password" label="Mật khẩu" rules={PASSWORD_RULES}>
                <PasswordInput
                  placeholder="Nhập mật khẩu"
                  onGenerate={() => form.setFieldsValue({ password: generatePassword() })}
                />
              </Form.Item>
            </>
          )}
          {needsProject && (
            <Form.Item
              name="projectId"
              label="Dự án"
              rules={[{ required: true, message: 'Chọn dự án' }]}
              extra={ready ? undefined : listNote}
            >
              <Select options={list} placeholder="Chọn dự án" {...searchSelectProps} />
            </Form.Item>
          )}
        </Form>
      </Modal>

      <ConsequenceModal
        open={pending !== null}
        tone={pending?.confirmation.tone ?? 'warn'}
        icon={pending?.confirmation.icon}
        tag={pending?.confirmation.tag ?? 'Xác nhận'}
        title={pending?.confirmation.title ?? ''}
        description={pending?.confirmation.description}
        items={pending?.confirmation.items ?? []}
        consequences={pending?.confirmation.consequences}
        okText="Vẫn đổi"
        confirmLoading={saving}
        onCancel={() => setPending(null)}
        onOk={() => { if (pending) void apply(pending.values) }}
      />
    </>
  )
}
