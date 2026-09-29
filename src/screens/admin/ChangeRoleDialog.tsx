import { Alert, Button, Form, Input, Modal, Radio, Select } from 'antd'
import { useState } from 'react'
import { ConsequenceModal, type ConsequenceItem, type ConsequenceTone } from '../../components/ConsequenceModal'
import { modalProps } from '../../components/modalChrome'
import { searchSelectProps } from '../../components/searchSelect'
import { changeRole, type StaffRole } from '../../lib/adminApi'
import { generatePassword } from '../../lib/passwordGen'
import { PasswordInput } from './PasswordInput'
import { ROLE_DESCRIPTION, ROLE_LABEL, loginClash, parkedAccountFor, type StaffRow } from './nhanLuc'
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
  items: ConsequenceItem[]
  consequence: string
}

/**
 * "Đổi phân quyền" (NL-04), in two steps like a password reset: the new role
 * and what it needs, then a confirmation that says exactly what will happen,
 * and only then the write. Nhân viên → GS/Visitor asks for a login and a
 * password (and a project for a GS) -- or only the password when a hidden
 * account of the same name is waiting to be re-opened (ruling A1).
 * GS/Visitor → Nhân viên asks nothing: the account is locked and hidden.
 * Visitor → GS asks for a project.
 */
export function ChangeRoleDialog({
  row, rows, projects, onClose, onDone, onError,
}: {
  row: StaffRow
  rows: StaffRow[]
  projects: ProjectOption[]
  onClose: () => void
  onDone: (message: string) => void
  onError: (message: string) => void
}) {
  const [form] = Form.useForm<ChangeValues>()
  const target: StaffRole = Form.useWatch('role', form) ?? row.role
  const [pending, setPending] = useState<Pending | null>(null)
  const [saving, setSaving] = useState(false)

  const becomesAccount = row.kind === 'employee' && target !== 'employee'
  const parked = becomesAccount ? parkedAccountFor(rows, row.fullName) : null
  const needsProject = target === 'gs' && (row.kind === 'employee' || row.role === 'viewer')
  const projectName = (id?: string) => projects.find((p) => p.value === id)?.label ?? ''

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
            items: [{ label: `Mở lại tài khoản ${parked.username}`, meta: scope }],
            consequence: 'Tài khoản cũ được mở khoá với mật khẩu mới, không tạo tài khoản thứ hai. Người này không còn trong ô chọn nhóm trưởng, thợ chính của GS; các lần cập nhật đã ghi vẫn giữ tên.',
          }
        : {
            request, tone: 'warn',
            title: `Đổi ${row.fullName} thành ${ROLE_LABEL[role]}?`,
            description: 'Dòng nhân viên được thay bằng tài khoản:',
            items: [{ label: `Tài khoản mới ${request.username}`, meta: scope }],
            consequence: 'Người này đăng nhập được bằng tài khoản mới và không còn trong ô chọn nhóm trưởng, thợ chính của GS. Các lần cập nhật đã ghi vẫn giữ tên.',
          })
      return
    }
    const who = { label: row.fullName, meta: row.account.username }
    if (role === 'employee') {
      setPending({
        request, tone: 'danger',
        title: `Đổi ${row.account.username} thành Nhân viên?`,
        description: 'Tài khoản sẽ bị khoá và ẩn, không bị xoá:',
        items: [who],
        consequence: 'Tài khoản không đăng nhập được nữa; lịch sử ghi nhận vẫn mang tên người này. Một nhân viên đang làm cùng tên được thêm vào ô chọn của GS. Đổi lại thành GS hoặc Visitor sẽ mở lại đúng tài khoản này.',
      })
    } else if (role === 'viewer') {
      setPending({
        request, tone: 'warn',
        title: `Đổi ${row.account.username} thành Visitor?`,
        description: 'Phân quyền của tài khoản đổi thành Visitor:',
        items: [who],
        consequence: 'Tài khoản xem được mọi dự án và mọi công việc nhưng không ghi được tiến độ nữa. Dự án đã gán được giữ lại cho lần đổi về GS.',
      })
    } else {
      setPending({
        request, tone: 'warn',
        title: `Đổi ${row.account.username} thành GS?`,
        description: 'Phân quyền của tài khoản đổi thành GS:',
        items: [{ label: row.fullName, meta: scope }],
        consequence: `Tài khoản ghi được tiến độ và chỉ còn thấy các dự án được gán, trong đó có ${scope}.`,
      })
    }
  }

  const write = async () => {
    if (!pending) return
    setSaving(true)
    try {
      const result = await changeRole(pending.request)
      const { role } = pending.request
      onDone(
        row.kind === 'employee'
          ? `${result.reactivated ? 'Đã mở lại tài khoản' : 'Đã tạo tài khoản'} ${result.username ?? ''}`.trim()
          : role === 'employee' ? 'Đã chuyển thành nhân viên' : 'Đã đổi phân quyền',
      )
    } catch (e) {
      onError((e as Error).message)
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
          <Button key="ok" type="primary" disabled={target === row.role} onClick={() => form.submit()}>
            Tiếp tục
          </Button>,
        ]}
      >
        <Form<ChangeValues>
          form={form}
          layout="vertical"
          initialValues={{ role: row.role }}
          onFinish={confirm}
        >
          <Form.Item name="role" label="Phân quyền mới" extra={ROLE_DESCRIPTION[target]}>
            <Radio.Group {...RADIOGROUP} aria-label="Phân quyền mới" options={ROLE_RADIOS} />
          </Form.Item>
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
        consequence={pending?.consequence}
        okText="Vẫn đổi"
        confirmLoading={saving}
        onCancel={() => setPending(null)}
        onOk={() => void write()}
      />
    </>
  )
}
