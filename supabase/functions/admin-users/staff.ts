/**
 * Nhân lực (NL-03, NL-04, NL-05): the account rules of admin-users that need
 * no Deno, no network and no key, so they can be unit-tested -- the
 * validation of `create`, the Vietnamese sentence for a refused name, and the
 * whole `change_role` flow, written against `StaffPorts` so a test can stand
 * in for the service_role client. index.ts supplies the real ports.
 *
 * Pure TypeScript with no imports on purpose: the unit test imports this file
 * from `src/`, and index.ts from Deno.
 */

/** The roles `create` may hand out. An admin is never created here. */
export const MANAGED_ROLES = ['gs', 'viewer'] as const
export type ManagedRole = (typeof MANAGED_ROLES)[number]

/**
 * The login name, as stored: trimmed, lower-cased, and only the characters a
 * foreman can read out over a radio. It is also the local part of the auth
 * email, so the set stays inside what an email address accepts.
 */
export const USERNAME_PATTERN = /^[a-z0-9._-]{3,32}$/
export const USERNAME_RULE = 'Tên đăng nhập chỉ gồm chữ thường, số, dấu chấm, gạch ngang, gạch dưới (3-32 ký tự)'

/** A PostgREST / auth error, as far as this file reads it. */
export interface DbError {
  code?: string
  message?: string
  details?: string | null
}

/**
 * What the caller is told when a database or auth call fails.
 *
 * The raw message carries table names, constraint names and schema detail, and
 * every branch here used to return it verbatim -- the final catch block was the
 * only one that did not. This surface is admin-only, so it is not an open door;
 * it is free reconnaissance for anyone who reaches it, and it is unreadable for
 * the admin who does belong here.
 *
 * The one case worth translating is a duplicate username, because that is a
 * thing the admin can fix by typing something else. Everything else becomes a
 * fixed sentence, with the detail written to the function log where an operator
 * can read it and an attacker cannot.
 */
export function safeError(context: string, raw: string | undefined): string {
  console.error(`admin-users: ${context}: ${raw ?? '(no message)'}`)
  if (raw && /duplicate key|already (been )?registered|unique constraint/i.test(raw)) {
    return 'Tên đăng nhập này đã có người dùng'
  }
  return `${context}. Chi tiết đã được ghi vào log máy chủ.`
}

/** `lower(btrim(name))`, as 0032's index and 0037's triggers compare names. */
export function personNameKey(name: string): string {
  return name.replace(/^ +| +$/g, '').toLowerCase()
}

/**
 * The admin's sentence for a name 0037 refused (SQLSTATE PPDUP, DETAIL says
 * which list holds it) or the employees' own index refused (23505 on an
 * employees write), or null when the error is something else. Callers pass
 * `employeeWrite` so a 23505 from `profiles` -- the username index -- is left
 * to safeError's username sentence.
 */
export function duplicateNameMessage(error: DbError | null, name: string, employeeWrite = false): string | null {
  if (!error) return null
  if (error.code === 'PPDUP') {
    // DETAIL: account | hidden_account | employee | retired_employee (0037).
    // The two out-of-view holders say how to find them on Nhân lực.
    switch (error.details) {
      case 'account': return `Đã có tài khoản GS/Visitor tên "${name}".`
      case 'hidden_account': return `Đã có tài khoản GS/Visitor tên "${name}" (đã ẩn; chọn Trạng thái «Đã ẩn» để thấy).`
      case 'retired_employee': return `Đã có nhân viên tên "${name}" (đã nghỉ; chọn Trạng thái «Đã nghỉ» để thấy).`
      default: return `Đã có nhân viên tên "${name}".`
    }
  }
  if (employeeWrite && error.code === '23505') return `Đã có nhân viên tên "${name}".`
  return null
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

export interface CreateInput {
  username: string
  fullName: string
  password: string
  role: ManagedRole
  /** Null for a Visitor: since 0034 a viewer reads every project (NL-05). */
  projectId: string | null
}

/**
 * The `create` body, checked. A GS needs a project -- without one it sees
 * nothing; a Visitor does not (NL-05), and a project sent for one is ignored
 * rather than written: `project_members` means nothing for a viewer since
 * 0034, and a row there told the admin the account was limited to it.
 * The role still defaults to gs: the app before Feedback Rv2 never sent one.
 */
export function validateCreate(body: Record<string, unknown>): { ok: true; value: CreateInput } | { ok: false; error: string } {
  const username = str(body.username).trim().toLowerCase()
  const fullName = str(body.fullName).trim()
  const password = str(body.password)
  const role = (str(body.role) || 'gs') as ManagedRole
  const projectId = str(body.projectId)
  if (!username || !fullName || !password) {
    return { ok: false, error: 'username, fullName, password are required' }
  }
  if (!MANAGED_ROLES.includes(role)) return { ok: false, error: 'role must be gs or viewer' }
  if (role === 'gs' && !projectId) return { ok: false, error: 'projectId is required for a GS account' }
  if (!USERNAME_PATTERN.test(username)) return { ok: false, error: USERNAME_RULE }
  return { ok: true, value: { username, fullName, password, role, projectId: role === 'gs' ? projectId : null } }
}

export interface AccountRow {
  id: string
  username: string
  fullName: string
  role: string
  active: boolean
  hidden: boolean
}

export interface EmployeeRow {
  id: string
  fullName: string
  active: boolean
}

/**
 * Everything `change_role` does to the outside world. Writes resolve to the
 * error or null; nothing throws on an ordinary failure.
 */
export interface StaffPorts {
  readEmployee(id: string): Promise<{ row: EmployeeRow | null; error: DbError | null }>
  readAccount(id: string): Promise<{ row: AccountRow | null; error: DbError | null }>
  /** Every hidden GS/Visitor account; a handful, matched by name here. */
  listHiddenAccounts(): Promise<{ rows: AccountRow[]; error: DbError | null }>
  createAuthUser(username: string, password: string): Promise<{ userId: string | null; error: DbError | null }>
  deleteAuthUser(userId: string): Promise<DbError | null>
  setAuthPassword(userId: string, password: string): Promise<DbError | null>
  /** Ban (no sign-in) or lift the ban. */
  setBanned(userId: string, banned: boolean): Promise<DbError | null>
  insertProfile(row: { id: string; username: string; fullName: string; role: ManagedRole }): Promise<DbError | null>
  updateProfile(id: string, patch: { role?: string; active?: boolean; hidden?: boolean }): Promise<DbError | null>
  /** Encrypts and upserts the stored password. */
  storeCredential(userId: string, password: string): Promise<DbError | null>
  /** Adds the project unless the account is already in it (memberships kept). */
  addMembership(userId: string, projectId: string): Promise<DbError | null>
  insertEmployee(fullName: string, active: boolean): Promise<{ id: string | null; error: DbError | null }>
  deleteEmployee(id: string): Promise<DbError | null>
}

export interface Outcome {
  status: number
  body: Record<string, unknown>
}

const ok = (body: Record<string, unknown>): Outcome => ({ status: 200, body })
const fail = (status: number, error: string): Outcome => ({ status, body: { error } })

export type TargetRole = ManagedRole | 'employee'

export interface ChangeRoleInput {
  /** Which list the row is on today. */
  kind: 'employee' | 'account'
  id: string
  role: TargetRole
  /** employee → account only; ignored when a hidden account is re-opened. */
  username?: string
  /** employee → account only. */
  password?: string
  /** → gs only. */
  projectId?: string
}

/** Reads and checks the body of a `change_role` call. */
export function parseChangeRole(body: Record<string, unknown>): { ok: true; value: ChangeRoleInput } | { ok: false; error: string } {
  const kind = str(body.kind)
  const id = str(body.id)
  const role = str(body.role)
  if (kind !== 'employee' && kind !== 'account') return { ok: false, error: 'kind must be employee or account' }
  if (!id) return { ok: false, error: 'id is required' }
  if (role !== 'employee' && !MANAGED_ROLES.includes(role as ManagedRole)) {
    return { ok: false, error: 'role must be employee, gs or viewer' }
  }
  return {
    ok: true,
    value: {
      kind,
      id,
      role: role as TargetRole,
      username: str(body.username).trim().toLowerCase(),
      password: str(body.password),
      projectId: str(body.projectId),
    },
  }
}

/**
 * NL-04: moves one person between the two lists, as far as the database allows
 * atomically -- which is not at all, since an auth user and two tables are
 * involved -- so every step that can fail undoes the ones before it, and a
 * failed undo says so instead of reporting the first error.
 *
 * The order follows 0037: an employee and a VISIBLE account never share a
 * name, so the employee row goes before the account appears, and the account
 * is hidden before the employee row appears.
 *
 *   employee → gs/viewer  A hidden account with the same name (parked by an
 *                         earlier account → employee) is re-opened: role,
 *                         password, project for a GS, unhidden, unlocked. Else
 *                         a new account, as `create` makes one. The employee
 *                         row is deleted first; any later failure puts it back
 *                         (a new id -- nothing references employee ids; the
 *                         effort history holds names) and removes the new auth
 *                         user or re-parks the re-opened account.
 *   gs/viewer → employee  Ruling A1: the account is locked and hidden, never
 *                         deleted (a delete would null cell_events.by and
 *                         credential-log links for good), then the employee row
 *                         is inserted; if that fails the account gets its
 *                         previous state back.
 *   gs ↔ viewer           The role flips; memberships are kept (a viewer reads
 *                         every project anyway, 0034). Becoming a GS needs a
 *                         project, as creating one does.
 */
export async function changeRole(ports: StaffPorts, input: ChangeRoleInput): Promise<Outcome> {
  if (input.kind === 'employee') {
    if (input.role === 'employee') return fail(400, 'This row is already an employee')
    return employeeToAccount(ports, input, input.role)
  }

  const { row: account, error: readError } = await ports.readAccount(input.id)
  if (readError) return fail(500, safeError('Không đọc được tài khoản', readError.message))
  if (!account) return fail(404, 'No such account')
  if (account.role === 'admin') return fail(403, 'This action is only available for GS and viewer accounts')

  if (input.role === 'employee') return accountToEmployee(ports, account)
  return switchAccountRole(ports, account, input.role, input.projectId ?? '')
}

async function employeeToAccount(ports: StaffPorts, input: ChangeRoleInput, role: ManagedRole): Promise<Outcome> {
  const password = input.password ?? ''
  const projectId = input.projectId ?? ''
  if (!password) return fail(400, 'password is required')
  if (role === 'gs' && !projectId) return fail(400, 'projectId is required for a GS account')

  const { row: employee, error: employeeError } = await ports.readEmployee(input.id)
  if (employeeError) return fail(500, safeError('Không đọc được nhân viên', employeeError.message))
  if (!employee) return fail(404, 'Không tìm thấy nhân viên này')

  const { rows: hidden, error: hiddenError } = await ports.listHiddenAccounts()
  if (hiddenError) return fail(500, safeError('Không đọc được các tài khoản đã ẩn', hiddenError.message))
  const key = personNameKey(employee.fullName)
  const parked = hidden.find((a) => personNameKey(a.fullName) === key && a.role !== 'admin') ?? null

  /** Puts the employee back after a later step failed; returns why it could not. */
  const restoreEmployee = async (): Promise<string | null> => {
    const { error } = await ports.insertEmployee(employee.fullName, employee.active)
    return error ? `nhân viên «${employee.fullName}» đã bị xoá và chưa thêm lại được` : null
  }

  if (parked) {
    const deleted = await ports.deleteEmployee(employee.id)
    if (deleted) return fail(500, safeError('Không xoá được dòng nhân viên', deleted.message))

    const undo = async (message: string): Promise<Outcome> => {
      const problems: string[] = []
      if (await ports.setBanned(parked.id, true)) problems.push('tài khoản chưa khoá lại được')
      if (await ports.updateProfile(parked.id, { role: parked.role, active: false, hidden: true })) {
        problems.push('tài khoản chưa ẩn lại được')
      }
      const lost = await restoreEmployee()
      if (lost) problems.push(lost)
      if (problems.length > 0) {
        return fail(500, `Đổi phân quyền thất bại nửa chừng: ${problems.join('; ')}. Chi tiết đã được ghi vào log máy chủ.`)
      }
      return fail(500, message)
    }

    // Still locked while it changes: nobody signs in to a half-restored account.
    const shown = await ports.updateProfile(parked.id, { role, active: false, hidden: false })
    if (shown) {
      const lost = await restoreEmployee()
      const named = duplicateNameMessage(shown, employee.fullName)
      if (lost) return fail(500, `Đổi phân quyền thất bại nửa chừng: ${lost}. Chi tiết đã được ghi vào log máy chủ.`)
      return fail(named ? 400 : 500, named ?? safeError('Không mở lại được tài khoản cũ', shown.message))
    }
    const stored = await ports.storeCredential(parked.id, password)
    if (stored) return undo(safeError('Không lưu được mật khẩu mới', stored.message))
    const passworded = await ports.setAuthPassword(parked.id, password)
    if (passworded) return undo(safeError('Không đổi được mật khẩu', passworded.message))
    if (role === 'gs') {
      const member = await ports.addMembership(parked.id, projectId)
      if (member) return undo(safeError('Không gán được dự án cho tài khoản', member.message))
    }
    const unbanned = await ports.setBanned(parked.id, false)
    if (unbanned) return undo(safeError('Không mở khoá được tài khoản', unbanned.message))
    const active = await ports.updateProfile(parked.id, { active: true })
    if (active) return undo(safeError('Không đánh dấu được tài khoản là đang dùng', active.message))
    return ok({ userId: parked.id, username: parked.username, reactivated: true })
  }

  const username = input.username ?? ''
  if (!username) return fail(400, 'username is required')
  if (!USERNAME_PATTERN.test(username)) return fail(400, USERNAME_RULE)

  const { userId, error: createError } = await ports.createAuthUser(username, password)
  if (createError || !userId) return fail(400, safeError('Không tạo được tài khoản', createError?.message))

  const deleted = await ports.deleteEmployee(employee.id)
  if (deleted) {
    if (await ports.deleteAuthUser(userId)) {
      return fail(500, `Account setup failed and cleanup also failed -- auth user ${userId} is orphaned and needs manual deletion`)
    }
    return fail(500, safeError('Không xoá được dòng nhân viên', deleted.message))
  }

  /** Removes the new auth user (its profile and credential go with it) and restores the employee. */
  const rollback = async (status: number, message: string): Promise<Outcome> => {
    const problems: string[] = []
    if (await ports.deleteAuthUser(userId)) problems.push(`auth user ${userId} is orphaned and needs manual deletion`)
    const lost = await restoreEmployee()
    if (lost) problems.push(lost)
    if (problems.length > 0) {
      return fail(500, `Đổi phân quyền thất bại nửa chừng: ${problems.join('; ')}. Chi tiết đã được ghi vào log máy chủ.`)
    }
    return fail(status, message)
  }

  const profile = await ports.insertProfile({ id: userId, username, fullName: employee.fullName, role })
  if (profile) {
    const named = duplicateNameMessage(profile, employee.fullName)
    return rollback(400, named ?? safeError('Không tạo được hồ sơ người dùng', profile.message))
  }
  const stored = await ports.storeCredential(userId, password)
  if (stored) return rollback(400, safeError('Không lưu được thông tin đăng nhập', stored.message))
  if (role === 'gs') {
    const member = await ports.addMembership(userId, projectId)
    if (member) return rollback(400, safeError('Không gán được dự án cho tài khoản', member.message))
  }
  return ok({ userId, username, reactivated: false })
}

async function accountToEmployee(ports: StaffPorts, account: AccountRow): Promise<Outcome> {
  /** The account's state before this call, put back when the employee insert fails. */
  const restore = async (): Promise<string[]> => {
    const problems: string[] = []
    if (await ports.updateProfile(account.id, { active: account.active, hidden: account.hidden })) {
      problems.push('tài khoản chưa trả lại được trạng thái cũ')
    }
    if (account.active && (await ports.setBanned(account.id, false))) problems.push('tài khoản chưa mở khoá lại được')
    return problems
  }

  const banned = await ports.setBanned(account.id, true)
  if (banned) return fail(500, safeError('Không khoá được tài khoản', banned.message))
  const parked = await ports.updateProfile(account.id, { active: false, hidden: true })
  if (parked) {
    const problems = await restore()
    if (problems.length > 0) {
      return fail(500, `Đổi phân quyền thất bại nửa chừng: ${problems.join('; ')}. Chi tiết đã được ghi vào log máy chủ.`)
    }
    return fail(500, safeError('Không ẩn được tài khoản', parked.message))
  }

  const { id: employeeId, error: insertError } = await ports.insertEmployee(account.fullName, true)
  if (insertError || !employeeId) {
    const problems = await restore()
    if (problems.length > 0) {
      return fail(500, `Đổi phân quyền thất bại nửa chừng: ${problems.join('; ')}. Chi tiết đã được ghi vào log máy chủ.`)
    }
    const named = duplicateNameMessage(insertError, account.fullName, true)
    return fail(named ? 400 : 500, named ?? safeError('Không thêm được nhân viên', insertError?.message))
  }
  return ok({ employeeId })
}

async function switchAccountRole(ports: StaffPorts, account: AccountRow, role: ManagedRole, projectId: string): Promise<Outcome> {
  if (account.role === role) return ok({ ok: true })
  if (role === 'gs' && !projectId) return fail(400, 'projectId is required for a GS account')

  const changed = await ports.updateProfile(account.id, { role })
  if (changed) {
    const named = duplicateNameMessage(changed, account.fullName)
    return fail(named ? 400 : 500, named ?? safeError('Không đổi được phân quyền', changed.message))
  }
  if (role === 'gs') {
    const member = await ports.addMembership(account.id, projectId)
    if (member) {
      if (await ports.updateProfile(account.id, { role: account.role })) {
        return fail(500, 'Đổi phân quyền thất bại nửa chừng: tài khoản đã là GS nhưng chưa có dự án. Chi tiết đã được ghi vào log máy chủ.')
      }
      return fail(500, safeError('Không gán được dự án cho tài khoản', member.message))
    }
  }
  return ok({ ok: true })
}
