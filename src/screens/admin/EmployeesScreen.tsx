import { PlusOutlined } from '@ant-design/icons'
import { Alert, App, Button, Form, Input, Modal, Switch, Table, Typography } from 'antd'
import { useEffect, useMemo, useState } from 'react'
import { modalProps } from '../../components/modalChrome'
import { PageBody, PageHeader } from '../../components/PageHeader'
import { SectionCard } from '../../components/SectionCard'
import { createEmployee, listEmployees, updateEmployee, type Employee } from '../../lib/employeesApi'
import { palette } from '../../theme'

/**
 * The shared staff roster (Feedback Rv4, 0032).
 *
 * One list for every project, deck and coat: Linh asked for it because two
 * months of typed names gave "Tổ 1", "To 1" and "tổ1", and no way to add a
 * crew's hours together. The foreman picks from it and cannot edit it.
 *
 * Retiring, not deleting. A name on a bay update is a snapshot taken when the
 * work was recorded, so removing the row would not clean the history -- it
 * would only take the person out of the picker, which is exactly what the
 * switch does, reversibly.
 */
export function EmployeesScreen() {
  const { message } = App.useApp()
  const [rows, setRows] = useState<Employee[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [adding, setAdding] = useState(false)
  const [renaming, setRenaming] = useState<Employee | null>(null)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    listEmployees(true)
      .then((next) => {
        if (cancelled) return
        setError(null)
        setRows(next)
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message)
      })
    return () => {
      cancelled = true
    }
  }, [attempt])

  const reload = () => setAttempt((n) => n + 1)
  const active = useMemo(() => (rows ?? []).filter((r) => r.active).length, [rows])

  const write = async (run: () => Promise<unknown>, done: string) => {
    setSaving(true)
    try {
      await run()
      message.success(done)
      setAdding(false)
      setRenaming(null)
      setDraft('')
      reload()
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <PageHeader
        title="Nhân viên"
        subtitle={
          rows === null
            ? 'Danh sách dùng chung cho mọi dự án, sàn và công đoạn'
            : `${active} đang làm · ${rows.length} tên trong danh sách · dùng chung cho mọi dự án`
        }
        extra={
          <Button
            type="primary"
            icon={<PlusOutlined aria-hidden />}
            onClick={() => { setDraft(''); setAdding(true) }}
          >
            Thêm nhân viên
          </Button>
        }
      />
      <PageBody>
        {error && (
          <Alert
            type="error"
            showIcon
            message="Không tải được danh sách nhân viên"
            description={error}
            action={<Button size="small" onClick={reload}>Thử lại</Button>}
          />
        )}
        <SectionCard
          code="A5.1"
          title="Danh sách nhân viên"
          summary="GS chọn nhóm trưởng và thợ chính từ danh sách này; GS không sửa được"
          bodyPadding={0}
        >
          <Table<Employee>
            size="small"
            rowKey="id"
            loading={rows === null && error === null}
            dataSource={rows ?? []}
            pagination={{ pageSize: 25, hideOnSinglePage: true, size: 'small' }}
            locale={{ emptyText: 'Chưa có nhân viên nào. Thêm để GS ghi được tiến độ.' }}
            columns={[
              {
                title: 'Họ tên',
                dataIndex: 'fullName',
                render: (name: string, row) => (
                  <span style={{ color: row.active ? undefined : palette.textQuaternary }}>{name}</span>
                ),
              },
              {
                title: 'Đang làm',
                width: 120,
                render: (_, row) => (
                  <Switch
                    size="small"
                    checked={row.active}
                    aria-label={`Đang làm · ${row.fullName}`}
                    onChange={(next) => void write(
                      () => updateEmployee(row.id, { active: next }),
                      next ? 'Đã bật lại' : 'Đã tắt khỏi danh sách chọn',
                    )}
                  />
                ),
              },
              {
                title: '',
                width: 90,
                render: (_, row) => (
                  <Button
                    size="small"
                    onClick={() => { setDraft(row.fullName); setRenaming(row) }}
                  >
                    Sửa tên
                  </Button>
                ),
              },
            ]}
          />
        </SectionCard>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          Tắt một người thì họ không còn hiện trong ô chọn của GS, nhưng vẫn còn nguyên trên các
          lần cập nhật đã ghi — tên trên lịch sử là bản chụp lúc ghi, không đổi theo danh sách.
        </Typography.Text>
      </PageBody>

      <Modal
        open={adding || renaming !== null}
        title={renaming ? `Sửa tên · ${renaming.fullName}` : 'Thêm nhân viên'}
        okText="Lưu"
        cancelText="Huỷ"
        okButtonProps={{ loading: saving }}
        onCancel={() => { setAdding(false); setRenaming(null); setDraft('') }}
        onOk={() => void write(
          () => (renaming ? updateEmployee(renaming.id, { fullName: draft }) : createEmployee(draft)),
          renaming ? 'Đã đổi tên' : 'Đã thêm nhân viên',
        )}
        {...modalProps}
      >
        <Form layout="vertical">
          <Form.Item label="Họ tên" required>
            <Input
              id="employee-name"
              aria-label="Họ tên"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Ví dụ: Nguyễn Văn A"
            />
          </Form.Item>
        </Form>
      </Modal>
    </>
  )
}
