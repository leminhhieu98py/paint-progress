import { Alert, Button, Form, Input, Modal, Radio, Select } from 'antd'
import { useState } from 'react'
import { ConsequenceModal, type ConsequenceItem, type ConsequenceTone } from '../../components/ConsequenceModal'
import { modalProps } from '../../components/modalChrome'
import { searchSelectProps } from '../../components/searchSelect'
import { changeRole, type StaffRole } from '../../lib/adminApi'
import { generatePassword } from '../../lib/passwordGen'
import { PasswordInput } from './PasswordInput'
import { ROLE_DESCRIPTION, ROLE_LABEL, loginClash, nameClash, parkedAccountFor, type StaffRow } from './nhanLuc'
import { PASSWORD_RULES, RADIOGROUP, ROLE_RADIOS, USERNAME_RULES, clashRule, type ProjectOption } from './nhanLucForm'

interface ChangeValues {
  role: StaffRole
  username?: string
  password?: string
  projectId?: string
}

type Request = Parameters<typeof changeRole>[0]

interface Pending {
  request: Request
  tone: ConsequenceTone
  title: string
  description: string
  /** Who or what the change is about. */
  items: ConsequenceItem[]
  /** What happens on confirm, one item each (RUL-01). */
  consequences: string[]
}

/**
 * "Đổi phân quyền" (NL-04), in two steps like a password reset: the new role
 * and what it needs, then a confirmation that says exactly what will happen,
 * and only then the write. Nhân viên → GS/Visitor asks for a login and a
 * password (and a project for a GS) -- or only the password when a hidden
 * account of the same name is waiting to be re-opened (ruling A1).
 * GS/Visitor → Nhân viên asks nothing: the account is locked and hidden.
 * Visitor → GS asks for a project, and its confirmation names every project
 * the account will write to, the memberships it keeps included.
 *
 * A refusal from the server brings the admin back to the first step with
 * everything still typed and the reason at the top (review minor 4).
 */
export function ChangeRoleDialog({
  row, rows, projects, onClose, onDone,
}: {
  row: StaffRow
  rows: StaffRow[]
  projects: ProjectOption[]
  onClose: () => void
  onDone: (message: string) => void
}) {
  const [form] = Form.useForm<ChangeValues>()
  const target: StaffRole = Form.useWatch('role', form) ?? row.role
  const [pending, setPending] = useState<Pending | null>(null)
  const [saving, setSaving] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  const becomesAccount = row.kind === 'employee' && target !== 'employee'
  const parked = becomesAccount ? parkedAccountFor(rows, row.fullName) : null
  const needsProject = target === 'gs' && (row.kind === 'employee' || row.role === 'viewer')
  const projectName = (id?: string) => projects.find((p) => p.value === id)?.label ?? ''
  // An account can only become an employee whose name is free (0037); only a
  // hidden account can meet one, so say it here rather than after the round
  // trip (review minor 3).
  const employeeClash = row.kind === 'account' && target === 'employee'
    ? nameClash(rows, row.fullName, 'employee', row.key)
    : null

  const confirm = (values: ChangeValues) => {
    const role = values.role
    const request: Request = { kind: row.kind, id: row.id, role }
    if (row.kind === 'employee' && role !== 'employee') {
      if (!parked) request.username = (values.username ?? '').trim().toLowerCase()
      request.password = values.password
    }
    if (needsProject) request.projectId = values.projectId
    const scope = role === 'gs' ? projectName(values.projectId) : 'Mọi dự án'

    if (row.kind === 'employee') {
      setPending(parked
        ? {
            request, tone: 'warn',
            title: `Đổi ${row.fullName} thành ${ROLE_LABEL[role]}?`,
            description: 'Dòng nhân viên được thay bằng tài khoản đã ẩn cùng tên:',
            items: [
              { label: `Mở lại tài khoản ${parked.username}`, meta: scope },
            ],
            consequences: [
              'Tài khoản cũ mở khoá với mật khẩu mới',
              'Không còn trong ô chọn nhóm trưởng, thợ chính của GS',
              'Các lần cập nhật đã ghi vẫn giữ tên',
            ],
          }
        : {
            request, tone: 'warn',
            title: `Đổi ${row.fullName} thành ${ROLE_LABEL[role]}?`,
            description: 'Dòng nhân viên được thay bằng tài khoản:',
            items: [
              { label: `Tài khoản mới ${request.username}`, meta: scope },
            ],
            consequences: [
              'Đăng nhập được bằng tài khoản mới',
              'Không còn trong ô chọn nhóm trưởng, thợ chính của GS',
              'Các lần cập nhật đã ghi vẫn giữ tên',
            ],
          })
      return
    }
    const who = { label: row.fullName, meta: row.account.username }
    if (role === 'employee') {
      setPending({
        request, tone: 'danger',
        title: `Đổi ${row.account.username} thành Nhân viên?`,
        description: 'Tài khoản bị khoá và ẩn, không bị xoá:',
        items: [who],
        consequences: [
          'Không đăng nhập được nữa',
          'Lịch sử ghi nhận vẫn mang tên người này',
          'Một nhân viên đang làm cùng tên vào ô chọn của GS',
          'Đổi lại thành GS hoặc Visitor là mở lại đúng tài khoản này',
        ],
      })
    } else if (role === 'viewer') {
      setPending({
        request, tone: 'warn',
        title: `Đổi ${row.account.username} thành Visitor?`,
        description: 'Phân quyền của tài khoản đổi thành Visitor:',
        items: [who],
        consequences: [
          'Xem được mọi dự án và công việc',
          'Không ghi được tiến độ nữa',
          // Memberships are kept across GS ↔ Visitor, unused while a Visitor.
          'Dự án đã gán được giữ lại, không dùng khi là Visitor',
        ],
      })
    } else {
      // Memberships are kept across GS ↔ Visitor, so a Visitor becoming a GS
      // writes again to every project it ever held -- listed, not implied
      // (review minor 2).
      const kept = row.account.projects
      const items: ConsequenceItem[] = [
        ...(kept.some((p) => p.id === values.projectId) ? [] : [{ label: scope, meta: 'mới gán' }]),
        ...kept.map((p) => ({
          label: p.name,
          meta: p.allWorks ? 'giữ lại · mọi công việc' : `giữ lại · ${p.workIds.length}/${p.workCount} công việc`,
        })),
      ]
      setPending({
        request, tone: 'warn',
        title: `Đổi ${row.account.username} thành GS?`,
        description: 'Tài khoản thành GS, ghi được tiến độ ở các dự án này:',
        items,
        consequences: [
          // A Visitor sees every project (0034); a GS only its own.
          'Không còn xem được dự án ngoài các dự án trên',
          'Bỏ bớt dự án bằng nút «Dự án và công việc» sau khi đổi',
        ],
      })
    }
  }

  const write = async () => {
    if (!pending) return
    setSaving(true)
    setFailure(null)
    try {
      const result = await changeRole(pending.request)
      const { role } = pending.request
      onDone(
        row.kind === 'employee'
          ? `${result.reactivated ? 'Đã mở lại tài khoản' : 'Đã tạo tài khoản'} ${result.username ?? ''}`.trim()
          : role === 'employee' ? 'Đã chuyển thành nhân viên' : 'Đã đổi phân quyền',
      )
    } catch (e) {
      setPending(null)
      setFailure((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Modal
        open={pending === null}
        title={`Đổi phân quyền · ${row.fullName}`}
        onCancel={onClose}
        {...modalProps}
        // Mounted while the confirmation is up, so Huỷ there comes back to
        // what was typed.
        destroyOnHidden={false}
        footer={[
          <Button key="cancel" onClick={onClose}>Huỷ</Button>,
          <Button
            key="ok"
            type="primary"
            disabled={target === row.role || employeeClash !== null}
            onClick={() => form.submit()}
          >
            Tiếp tục
          </Button>,
        ]}
      >
        {failure && <Alert type="error" showIcon message={failure} style={{ marginBottom: 12 }} />}
        <Form<ChangeValues>
          form={form}
          layout="vertical"
          initialValues={{ role: row.role }}
          onFinish={confirm}
        >
          <Form.Item name="role" label="Phân quyền mới" extra={ROLE_DESCRIPTION[target]}>
            <Radio.Group {...RADIOGROUP} aria-label="Phân quyền mới" options={ROLE_RADIOS} />
          </Form.Item>
          {employeeClash && <Alert type="error" showIcon message={employeeClash} style={{ marginBottom: 16 }} />}
          {becomesAccount && (
            <>
              {parked ? (
                <Alert
                  type="info"
                  showIcon
                  style={{ marginBottom: 16 }}
                  message={`Mở lại tài khoản đã ẩn ${parked.username}`}
                />
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
            <Form.Item name="projectId" label="Dự án" rules={[{ required: true, message: 'Chọn dự án' }]}>
              <Select options={projects} placeholder="Chọn dự án" {...searchSelectProps} />
            </Form.Item>
          )}
        </Form>
      </Modal>

      <ConsequenceModal
        open={pending !== null}
        tone={pending?.tone ?? 'warn'}
        tag="Xác nhận"
        title={pending?.title ?? ''}
        description={pending?.description}
        items={pending?.items ?? []}
        consequences={pending?.consequences}
        okText="Vẫn đổi"
        confirmLoading={saving}
        onCancel={() => setPending(null)}
        onOk={() => void write()}
      />
    </>
  )
}
