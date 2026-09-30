import { Alert, Button, Form, Input, Modal, Radio, Select } from 'antd'
import { useState } from 'react'
import { modalProps } from '../../components/modalChrome'
import { searchSelectProps } from '../../components/searchSelect'
import { createGsUser, type StaffRole } from '../../lib/adminApi'
import { createEmployee } from '../../lib/employeesApi'
import { generatePassword } from '../../lib/passwordGen'
import { PasswordInput } from './PasswordInput'
import { ROLE_DESCRIPTION, loginClash, nameClash, type StaffRow } from './nhanLuc'
import { PASSWORD_RULES, PROJECTS_FAILED_NOTE, RADIOGROUP, ROLE_RADIOS, USERNAME_RULES, clashRule, type ProjectOption } from './nhanLucForm'

interface CreateValues {
  role: StaffRole
  fullName: string
  username?: string
  password?: string
  projectId?: string
}

/**
 * "Thêm nhân lực" (NL-02): one dialog for the three kinds of row. Phân quyền
 * first, Nhân viên by default, with the role's sentence under it; then only
 * the fields that role needs -- a name for an employee, a login and a password
 * for a Visitor, and a project too for a GS. A name or login already on the
 * list is refused beside its field before anything is sent; what the server
 * still refuses shows at the top of the dialog, which stays open.
 */
export function NhanLucCreateDialog({
  open, rows, projects, projectsFailed = false, onClose, onCreated,
}: {
  open: boolean
  rows: StaffRow[]
  projects: ProjectOption[]
  /** The project list failed: a GS cannot be given one, so Thêm waits for GS only (NL-10 review M1). */
  projectsFailed?: boolean
  onClose: () => void
  onCreated: (message: string) => void
}) {
  const [form] = Form.useForm<CreateValues>()
  const role: StaffRole = Form.useWatch('role', form) ?? 'employee'
  const [saving, setSaving] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  /** Every dismissal path -- X, mask, Escape, Huỷ -- and a success. */
  const close = () => {
    form.resetFields()
    setFailure(null)
    onClose()
  }

  const submit = async (values: CreateValues) => {
    setSaving(true)
    setFailure(null)
    try {
      const fullName = values.fullName.trim()
      if (values.role === 'employee') {
        await createEmployee(fullName)
      } else {
        await createGsUser({
          username: (values.username ?? '').trim().toLowerCase(),
          fullName,
          password: values.password ?? '',
          role: values.role,
          // A Visitor reads every project: nothing to send (NL-05).
          ...(values.role === 'gs' ? { projectId: values.projectId } : {}),
        })
      }
      close()
      onCreated(values.role === 'employee' ? 'Đã thêm nhân viên' : 'Đã tạo tài khoản')
    } catch (e) {
      setFailure((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      title="Thêm nhân lực"
      onCancel={close}
      {...modalProps}
      footer={[
        <Button key="cancel" onClick={close}>Huỷ</Button>,
        <Button
          key="ok"
          type="primary"
          loading={saving}
          disabled={role === 'gs' && projectsFailed}
          onClick={() => form.submit()}
        >
          Thêm
        </Button>,
      ]}
    >
      {failure && <Alert type="error" showIcon message={failure} style={{ marginBottom: 12 }} />}
      <Form<CreateValues>
        form={form}
        layout="vertical"
        initialValues={{ role: 'employee' }}
        onFinish={(values) => void submit(values)}
      >
        <Form.Item name="role" label="Phân quyền" extra={ROLE_DESCRIPTION[role]}>
          <Radio.Group {...RADIOGROUP} aria-label="Phân quyền" options={ROLE_RADIOS} />
        </Form.Item>
        <Form.Item
          name="fullName"
          label="Họ tên"
          // Which list the name must be free in follows the role (review minor 5).
          dependencies={['role']}
          rules={[
            { required: true, whitespace: true, message: 'Nhập họ tên' },
            clashRule((v) => nameClash(rows, v, role === 'employee' ? 'employee' : 'account')),
          ]}
        >
          <Input placeholder="Ví dụ: Lê Trung Hiếu" />
        </Form.Item>
        {role !== 'employee' && (
          <>
            <Form.Item
              name="username"
              label="Tên đăng nhập"
              rules={[...USERNAME_RULES, clashRule((v) => loginClash(rows, v))]}
            >
              <Input placeholder="Ví dụ: gs.hieu" />
            </Form.Item>
            <Form.Item name="password" label="Mật khẩu" rules={PASSWORD_RULES}>
              <PasswordInput
                placeholder="Nhập mật khẩu"
                onGenerate={() => form.setFieldsValue({ password: generatePassword() })}
              />
            </Form.Item>
          </>
        )}
        {role === 'gs' && (
          <Form.Item
            name="projectId"
            label="Dự án"
            rules={[{ required: true, message: 'Chọn dự án' }]}
            extra={projectsFailed ? PROJECTS_FAILED_NOTE : undefined}
          >
            <Select options={projects} placeholder="Chọn dự án" {...searchSelectProps} />
          </Form.Item>
        )}
      </Form>
    </Modal>
  )
}
