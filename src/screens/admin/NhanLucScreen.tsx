import {
  DownloadOutlined, EditOutlined, EyeInvisibleOutlined, EyeOutlined, KeyOutlined, LockOutlined,
  RollbackOutlined, SearchOutlined, SwapOutlined, TeamOutlined, UnlockOutlined, UserAddOutlined,
} from '@ant-design/icons'
import {
  Alert, App, Button, Checkbox, Form, Input, Modal, Select, Space, Switch, Table, Tooltip, Typography,
} from 'antd'
import dayjs from 'dayjs'
import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../auth/AuthProvider'
import { CategoryBadge } from '../../components/CategoryBadge'
import { ConsequenceModal } from '../../components/ConsequenceModal'
import { useDraftFilters } from '../../components/draftFilters'
import { FilterBar } from '../../components/FilterBar'
import { modalProps } from '../../components/modalChrome'
import { PageBody, PageHeader } from '../../components/PageHeader'
import { RulesDisclosure, type Rule } from '../../components/RulesDisclosure'
import { SectionCard } from '../../components/SectionCard'
import { searchSelectProps, useFullOptionsProps } from '../../components/searchSelect'
import { useTablePagination } from '../../components/tablePagination'
import {
  deactivateGsUser,
  hideUser,
  listGsUsers,
  reactivateUser,
  renameUser,
  revealPassword,
  setMemberships,
  setPassword,
  unhideUser,
  type GsUser,
  type MembershipDraft,
} from '../../lib/adminApi'
import { listEmployees, updateEmployee, type Employee } from '../../lib/employeesApi'
import { buildEmployeesXlsx, employeesFileName } from '../../lib/employeesXlsx'
import { initialsOf } from '../../lib/initials'
import { generatePassword } from '../../lib/passwordGen'
import { downloadWorkbook } from '../../lib/projectReport'
import { listProjectNames } from '../../lib/projectsApi'
import { MISSING, formatDateTimeVN } from '../../lib/format'
import { listWorks } from '../../lib/worksApi'
import { palette, type } from '../../theme'
import { ChangeRoleDialog } from './ChangeRoleDialog'
import { NhanLucCreateDialog } from './NhanLucCreateDialog'
import { PasswordInput } from './PasswordInput'
import {
  DEFAULT_FILTERS, ROLE_DESCRIPTION, ROLE_LABEL, ROLE_OPTIONS, STATUS_OPTIONS,
  buildRows, countFacts, filterRows, isFiltered, nameClash, type StaffRow,
} from './nhanLuc'
import { PASSWORD_RULES, clashRule, type ProjectOption } from './nhanLucForm'

/**
 * Quy tắc áp dụng (RUL-01): what the admin can do here and what the app does,
 * one present-tense sentence each. The three role sentences are the create
 * dialog's helper texts, from the same constant.
 */
const RULES: Rule[] = [
  { id: 'NL-role-employee', text: ROLE_DESCRIPTION.employee },
  { id: 'NL-role-gs', text: ROLE_DESCRIPTION.gs },
  { id: 'NL-role-viewer', text: ROLE_DESCRIPTION.viewer },
  { id: 'NL-one-row', text: 'Họ tên và tên đăng nhập không trùng với người đã có trong danh sách.' },
  { id: 'USR-R5', text: 'Tài khoản chỉ khoá hoặc ẩn được, không xoá được.' },
  { id: 'NL-change-role', text: 'Đổi tài khoản thành nhân viên thì tài khoản bị khoá và ẩn.' },
  { id: 'NL-change-role-back', text: 'Đổi nhân viên đó lại thành GS hoặc Visitor thì mở lại đúng tài khoản cũ.' },
  { id: 'USR-R7', text: 'Mỗi lần xem mật khẩu đều được ghi vào nhật ký, kèm người xem, tài khoản và thời điểm.' },
  { id: 'USR-R9', text: 'Giới hạn công việc chỉ ẩn tiến độ của công việc không được gán và không ẩn sàn nào.' },
  {
    id: 'roster-inactive',
    text: 'Người đã tắt Đang làm không còn trong ô chọn của GS nhưng vẫn giữ tên trên các lần cập nhật đã ghi.',
  },
]

/** A cell with nothing to say for this kind of row (owner, Nhân lực). */
const NONE = <span style={{ color: palette.textTertiary }}>{MISSING}</span>

const projectTextStyle = (user: GsUser) => ({
  color: user.active ? palette.textSecondary : palette.textQuaternary,
})

/**
 * The projects an account covers, as the plain text it is (UI-06): names a
 * person typed, joined by `, ` and left to wrap -- the whole list, since a
 * `+N` would hide the assignment on the only screen that shows it.
 */
function ProjectList({ user }: { user: GsUser }) {
  // A viewer reads every project (RV6-21/25, 0034) whatever project_members
  // still holds from an assignment made before that -- printing those rows
  // told the admin the account was limited to them (QA F5).
  if (user.role === 'viewer') return <span style={projectTextStyle(user)}>Mọi dự án</span>
  if (user.projects.length === 0) return NONE
  // A restricted membership says how much of the project it sees (item 1c);
  // the common case -- every work -- stays a bare name.
  const labelOf = (p: GsUser['projects'][number]) =>
    p.allWorks ? p.name : `${p.name} · ${p.workIds.length}/${p.workCount} công việc`
  return <span style={projectTextStyle(user)}>{user.projects.map(labelOf).join(', ')}</span>
}

/**
 * The projects an account covers, as a confirm dialog names them: the list's
 * own rule, a Visitor reading every project whatever it still holds (M9).
 */
const projectsText = (user: GsUser) => (user.role === 'viewer'
  ? 'Mọi dự án'
  : user.projects.map((p) => p.name).join(' · ') || 'chưa gán dự án')

interface PermissionRow {
  member: boolean
  allWorks: boolean
  workIds: string[]
}

/**
 * "Dự án và công việc": one dialog per account, one line per project (items 1b, 1c).
 *
 * Membership, and within it either every work or the listed ones. Saved as
 * one statement through setMemberships, so what the admin sees on Lưu is
 * exactly what the account gets -- no per-checkbox writes that can leave the
 * two halves disagreeing when the tether drops mid-way.
 */
function PermissionsDialog({
  user, projects, onClose, onSaved,
}: {
  user: GsUser
  projects: ProjectOption[]
  onClose: () => void
  onSaved: () => Promise<void>
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
  /** A failed read or save, said in this dialog rather than behind its mask (M8). */
  const [failure, setFailure] = useState<string | null>(null)
  /**
   * RV6-25: since 0034 the database gives a viewer every project and every
   * work and no longer consults project_members for the role, so a matrix here
   * would promise a narrowing that cannot happen. One sentence, nothing to
   * save, nothing written. Rows a viewer already holds are left alone.
   */
  const viewer = user.role === 'viewer'

  useEffect(() => {
    if (viewer) return
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
  }, [projects, viewer])

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
      setFailure((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  if (viewer) {
    return (
      <Modal
        open
        title={`Dự án và công việc · ${user.username}`}
        onCancel={onClose}
        width={640}
        {...modalProps}
        footer={[<Button key="close" onClick={onClose}>Đóng</Button>]}
      >
        <Typography.Text>Tài khoản Visitor thấy mọi dự án và mọi công việc.</Typography.Text>
      </Modal>
    )
  }

  return (
    <Modal
      open
      title={`Dự án và công việc · ${user.username}`}
      onCancel={onClose}
      width={640}
      {...modalProps}
      footer={[
        <Button key="cancel" onClick={onClose}>Huỷ</Button>,
        <Button key="ok" type="primary" loading={saving} onClick={() => void save()}>Lưu quyền</Button>,
      ]}
    >
      {failure && <Alert type="error" showIcon message={failure} style={{ marginBottom: 12 }} />}
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
                <span style={type.label}>{p.label}</span>
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
                    <span style={type.body}>Tất cả công việc</span>
                  </Space>
                  {!row.allWorks && (
                    <Select
                      mode="multiple"
                      aria-label={`Công việc ${p.label}`}
                      placeholder="Chọn công việc"
                      {...searchSelectProps}
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


/**
 * Nhân lực (NL-01): the GS/Visitor accounts and the employees on one list.
 *
 * Two tables under it and they stay two: an account signs in (`profiles`, an
 * auth user behind it), an employee is a name the foreman picks as lead or
 * painter (`employees`, 0032). One person is one row -- 0037 refuses a name on
 * both -- and Đổi phân quyền moves a person from one to the other.
 *
 * Both lists are read whole (hidden accounts, retired employees) and narrowed
 * here, so the Trạng thái filter never waits on the network and the checks
 * for a duplicate name see everything the database will.
 */
export function NhanLucScreen() {
  const { profile } = useAuth()
  const { message } = App.useApp()
  const fullOptionsProps = useFullOptionsProps()
  const [accounts, setAccounts] = useState<GsUser[] | null>(null)
  const [employees, setEmployees] = useState<Employee[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [projects, setProjects] = useState<ProjectOption[]>([])
  const [revealed, setRevealed] = useState<{ user: GsUser; password: string; at: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [pwTarget, setPwTarget] = useState<GsUser | null>(null)
  const [offTarget, setOffTarget] = useState<GsUser | null>(null)
  const [hideTarget, setHideTarget] = useState<GsUser | null>(null)
  const [renameTarget, setRenameTarget] = useState<GsUser | null>(null)
  const [permTarget, setPermTarget] = useState<GsUser | null>(null)
  const [changeTarget, setChangeTarget] = useState<StaffRow | null>(null)
  const [renaming, setRenaming] = useState<StaffRow | null>(null)
  const [exporting, setExporting] = useState(false)
  const filters = useDraftFilters(DEFAULT_FILTERS)
  /**
   * A reset the admin has typed but not yet confirmed.
   *
   * The password sits here for the length of one dialog, and the dialog never
   * prints it -- it names the account being locked out, which is the fact the
   * admin has to weigh. Cleared on both exits.
   */
  const [pwPending, setPwPending] = useState<{ user: GsUser; password: string } | null>(null)
  const [pwForm] = Form.useForm<{ password: string }>()
  const [renameForm] = Form.useForm<{ username: string }>()
  const [employeeForm] = Form.useForm<{ fullName: string }>()

  /** Same for the reset dialog, and it clears a password out of memory. */
  const closePw = () => {
    setPwTarget(null)
    pwForm.resetFields()
  }

  // Two reads (NL-01); either failing shows the alert with its retry. The
  // rows on screen stay until the next read lands, so a write's re-read does
  // not blank the table.
  useEffect(() => {
    let cancelled = false
    Promise.all([listGsUsers(true), listEmployees(true)])
      .then(([nextAccounts, nextEmployees]) => {
        if (cancelled) return
        setAccounts(nextAccounts)
        setEmployees(nextEmployees)
        setLoadError(null)
      })
      .catch((e: Error) => {
        if (!cancelled) setLoadError(e.message)
      })
    return () => {
      cancelled = true
    }
  }, [attempt])
  const reload = () => setAttempt((n) => n + 1)

  useEffect(() => {
    void listProjectNames()
      .then((data) => setProjects(data.map((p) => ({ value: p.id, label: p.name }))))
      // An empty Select with no explanation is the worst of both worlds.
      .catch((e: Error) => setError(e.message))
  }, [])

  const rows = useMemo(
    () => (accounts !== null && employees !== null ? buildRows(accounts, employees) : []),
    [accounts, employees],
  )
  const shown = useMemo(() => filterRows(rows, filters.applied), [rows, filters.applied])
  const loaded = accounts !== null && employees !== null
  const filtered = isFiltered(filters.applied)
  const pagination = useTablePagination(shown.length, filters.version)

  const run = async (fn: () => Promise<void>) => {
    try {
      await fn()
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    }
  }
  /**
   * The write behind the open dialog: its button spins while it runs, and a
   * refusal is said inside that dialog, which stays open to retry, rather
   * than on the page Alert behind its mask (M8). One pair, as one dialog is
   * open at a time; every close clears it.
   */
  const [dialogBusy, setDialogBusy] = useState(false)
  const [dialogError, setDialogError] = useState<string | null>(null)
  const runInDialog = async (fn: () => Promise<void>) => {
    setDialogBusy(true)
    try {
      await fn()
      setDialogError(null)
    } catch (e) {
      setDialogError((e as Error).message)
    } finally {
      setDialogBusy(false)
    }
  }
  /** Closes a dialog and forgets its refusal. */
  const closing = (close: () => void) => () => {
    setDialogError(null)
    close()
  }

  /**
   * Employees only, retired included, never the filtered view (RV5-08): the
   * file is what the admin checks the yard's paperwork against, and a name
   * retired last month is still on every update it was recorded against.
   */
  const exportRoster = async () => {
    setExporting(true)
    try {
      const blob = await buildEmployeesXlsx(employees ?? [])
      downloadWorkbook(blob, employeesFileName(dayjs().format('YYYY-MM-DD')))
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setExporting(false)
    }
  }

  const accountActions = (user: GsUser) => (
    <>
      <Tooltip title="Đổi tên đăng nhập">
        <Button
          size="small"
          aria-label="Đổi tên đăng nhập"
          icon={<EditOutlined />}
          onClick={() => {
            renameForm.setFieldsValue({ username: user.username })
            setRenameTarget(user)
          }}
        />
      </Tooltip>
      {/* Not "Phân quyền": on this screen that word is the role (review I-2). */}
      <Tooltip title="Dự án và công việc">
        <Button size="small" aria-label="Dự án và công việc" icon={<TeamOutlined />} onClick={() => setPermTarget(user)} />
      </Tooltip>
      <Tooltip title="Đổi mật khẩu">
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
              setRevealed({ user, password, at: formatDateTimeVN(new Date().toISOString()) })
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
      ) : user.hidden ? (
        // The lock's slot, kept: every account row has its buttons at the same x (M7).
        <Button size="small" aria-hidden tabIndex={-1} icon={<LockOutlined />} style={{ visibility: 'hidden' }} />
      ) : (
        <Tooltip title="Mở khoá · đăng nhập lại được, dự án giữ nguyên">
          <Button
            size="small"
            aria-label="Mở khoá"
            icon={<UnlockOutlined />}
            onClick={() =>
              void run(async () => {
                await reactivateUser(user.id)
                reload()
                message.success('Đã mở khoá tài khoản')
              })
            }
          />
        </Tooltip>
      )}
      {user.hidden ? (
        // An icon like every other action in the row (M7).
        <Tooltip title="Hiện lại trong danh sách · vẫn khoá">
          <Button
            size="small"
            aria-label="Hiện lại"
            icon={<RollbackOutlined />}
            onClick={() =>
              void run(async () => {
                await unhideUser(user.id)
                reload()
                message.success('Đã hiện lại tài khoản')
              })
            }
          />
        </Tooltip>
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
    </>
  )

  const employeeActions = (row: StaffRow & { kind: 'employee' }) => (
    <>
      <Tooltip title="Đang làm · tắt thì không còn trong ô chọn của GS">
        <Switch
          size="small"
          checked={row.employee.active}
          aria-label={`Đang làm · ${row.fullName}`}
          onChange={(next) =>
            void run(async () => {
              await updateEmployee(row.id, { active: next })
              reload()
              message.success(next ? 'Đã bật lại' : 'Đã tắt khỏi danh sách chọn')
            })
          }
        />
      </Tooltip>
      <Tooltip title="Sửa tên">
        <Button
          size="small"
          aria-label="Sửa tên"
          icon={<EditOutlined />}
          onClick={() => {
            employeeForm.setFieldsValue({ fullName: row.fullName })
            setRenaming(row)
          }}
        />
      </Tooltip>
    </>
  )

  return (
    <>
      <PageHeader
        title="Nhân lực"
        // The counts arrive with the lists, on the title's own line (HLT-01).
        facts={loaded ? countFacts(rows, shown, filtered) : undefined}
        filters={
          // Three controls: a draft, applied by Tìm or Enter (FLT-02, FLT-08).
          <FilterBar onApply={() => filters.apply()} onReset={filters.reset}>
            <Input
              allowClear
              aria-label="Tìm nhân lực"
              placeholder="Tìm tên, tên đăng nhập"
              prefix={<SearchOutlined aria-hidden />}
              style={{ width: 260 }}
              value={filters.draft.query}
              onChange={(e) => filters.setDraft({ query: e.target.value })}
            />
            <Select
              aria-label="Phân quyền"
              {...searchSelectProps}
              {...fullOptionsProps}
              style={{ width: 170 }}
              value={filters.draft.role}
              options={ROLE_OPTIONS}
              onChange={(role) => filters.setDraft({ role })}
            />
            <Select
              aria-label="Trạng thái"
              {...searchSelectProps}
              {...fullOptionsProps}
              style={{ width: 190 }}
              value={filters.draft.status}
              options={STATUS_OPTIONS}
              onChange={(status) => filters.setDraft({ status })}
            />
          </FilterBar>
        }
        extra={
          <Space size={12}>
            <Tooltip title="Xuất danh sách nhân viên · cả người đã nghỉ · .xlsx">
              <Button
                icon={<DownloadOutlined aria-hidden />}
                loading={exporting}
                disabled={employees === null || employees.length === 0}
                onClick={() => void exportRoster()}
              >
                Xuất danh sách
              </Button>
            </Tooltip>
            <Button type="primary" icon={<UserAddOutlined aria-hidden />} onClick={() => setCreateOpen(true)}>
              Thêm nhân lực
            </Button>
          </Space>
        }
      />

      <PageBody>
        {loadError && (
          <Alert
            type="error"
            showIcon
            message="Không tải được danh sách nhân lực"
            description={loadError}
            action={<Button onClick={reload}>Thử lại</Button>}
          />
        )}
        {error && <Alert type="error" message={error} closable onClose={() => setError(null)} />}

        <SectionCard bodyPadding={0} footer={<RulesDisclosure rules={RULES} />}>
          <Table<StaffRow>
            rowKey="key"
            loading={!loaded && loadError === null}
            dataSource={shown}
            pagination={pagination}
            // Sized to its content, as the deck list is: at 1024px the columns
            // add up to more than the card, which clips (overflow: hidden)
            // rather than scrolls. The card scrolls sideways instead.
            scroll={{ x: 'max-content' }}
            locale={{
              // Two different nothings: a list nobody has filled in yet is a
              // job to do, a filter that matched nothing is not.
              emptyText: filtered || rows.length > 0
                ? 'Không có dòng nào khớp bộ lọc'
                : 'Chưa có ai trong danh sách. Thêm nhân viên để GS ghi được tiến độ.',
            }}
            columns={[
              {
                title: 'Họ tên',
                key: 'name',
                width: 280,
                render: (_v, row) => {
                  const live = row.status === 'Đang dùng' || row.status === 'Đang làm'
                  return (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <span
                        style={{
                          width: 34,
                          height: 34,
                          borderRadius: 10,
                          flex: 'none',
                          textAlign: 'center',
                          ...type.micro,
                          lineHeight: '34px',
                          background: live ? palette.bgHover : palette.bgApp,
                          color: live ? palette.textSecondary : palette.textQuaternary,
                        }}
                      >
                        {initialsOf(row.fullName)}
                      </span>
                      <div style={{ minWidth: 0, ...type.body, lineHeight: 1.35 }}>{row.fullName}</div>
                    </div>
                  )
                },
              },
              {
                title: 'Tên đăng nhập',
                key: 'username',
                width: 150,
                render: (_v, row) => (row.kind === 'account' ? row.account.username : NONE),
              },
              {
                title: 'Phân quyền',
                key: 'role',
                align: 'center',
                width: 110,
                // The role's meaning on hover, in the dialogs' own words (NL-01).
                render: (_v, row) => (
                  <Tooltip title={ROLE_DESCRIPTION[row.role]}>
                    <span>
                      <CategoryBadge category="role" value={ROLE_LABEL[row.role]} />
                    </span>
                  </Tooltip>
                ),
              },
              {
                title: 'Dự án',
                key: 'projects',
                // Fixed, so the list wraps: under scroll.x max-content an
                // unsized column grows to its longest line (UI-06).
                width: 280,
                render: (_v, row) => (row.kind === 'account' ? <ProjectList user={row.account} /> : NONE),
              },
              {
                title: 'Trạng thái',
                key: 'status',
                align: 'center',
                width: 120,
                render: (_v, row) => (row.kind === 'account'
                  ? <CategoryBadge category="accountStatus" value={row.status} />
                  : <CategoryBadge category="employeeStatus" value={row.status} />),
              },
              {
                title: 'Thao tác',
                key: 'actions',
                width: 250,
                // Pinned: lock, hide and reveal must not scroll out of the card.
                fixed: 'right',
                align: 'center',
                render: (_v, row) => (
                  // Right-aligned, in one slot order, Đổi phân quyền last: it
                  // then sits at one x on every row, account or employee (M7).
                  <div style={{ display: 'flex', gap: 7, justifyContent: 'flex-end', alignItems: 'center' }}>
                    {row.kind === 'account' ? accountActions(row.account) : employeeActions(row)}
                    <Tooltip title="Đổi phân quyền · Nhân viên, GS, Visitor">
                      <Button
                        size="small"
                        aria-label="Đổi phân quyền"
                        icon={<SwapOutlined />}
                        onClick={() => setChangeTarget(row)}
                      />
                    </Tooltip>
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
            <span style={{ ...type.cardTitle, letterSpacing: '0.06em' }}>
              {revealed.password}
            </span>
          </Typography.Text>
        </div>
        <span style={{ display: 'block', marginTop: 9, ...type.caption, color: palette.textTertiary }}>
          {`Đã ghi log · ${revealed.at} · ${profile?.fullName ?? ''} → ${revealed.user.username}`}
        </span>
      </Modal>
      )}

      <ConsequenceModal
        open={offTarget !== null}
        tone="danger"
        tag="Xác nhận"
        title={`Khoá tài khoản ${offTarget?.username ?? ''}?`}
        description="Tài khoản bị khoá, không bị xoá:"
        items={
          offTarget
            ? [
                { label: offTarget.fullName, meta: projectsText(offTarget) },
              ]
            : []
        }
        // Each consequence its own item (RUL-01): member policies stop granting
        // on the spot (admin-users lockAccount), an open tablet included.
        consequences={[
          'Mất quyền truy cập ngay, cả máy tính bảng đang mở cũng ngừng ghi tiến độ',
          'Dự án và công việc đã gán giữ nguyên cho lần mở khoá',
          'Lịch sử ghi nhận vẫn mang tên người này',
        ]}
        okText="Vẫn khoá"
        confirmLoading={dialogBusy}
        error={dialogError}
        onCancel={closing(() => setOffTarget(null))}
        onOk={() =>
          void runInDialog(async () => {
            await deactivateGsUser(offTarget!.id)
            setOffTarget(null)
            reload()
            message.success('Đã khoá tài khoản')
          })
        }
      />

      <ConsequenceModal
        open={hideTarget !== null}
        tone="danger"
        tag="Xác nhận"
        title={`Ẩn tài khoản ${hideTarget?.username ?? ''}?`}
        description="Tài khoản bị khoá và ẩn khỏi danh sách, không bị xoá:"
        items={
          hideTarget
            ? [
                { label: hideTarget.fullName, meta: projectsText(hideTarget) },
              ]
            : []
        }
        consequences={[
          'Mất quyền truy cập ngay, cả máy tính bảng đang mở cũng ngừng ghi tiến độ',
          'Lịch sử ghi nhận vẫn mang tên người này',
          'Tìm lại bằng Trạng thái «Đã ẩn»',
        ]}
        okText="Vẫn ẩn"
        confirmLoading={dialogBusy}
        error={dialogError}
        onCancel={closing(() => setHideTarget(null))}
        onOk={() =>
          void runInDialog(async () => {
            await hideUser(hideTarget!.id)
            setHideTarget(null)
            reload()
            message.success('Đã ẩn tài khoản')
          })
        }
      />

      <Modal
        open={renameTarget !== null}
        title={`Đổi tên đăng nhập · ${renameTarget?.username ?? ''}`}
        onCancel={closing(() => setRenameTarget(null))}
        {...modalProps}
        footer={[
          <Button key="cancel" onClick={closing(() => setRenameTarget(null))}>Huỷ</Button>,
          <Button key="ok" type="primary" loading={dialogBusy} onClick={() => renameForm.submit()}>Lưu</Button>,
        ]}
      >
        {dialogError && <Alert type="error" showIcon message={dialogError} style={{ marginBottom: 12 }} />}
        <Form<{ username: string }>
          form={renameForm}
          layout="vertical"
          onFinish={({ username }) =>
            void runInDialog(async () => {
              await renameUser(renameTarget!.id, username.trim().toLowerCase())
              setRenameTarget(null)
              reload()
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
            extra="Từ lần đăng nhập sau người này dùng tên mới với mật khẩu cũ."
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
          onSaved={async () => {
            setPermTarget(null)
            reload()
            message.success('Đã cập nhật quyền')
          }}
        />
      )}


      <NhanLucCreateDialog
        open={createOpen}
        rows={rows}
        projects={projects}
        onClose={() => setCreateOpen(false)}
        onCreated={(done) => {
          reload()
          message.success(done)
        }}
      />

      {changeTarget !== null && (
        <ChangeRoleDialog
          row={changeTarget}
          rows={rows}
          projects={projects}
          onClose={() => setChangeTarget(null)}
          onDone={(done) => {
            setChangeTarget(null)
            reload()
            message.success(done)
          }}
        />
      )}

      <Modal
        open={renaming !== null}
        title={`Sửa tên · ${renaming?.fullName ?? ''}`}
        onCancel={closing(() => setRenaming(null))}
        {...modalProps}
        footer={[
          <Button key="cancel" onClick={closing(() => setRenaming(null))}>Huỷ</Button>,
          <Button key="ok" type="primary" loading={dialogBusy} onClick={() => employeeForm.submit()}>Lưu</Button>,
        ]}
      >
        {dialogError && <Alert type="error" showIcon message={dialogError} style={{ marginBottom: 12 }} />}
        <Form<{ fullName: string }>
          form={employeeForm}
          layout="vertical"
          onFinish={({ fullName }) =>
            void runInDialog(async () => {
              await updateEmployee(renaming!.id, { fullName })
              setRenaming(null)
              reload()
              message.success('Đã đổi tên')
            })
          }
        >
          <Form.Item
            name="fullName"
            label="Họ tên"
            rules={[
              { required: true, whitespace: true, message: 'Nhập họ tên' },
              clashRule((v) => nameClash(rows, v, 'employee', renaming?.key)),
            ]}
          >
            <Input placeholder="Ví dụ: Nguyễn Văn A" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={pwTarget !== null}
        title={`Đổi mật khẩu · ${pwTarget?.username ?? ''}`}
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
            rules={[{ required: true, message: 'Nhập mật khẩu mới' }, PASSWORD_RULES[1]]}
          >
            <PasswordInput
              placeholder="Nhập mật khẩu mới"
              onGenerate={() => pwForm.setFieldsValue({ password: generatePassword() })}
            />
          </Form.Item>
        </Form>
      </Modal>

      <ConsequenceModal
        open={pwPending !== null}
        tone="danger"
        tag="Thao tác phá huỷ"
        title={`Đổi mật khẩu cho ${pwPending?.user.username ?? ''}?`}
        description="Mật khẩu cũ ngừng hiệu lực ngay khi anh xác nhận:"
        items={
          pwPending
            ? [
                { label: pwPending.user.fullName, meta: projectsText(pwPending.user) },
              ]
            : []
        }
        // "Người dùng": the account may be a Visitor as well as a GS (M9).
        consequences={['Người dùng không nhận được thông báo nào', 'Anh tự giao mật khẩu mới, hiện ra ngay sau bước này']}
        okText="Vẫn đổi"
        confirmLoading={dialogBusy}
        error={dialogError}
        onCancel={closing(() => setPwPending(null))}
        onOk={() =>
          void runInDialog(async () => {
            const { user, password } = pwPending!
            await setPassword(user.id, password)
            setPwPending(null)
            // Straight into the reveal modal: the admin has to read this value
            // out to the foreman, and it appears nowhere else.
            setRevealed({ user, password, at: formatDateTimeVN(new Date().toISOString()) })
            message.success('Đã đổi mật khẩu')
          })
        }
      />
    </>
  )
}
