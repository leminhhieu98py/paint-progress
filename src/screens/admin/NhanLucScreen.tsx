import {
  DownloadOutlined, LockOutlined, SearchOutlined, UserAddOutlined,
} from '@ant-design/icons'
import {
  Alert, App, Button, Input, Modal, Select, Space, Table, Tooltip,
} from 'antd'
import dayjs from 'dayjs'
import { useEffect, useMemo, useState } from 'react'
import { CategoryBadge } from '../../components/CategoryBadge'
import { ConsequenceModal } from '../../components/ConsequenceModal'
import { IconAction } from '../../components/IconAction'
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
  revealPassword,
  unhideUser,
  type GsUser,
} from '../../lib/adminApi'
import { listEmployees, updateEmployee, type Employee } from '../../lib/employeesApi'
import { buildEmployeesXlsx, employeesFileName } from '../../lib/employeesXlsx'
import { initialsOf } from '../../lib/initials'
import { downloadWorkbook } from '../../lib/projectReport'
import { listProjectNames } from '../../lib/projectsApi'
import { MISSING } from '../../lib/format'
import { palette, type } from '../../theme'
import { NhanLucCreateDialog } from './NhanLucCreateDialog'
import { CopyPasswordAction } from './CopyPasswordAction'
import { NhanLucEditDialog } from './NhanLucEditDialog'
import {
  DEFAULT_FILTERS, ROLE_DESCRIPTION, ROLE_LABEL, ROLE_OPTIONS, STATUS_OPTIONS,
  buildRows, countFacts, filterRows, isFiltered, type StaffRow,
} from './nhanLuc'
import { type ProjectOption } from './nhanLucForm'

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
  // A name like the person's own beside it (AD5, UI-06); dimmed only on a locked account.
  color: user.active ? palette.text : palette.textQuaternary,
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
  const { message } = App.useApp()
  const fullOptionsProps = useFullOptionsProps()
  const [accounts, setAccounts] = useState<GsUser[] | null>(null)
  const [employees, setEmployees] = useState<Employee[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [projects, setProjects] = useState<ProjectOption[]>([])
  /** The project list has arrived: until then the Sửa dialog cannot show a GS's memberships (C1). */
  const [projectsReady, setProjectsReady] = useState(false)
  const [projectsFailed, setProjectsFailed] = useState(false)
  const [revealed, setRevealed] = useState<{ user: GsUser; password: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [offTarget, setOffTarget] = useState<GsUser | null>(null)
  const [hideTarget, setHideTarget] = useState<GsUser | null>(null)
  /** The row whose Sửa dialog is open (NL-09). */
  const [editTarget, setEditTarget] = useState<StaffRow | null>(null)
  /** An employee whose Khoá is being confirmed (NL-09 amendment). */
  const [employeeOffTarget, setEmployeeOffTarget] = useState<StaffRow | null>(null)
  const [exporting, setExporting] = useState(false)
  const filters = useDraftFilters(DEFAULT_FILTERS)

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
      .then((data) => {
        setProjects(data.map((p) => ({ value: p.id, label: p.name })))
        setProjectsReady(true)
      })
      // An empty Select with no explanation is the worst of both worlds.
      .catch((e: Error) => {
        setError(e.message)
        setProjectsFailed(true)
      })
  }, [])

  const rows = useMemo(
    () => (accounts !== null && employees !== null ? buildRows(accounts, employees) : []),
    [accounts, employees],
  )
  const shown = useMemo(() => filterRows(rows, filters.applied), [rows, filters.applied])
  const loaded = accounts !== null && employees !== null
  const filtered = isFiltered(filters.applied)
  const pagination = useTablePagination(shown.length, filters.version)

  /**
   * The page Alert says what the last step refused; the next step -- a row
   * action, or the filter bar applied or reset -- clears it (NL-10), rather
   * than leaving it up until something succeeds.
   */
  const start = (open: () => void) => {
    setError(null)
    open()
  }
  const run = async (fn: () => Promise<void>) => {
    setError(null)
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

  /**
   * NL-09: a row keeps only what the Sửa dialog does not hold. One slot order
   * on every row -- Sửa, Khoá/Mở khoá, Ẩn/Hiện lại -- right-aligned, a slot
   * kept empty where a row has no action for it, so the columns line up (M7).
   */
  const slot = (key: string) => (
    <Button key={key} aria-hidden tabIndex={-1} icon={<LockOutlined />} style={{ visibility: 'hidden' }} />
  )

  const accountActions = (row: StaffRow & { kind: 'account' }) => {
    const user = row.account
    return (
      <>
        <IconAction verb="edit" label="Sửa" tooltip="Sửa · họ tên, phân quyền, đăng nhập, mật khẩu, dự án" onClick={() => start(() => setEditTarget(row))} />
        {/* The stored password, only when asked for; the call is what logs it. */}
        <IconAction
          verb="reveal"
          label="Xem mật khẩu"
          onClick={() =>
            void run(async () => {
              setRevealed({ user, password: await revealPassword(user.id) })
            })
          }
        />
        {user.active ? (
          <IconAction verb="lock" label="Khoá tài khoản" danger onClick={() => start(() => setOffTarget(user))} />
        ) : user.hidden ? (
          slot('lock')
        ) : (
          <IconAction
            verb="unlock"
            label="Mở khoá"
            tooltip="Mở khoá · đăng nhập lại được, dự án giữ nguyên"
            onClick={() =>
              void run(async () => {
                await reactivateUser(user.id)
                reload()
                message.success('Đã mở khoá tài khoản')
              })
            }
          />
        )}
        {user.hidden ? (
          <IconAction
            verb="unhide"
            label="Hiện lại"
            tooltip="Hiện lại trong danh sách · vẫn khoá"
            onClick={() =>
              void run(async () => {
                await unhideUser(user.id)
                reload()
                message.success('Đã hiện lại tài khoản')
              })
            }
          />
        ) : (
          <IconAction verb="hide" label="Ẩn tài khoản" tooltip="Ẩn khỏi danh sách · không xoá" onClick={() => start(() => setHideTarget(user))} />
        )}
      </>
    )
  }

  const employeeActions = (row: StaffRow & { kind: 'employee' }) => (
    <>
      <IconAction verb="edit" label="Sửa" tooltip="Sửa · họ tên, phân quyền" onClick={() => start(() => setEditTarget(row))} />
      {slot('reveal')}
      {/* Khoá/Mở khoá like an account's (NL-09 amendment): Đang làm or Đã nghỉ. */}
      {row.employee.active ? (
        <IconAction verb="lock" label="Khoá nhân viên" danger onClick={() => start(() => setEmployeeOffTarget(row))} />
      ) : (
        <IconAction
          verb="unlock"
          label="Mở khoá"
          tooltip="Mở khoá · trở lại ô chọn nhóm trưởng, thợ chính của GS"
          onClick={() =>
            void run(async () => {
              await updateEmployee(row.id, { active: true })
              reload()
              message.success('Đã mở khoá nhân viên')
            })
          }
        />
      )}
      {slot('hide')}
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
          <FilterBar
            onApply={() => start(() => filters.apply())}
            onReset={() => start(() => filters.reset())}
          >
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
                width: 150,
                // Pinned: Sửa, lock and hide must not scroll out of the card.
                fixed: 'right',
                align: 'center',
                render: (_v, row) => (
                  // Right-aligned, one slot order on every row, account or
                  // employee, so each icon sits at one x (M7, NL-09).
                  <div style={{ display: 'flex', gap: 7, justifyContent: 'flex-end', alignItems: 'center' }}>
                    {row.kind === 'account' ? accountActions(row) : employeeActions(row)}
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
        okText="Đóng"
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
          <span style={{ ...type.cardTitle, letterSpacing: '0.06em', flex: 1, minWidth: 0 }}>
            {revealed.password}
          </span>
          {/* Copies the password text itself, and says whether it did. */}
          <CopyPasswordAction password={revealed.password} />
        </div>
      </Modal>
      )}

      <ConsequenceModal
        open={offTarget !== null}
        tone="danger"
        // Nothing is deleted: a lock, not the trash can (NL-10).
        icon="lock"
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
        icon="hide"
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

      {editTarget !== null && (
        <NhanLucEditDialog
          key={editTarget.key}
          row={editTarget}
          rows={rows}
          projects={projectsReady ? projects : null}
          projectsFailed={projectsFailed}
          onClose={() => setEditTarget(null)}
          onPartial={reload}
          onDone={({ message: done, revealed: fresh }) => {
            setEditTarget(null)
            reload()
            message.success(done)
            // Straight into the reveal modal: the admin has to read a new
            // password out to the foreman, and it appears nowhere else.
            if (fresh) setRevealed(fresh)
          }}
        />
      )}

      <ConsequenceModal
        open={employeeOffTarget !== null}
        tone="danger"
        icon="lock"
        tag="Xác nhận"
        title={`Khoá nhân viên ${employeeOffTarget?.fullName ?? ''}?`}
        description="Nhân viên nghỉ làm, không bị xoá:"
        items={employeeOffTarget ? [{ label: employeeOffTarget.fullName, meta: 'Đang làm' }] : []}
        consequences={[
          'Không còn trong ô chọn nhóm trưởng, thợ chính của GS',
          'Các lần cập nhật đã ghi vẫn giữ tên',
          'Mở khoá là đưa lại vào ô chọn',
        ]}
        okText="Vẫn khoá"
        confirmLoading={dialogBusy}
        error={dialogError}
        onCancel={closing(() => setEmployeeOffTarget(null))}
        onOk={() =>
          void runInDialog(async () => {
            await updateEmployee(employeeOffTarget!.id, { active: false })
            setEmployeeOffTarget(null)
            reload()
            message.success('Đã khoá nhân viên')
          })
        }
      />
    </>
  )
}
