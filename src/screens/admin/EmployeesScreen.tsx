import { DownloadOutlined, PlusOutlined, SearchOutlined } from '@ant-design/icons'
import { Alert, App, Button, Form, Input, Modal, Space, Switch, Table, Tooltip } from 'antd'
import dayjs from 'dayjs'
import { useEffect, useMemo, useState } from 'react'
import { FilterBar } from '../../components/FilterBar'
import { modalProps } from '../../components/modalChrome'
import { PageBody, PageHeader } from '../../components/PageHeader'
import { RulesDisclosure, type Rule } from '../../components/RulesDisclosure'
import { SectionCard } from '../../components/SectionCard'
import { useTablePagination } from '../../components/tablePagination'
import { createEmployee, listEmployees, updateEmployee, type Employee } from '../../lib/employeesApi'
import { buildEmployeesXlsx, employeesFileName } from '../../lib/employeesXlsx'
import { downloadWorkbook } from '../../lib/projectReport'
import { matchesSearch } from '../../lib/search'
import { palette } from '../../theme'

/** Who reads the roster and what switching a name off keeps (CPY-01). Keys only; the spec names no ids for these. */
const ROSTER_RULES: Rule[] = [
  { id: 'roster-source', text: 'GS chọn nhóm trưởng và thợ chính từ danh sách này; GS không sửa được.' },
  {
    id: 'roster-inactive',
    text: 'Tắt một người thì họ không còn hiện trong ô chọn của GS, nhưng vẫn còn nguyên trên các lần cập nhật đã ghi — tên trên lịch sử là bản chụp lúc ghi, không đổi theo danh sách.',
  },
]

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
  const [query, setQuery] = useState('')
  const [exporting, setExporting] = useState(false)

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

  /**
   * Feedback Rv5, item 4. 32 names today and one line per person, so the
   * question "is X on the list?" was a scroll. The roster stores ONE string --
   * "MC005593 - Cao Minh Hải" -- so one substring match over it covers the code
   * and the name at once, and `matchesSearch` folds case and tones because
   * nobody types Vietnamese tones into a search box on a site tablet.
   */
  const shown = useMemo(
    () => (rows ?? []).filter((r) => matchesSearch(r.fullName, query)),
    [rows, query],
  )
  const searching = query.trim() !== ''
  const active = useMemo(() => shown.filter((r) => r.active).length, [shown])
  const pagination = useTablePagination(shown.length, query)

  /**
   * The WHOLE roster, retired names included, never `shown` (RV5-08): the file
   * is what the admin checks the yard's paperwork against, and a name retired
   * last month is still on every update it was recorded against. The button
   * says so, because a filtered screen beside an unfiltered file is otherwise a
   * surprise.
   */
  const exportRoster = async () => {
    setExporting(true)
    try {
      const blob = await buildEmployeesXlsx(rows ?? [])
      downloadWorkbook(blob, employeesFileName(dayjs().format('YYYY-MM-DD')))
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setExporting(false)
    }
  }

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
        // The counts arrive with the list: their line is held meanwhile (R1).
        reserveSubtitle
        subtitle={
          rows === null
            ? undefined
            // RV5-06: while a search is on, the count is of what is on screen,
            // with the whole roster beside it -- "1 đang làm" with nine rows
            // hidden and no sign of it would be a wrong number.
            : searching
              ? `${active} đang làm · ${shown.length}/${rows.length} tên khớp tìm kiếm`
              : `${active} đang làm · ${rows.length} tên trong danh sách`
        }
        filters={
          // One control, so it applies as it is typed (FLT-02 is for bars of more than one).
          <FilterBar>
            <Input
              allowClear
              aria-label="Tìm nhân viên"
              placeholder="Tìm theo mã hoặc tên"
              prefix={<SearchOutlined aria-hidden />}
              style={{ width: 240 }}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </FilterBar>
        }
        extra={
          <Space size={12}>
            <Tooltip title="Xuất toàn bộ danh sách · cả người đã nghỉ · .xlsx">
              <Button
                icon={<DownloadOutlined aria-hidden />}
                loading={exporting}
                disabled={rows === null || rows.length === 0}
                onClick={() => void exportRoster()}
              >
                Xuất danh sách
              </Button>
            </Tooltip>
            <Button
              type="primary"
              icon={<PlusOutlined aria-hidden />}
              onClick={() => { setDraft(''); setAdding(true) }}
            >
              Thêm nhân viên
            </Button>
          </Space>
        }
      />
      <PageBody>
        {error && (
          <Alert
            type="error"
            showIcon
            message="Không tải được danh sách nhân viên"
            description={error}
            action={<Button onClick={reload}>Thử lại</Button>}
          />
        )}
        <SectionCard
          code="A5.1"
          title="Danh sách nhân viên"
          bodyPadding={0}
          footer={<RulesDisclosure rules={ROSTER_RULES} />}
        >
          <Table<Employee>
            size="small"
            rowKey="id"
            loading={rows === null && error === null}
            dataSource={shown}
            pagination={pagination}
            locale={{
              // Two different nothings: a roster nobody has filled in yet is a
              // job to do, a search that matched nothing is not.
              emptyText: searching
                ? 'Không có tên nào khớp'
                : 'Chưa có nhân viên nào. Thêm để GS ghi được tiến độ.',
            }}
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
                align: 'center',
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
                align: 'center',
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
