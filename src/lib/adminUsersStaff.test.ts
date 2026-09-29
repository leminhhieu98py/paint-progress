/*
  Unit tests for the admin-users Edge Function's pure rules
  (supabase/functions/admin-users/staff.ts). They live under src/ because the
  unit configuration scans src only; the file under test imports nothing, so
  Node runs it as Deno does.
*/
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  changeRole, duplicateNameMessage, parseChangeRole, personNameKey, safeError, validateCreate,
  USERNAME_RULE,
  type AccountRow, type DbError, type EmployeeRow, type StaffPorts,
} from '../../supabase/functions/admin-users/staff.ts'

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('validateCreate (NL-05)', () => {
  const base = { username: ' GS.Hieu ', fullName: '  Lê Trung Hiếu ', password: 'p'.repeat(12) }

  it('needs a project for a GS', () => {
    expect(validateCreate({ ...base, role: 'gs' })).toEqual({ ok: false, error: 'projectId is required for a GS account' })
  })

  it('defaults to gs when no role is sent, as the app before Rv2 did', () => {
    const r = validateCreate({ ...base, projectId: 'p1' })
    expect(r.ok && r.value.role).toBe('gs')
  })

  it('creates a Visitor without a project, and drops one that is sent', () => {
    expect(validateCreate({ ...base, role: 'viewer' })).toEqual({
      ok: true,
      value: { username: 'gs.hieu', fullName: 'Lê Trung Hiếu', password: base.password, role: 'viewer', projectId: null },
    })
    const sent = validateCreate({ ...base, role: 'viewer', projectId: 'p1' })
    expect(sent.ok && sent.value.projectId).toBeNull()
  })

  it('keeps the project of a GS, trims the name and folds the login', () => {
    expect(validateCreate({ ...base, role: 'gs', projectId: 'p1' })).toEqual({
      ok: true,
      value: { username: 'gs.hieu', fullName: 'Lê Trung Hiếu', password: base.password, role: 'gs', projectId: 'p1' },
    })
  })

  it('refuses a missing field, an unknown role and a login outside the pattern', () => {
    expect(validateCreate({ ...base, fullName: '  ', role: 'viewer' }).ok).toBe(false)
    expect(validateCreate({ ...base, role: 'admin', projectId: 'p1' })).toEqual({ ok: false, error: 'role must be gs or viewer' })
    expect(validateCreate({ ...base, username: 'a b', role: 'viewer' })).toEqual({ ok: false, error: USERNAME_RULE })
    expect(validateCreate({ ...base, username: 42, role: 'viewer' }).ok).toBe(false)
  })
})

describe('names', () => {
  it('folds as lower(btrim()) does', () => {
    expect(personNameKey('  Nguyễn Văn A ')).toBe('nguyễn văn a')
  })

  it('says which list holds a refused name', () => {
    expect(duplicateNameMessage({ code: 'PPDUP', details: 'account' }, 'A')).toBe('Đã có tài khoản GS/Visitor tên "A".')
    expect(duplicateNameMessage({ code: 'PPDUP', details: 'employee' }, 'A')).toBe('Đã có nhân viên tên "A".')
  })

  it('says when the holder of the name is hidden or retired', () => {
    expect(duplicateNameMessage({ code: 'PPDUP', details: 'hidden_account' }, 'A'))
      .toBe('Đã có tài khoản GS/Visitor tên "A" (đã ẩn; chọn Trạng thái «Đã ẩn» để thấy).')
    expect(duplicateNameMessage({ code: 'PPDUP', details: 'retired_employee' }, 'A'))
      .toBe('Đã có nhân viên tên "A" (đã nghỉ; chọn Trạng thái «Đã nghỉ» để thấy).')
  })

  it('reads 23505 as a duplicate employee only on an employees write', () => {
    expect(duplicateNameMessage({ code: '23505' }, 'A', true)).toBe('Đã có nhân viên tên "A".')
    expect(duplicateNameMessage({ code: '23505' }, 'A')).toBeNull()
    expect(duplicateNameMessage(null, 'A')).toBeNull()
  })

  it('does not mistake the name refusal for a duplicate login', () => {
    expect(safeError('Không tạo được hồ sơ', 'duplicate_person_name: A is already the name of an employee'))
      .toBe('Không tạo được hồ sơ. Chi tiết đã được ghi vào log máy chủ.')
    expect(safeError('Không tạo được hồ sơ', 'duplicate key value violates unique constraint "profiles_username_key"'))
      .toBe('Tên đăng nhập này đã có người dùng')
  })
})

describe('parseChangeRole', () => {
  it('reads a well-formed body and folds the login', () => {
    expect(parseChangeRole({ kind: 'employee', id: 'e1', role: 'gs', username: ' GS.A ', password: 'x', projectId: 'p1' })).toEqual({
      ok: true,
      value: { kind: 'employee', id: 'e1', role: 'gs', username: 'gs.a', password: 'x', projectId: 'p1' },
    })
  })

  it('refuses an unknown kind, a missing id and an unknown role', () => {
    expect(parseChangeRole({ kind: 'admin', id: 'x', role: 'gs' }).ok).toBe(false)
    expect(parseChangeRole({ kind: 'account', role: 'gs' }).ok).toBe(false)
    expect(parseChangeRole({ kind: 'account', id: 'x', role: 'admin' }).ok).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// changeRole, against an in-memory stand-in that enforces 0037 like the DB.
// ---------------------------------------------------------------------------

type PortName = keyof StaffPorts

interface World {
  employees: EmployeeRow[]
  accounts: AccountRow[]
  banned: Set<string>
  passwords: Map<string, string>
  credentials: Map<string, string>
  members: Array<{ userId: string; projectId: string }>
  authUsers: Set<string>
}

const key = personNameKey

/** `vanished`: the employee row is gone by the time it is deleted (a concurrent conversion). */
function makePorts(world: World, failing: Partial<Record<PortName, DbError>> = {}, opts: { vanished?: boolean } = {}) {
  let seq = 0
  const calls: PortName[] = []
  const failOnce = (name: PortName): DbError | null => {
    calls.push(name)
    const f = failing[name]
    if (f) {
      delete failing[name]
      return f
    }
    return null
  }
  /** 0037, as the two triggers enforce it. */
  const accountClash = (name: string, selfId: string | null, visibleOnly: boolean) =>
    world.accounts.some((a) => a.id !== selfId && ['gs', 'viewer'].includes(a.role) && (!visibleOnly || !a.hidden) && key(a.fullName) === key(name))
  const employeeClash = (name: string) => world.employees.some((e) => key(e.fullName) === key(name))

  // Reads hand out copies, as PostgREST does: a caller holding a row must not
  // see it change under it.
  const ports: StaffPorts = {
    async readEmployee(id) {
      const error = failOnce('readEmployee')
      const row = world.employees.find((e) => e.id === id)
      return { row: error || !row ? null : { ...row }, error }
    },
    async readAccount(id) {
      const error = failOnce('readAccount')
      const row = world.accounts.find((a) => a.id === id)
      return { row: error || !row ? null : { ...row }, error }
    },
    async listHiddenAccounts() {
      const error = failOnce('listHiddenAccounts')
      return { rows: error ? [] : world.accounts.filter((a) => a.hidden && a.role !== 'admin').map((a) => ({ ...a })), error }
    },
    async createAuthUser(username) {
      const error = failOnce('createAuthUser')
      if (error) return { userId: null, error }
      if (world.accounts.some((a) => a.username === username)) {
        return { userId: null, error: { message: 'A user with this email address has already been registered' } }
      }
      const userId = `u${++seq}`
      world.authUsers.add(userId)
      return { userId, error: null }
    },
    async deleteAuthUser(userId) {
      const error = failOnce('deleteAuthUser')
      if (error) return error
      world.authUsers.delete(userId)
      world.accounts = world.accounts.filter((a) => a.id !== userId)
      world.credentials.delete(userId)
      world.members = world.members.filter((m) => m.userId !== userId)
      return null
    },
    async setAuthPassword(userId, password) {
      const error = failOnce('setAuthPassword')
      if (!error) world.passwords.set(userId, password)
      return error
    },
    async setBanned(userId, banned) {
      const error = failOnce('setBanned')
      if (!error) {
        if (banned) world.banned.add(userId)
        else world.banned.delete(userId)
      }
      return error
    },
    async insertProfile(row) {
      const error = failOnce('insertProfile')
      if (error) return error
      if (accountClash(row.fullName, row.id, false)) return { code: 'PPDUP', details: 'account' }
      if (employeeClash(row.fullName)) return { code: 'PPDUP', details: 'employee' }
      world.accounts.push({ id: row.id, username: row.username, fullName: row.fullName, role: row.role, active: true, hidden: false })
      return null
    },
    async updateProfile(id, patch) {
      const error = failOnce('updateProfile')
      if (error) return error
      const current = world.accounts.find((a) => a.id === id)!
      const next = { ...current, ...patch }
      if (('role' in patch || 'hidden' in patch) && ['gs', 'viewer'].includes(next.role)) {
        if (accountClash(next.fullName, id, false)) return { code: 'PPDUP', details: 'account' }
        if (!next.hidden && employeeClash(next.fullName)) return { code: 'PPDUP', details: 'employee' }
      }
      Object.assign(current, patch)
      return null
    },
    async storeCredential(userId, password) {
      const error = failOnce('storeCredential')
      if (!error) world.credentials.set(userId, password)
      return error
    },
    async addMembership(userId, projectId) {
      const error = failOnce('addMembership')
      if (error) return error
      if (!world.members.some((m) => m.userId === userId && m.projectId === projectId)) world.members.push({ userId, projectId })
      return null
    },
    async insertEmployee(fullName, active) {
      const error = failOnce('insertEmployee')
      if (error) return { id: null, error }
      if (employeeClash(fullName)) return { id: null, error: { code: '23505' } }
      if (accountClash(fullName, null, true)) return { id: null, error: { code: 'PPDUP', details: 'account' } }
      const id = `e${++seq}`
      world.employees.push({ id, fullName, active })
      return { id, error: null }
    },
    async readCredential(userId) {
      const error = failOnce('readCredential')
      return { password: error ? null : world.credentials.get(userId) ?? null, error }
    },
    async deleteEmployee(id) {
      const error = failOnce('deleteEmployee')
      if (error) return { deleted: false, error }
      if (opts.vanished) world.employees = world.employees.filter((e) => e.id !== id)
      const before = world.employees.length
      world.employees = world.employees.filter((e) => e.id !== id)
      return { deleted: world.employees.length < before, error: null }
    },
  }
  return { ports, calls }
}

const PW = 'mat-khau-moi-12'

function freshWorld(): World {
  return {
    employees: [
      { id: 'e-hai', fullName: 'MC005593 - Cao Minh Hải', active: true },
      { id: 'e-lan', fullName: 'Trần Thị Lan', active: false },
    ],
    accounts: [
      { id: 'u-gs', username: 'gs.hieu', fullName: 'Lê Trung Hiếu', role: 'gs', active: true, hidden: false },
      { id: 'u-view', username: 'sep.mot', fullName: 'Sếp Một', role: 'viewer', active: true, hidden: false },
      { id: 'u-parked', username: 'lan.cu', fullName: ' trần thị lan', role: 'viewer', active: false, hidden: true },
      { id: 'u-admin', username: 'admin', fullName: 'Quản trị', role: 'admin', active: true, hidden: false },
    ],
    banned: new Set(['u-parked']),
    passwords: new Map([['u-parked', 'mat-khau-cu-12']]),
    credentials: new Map([['u-parked', 'mat-khau-cu-12']]),
    members: [{ userId: 'u-gs', projectId: 'p1' }],
    authUsers: new Set(['u-gs', 'u-view', 'u-parked', 'u-admin']),
  }
}

describe('changeRole: employee → GS/Visitor, a new account (NL-04)', () => {
  it('creates the account under the employee\'s name, then the employee row is gone', async () => {
    const world = freshWorld()
    const { ports } = makePorts(world)
    const out = await changeRole(ports, { kind: 'employee', id: 'e-hai', role: 'gs', username: 'gs.hai', password: PW, projectId: 'p2' })

    expect(out.status).toBe(200)
    expect(out.body).toMatchObject({ username: 'gs.hai', reactivated: false })
    const made = world.accounts.find((a) => a.username === 'gs.hai')!
    expect(made).toMatchObject({ fullName: 'MC005593 - Cao Minh Hải', role: 'gs', active: true, hidden: false })
    expect(world.credentials.get(made.id)).toBe(PW)
    expect(world.members).toContainEqual({ userId: made.id, projectId: 'p2' })
    expect(world.employees.map((e) => e.id)).not.toContain('e-hai')
  })

  it('writes no project membership for a Visitor', async () => {
    const world = freshWorld()
    const { ports } = makePorts(world)
    const out = await changeRole(ports, { kind: 'employee', id: 'e-hai', role: 'viewer', username: 'hai.xem', password: PW, projectId: 'p2' })
    expect(out.status).toBe(200)
    const made = world.accounts.find((a) => a.username === 'hai.xem')!
    expect(world.members.filter((m) => m.userId === made.id)).toEqual([])
  })

  it('refuses before touching anything when the password, project, or login is missing or malformed', async () => {
    for (const input of [
      { role: 'gs' as const, username: 'gs.hai', password: '', projectId: 'p2' },
      { role: 'gs' as const, username: 'gs.hai', password: PW, projectId: '' },
      { role: 'viewer' as const, username: '', password: PW },
      { role: 'viewer' as const, username: 'Hai Xem', password: PW },
    ]) {
      const world = freshWorld()
      const { ports, calls } = makePorts(world)
      const out = await changeRole(ports, { kind: 'employee', id: 'e-hai', ...input })
      expect(out.status).toBe(400)
      expect(calls.filter((c) => !c.startsWith('read') && c !== 'listHiddenAccounts')).toEqual([])
      expect(world).toEqual(freshWorld())
    }
  })

  it('says so when the employee is gone', async () => {
    const { ports } = makePorts(freshWorld())
    const out = await changeRole(ports, { kind: 'employee', id: 'nope', role: 'viewer', username: 'x.y.z', password: PW })
    expect(out).toEqual({ status: 404, body: { error: 'Không tìm thấy nhân viên này' } })
  })

  it('keeps the employee when the login is taken', async () => {
    const world = freshWorld()
    const { ports } = makePorts(world)
    const out = await changeRole(ports, { kind: 'employee', id: 'e-hai', role: 'viewer', username: 'gs.hieu', password: PW })
    expect(out).toEqual({ status: 400, body: { error: 'Tên đăng nhập này đã có người dùng' } })
    expect(world).toEqual(freshWorld())
  })

  it.each([
    ['insertProfile', 'Không tạo được hồ sơ người dùng'],
    ['storeCredential', 'Không lưu được thông tin đăng nhập'],
    ['addMembership', 'Không gán được dự án cho tài khoản'],
  ] as const)('removes the new login and puts the employee back when %s fails', async (port, text) => {
    const world = freshWorld()
    const { ports } = makePorts(world, { [port]: { message: 'boom' } })
    const out = await changeRole(ports, { kind: 'employee', id: 'e-hai', role: 'gs', username: 'gs.hai', password: PW, projectId: 'p2' })
    expect(out.status).toBe(400)
    expect(String(out.body.error)).toContain(text)
    expect(world.accounts.map((a) => a.username)).not.toContain('gs.hai')
    expect(world.authUsers).toEqual(freshWorld().authUsers)
    expect(world.employees.map((e) => [e.fullName, e.active])).toContainEqual(['MC005593 - Cao Minh Hải', true])
  })

  it('removes the new login when the employee row cannot be deleted', async () => {
    const world = freshWorld()
    const { ports } = makePorts(world, { deleteEmployee: { message: 'boom' } })
    const out = await changeRole(ports, { kind: 'employee', id: 'e-hai', role: 'viewer', username: 'hai.xem', password: PW })
    expect(out.status).toBe(500)
    expect(world).toEqual(freshWorld())
  })

  it.each([
    ['a new account', { kind: 'employee' as const, id: 'e-hai', role: 'viewer' as const, username: 'hai.xem', password: PW }],
    ['a re-opened account', { kind: 'employee' as const, id: 'e-lan', role: 'viewer' as const, password: PW }],
  ])('says to reload, not "half-way", when someone else converted the employee first (%s)', async (_what, input) => {
    const world = freshWorld()
    const { ports } = makePorts(world, {}, { vanished: true })
    const out = await changeRole(ports, input)
    expect(out).toEqual({ status: 409, body: { error: 'Nhân viên này đã có người khác đổi; tải lại danh sách rồi thử lại.' } })
    const fresh = freshWorld()
    expect(world.accounts).toEqual(fresh.accounts)
    expect(world.authUsers).toEqual(fresh.authUsers)
  })

  it('says plainly when the undo fails too', async () => {
    const world = freshWorld()
    const { ports } = makePorts(world, { storeCredential: { message: 'boom' }, insertEmployee: { message: 'boom' } })
    const out = await changeRole(ports, { kind: 'employee', id: 'e-hai', role: 'viewer', username: 'hai.xem', password: PW })
    expect(out.status).toBe(500)
    expect(String(out.body.error)).toContain('thất bại nửa chừng')
    expect(String(out.body.error)).toContain('MC005593 - Cao Minh Hải')
  })
})

describe('changeRole: employee → GS/Visitor, re-opening a parked account (A1, NL-04)', () => {
  it('re-opens the hidden account of the same name instead of making a second one', async () => {
    const world = freshWorld()
    const { ports, calls } = makePorts(world)
    const out = await changeRole(ports, { kind: 'employee', id: 'e-lan', role: 'gs', username: 'ignored', password: PW, projectId: 'p3' })

    expect(out).toEqual({ status: 200, body: { userId: 'u-parked', username: 'lan.cu', reactivated: true } })
    expect(calls).not.toContain('createAuthUser')
    expect(world.accounts.find((a) => a.id === 'u-parked')).toMatchObject({ role: 'gs', active: true, hidden: false })
    expect(world.banned.has('u-parked')).toBe(false)
    expect(world.passwords.get('u-parked')).toBe(PW)
    expect(world.credentials.get('u-parked')).toBe(PW)
    expect(world.members).toContainEqual({ userId: 'u-parked', projectId: 'p3' })
    expect(world.employees.map((e) => e.id)).not.toContain('e-lan')
  })

  it('does not need a login to re-open one', async () => {
    const { ports } = makePorts(freshWorld())
    const out = await changeRole(ports, { kind: 'employee', id: 'e-lan', role: 'viewer', password: PW })
    expect(out.status).toBe(200)
  })

  it('sets the real password before it stores it', async () => {
    const { ports, calls } = makePorts(freshWorld())
    await changeRole(ports, { kind: 'employee', id: 'e-lan', role: 'viewer', password: PW })
    expect(calls.indexOf('setAuthPassword')).toBeLessThan(calls.indexOf('storeCredential'))
    expect(calls.indexOf('readCredential')).toBeLessThan(calls.indexOf('deleteEmployee'))
  })

  it.each([
    ['storeCredential'],
    ['addMembership'],
  ] as const)('puts the old password back, real and stored, when %s fails', async (port) => {
    const world = freshWorld()
    const { ports } = makePorts(world, { [port]: { message: 'boom' } })
    const out = await changeRole(ports, { kind: 'employee', id: 'e-lan', role: 'gs', password: PW, projectId: 'p3' })
    expect(out.status).toBe(500)
    expect(world.passwords.get('u-parked')).toBe('mat-khau-cu-12')
    expect(world.credentials.get('u-parked')).toBe('mat-khau-cu-12')
    const fresh = freshWorld()
    expect(world.accounts).toEqual(fresh.accounts)
    expect(world.banned).toEqual(fresh.banned)
    expect(world.members).toEqual(fresh.members)
    // Back under a new id: nothing references employee ids.
    expect(world.employees.map((e) => [e.fullName, e.active])).toEqual(fresh.employees.map((e) => [e.fullName, e.active]))
  })

  it('keeps the real and the stored password equal when there was no stored one to go back to', async () => {
    const world = freshWorld()
    world.credentials.delete('u-parked')
    const { ports } = makePorts(world, { storeCredential: { message: 'boom' } })
    const out = await changeRole(ports, { kind: 'employee', id: 'e-lan', role: 'viewer', password: PW })
    expect(out.status).toBe(500)
    expect(world.credentials.get('u-parked')).toBe(world.passwords.get('u-parked'))
  })

  it('changes nothing when the stored password cannot be read', async () => {
    const world = freshWorld()
    const { ports } = makePorts(world, { readCredential: { message: 'boom' } })
    expect((await changeRole(ports, { kind: 'employee', id: 'e-lan', role: 'viewer', password: PW })).status).toBe(500)
    expect(world).toEqual(freshWorld())
  })

  it('parks the account again and puts the employee back when a step fails', async () => {
    const world = freshWorld()
    const { ports } = makePorts(world, { setAuthPassword: { message: 'boom' } })
    const out = await changeRole(ports, { kind: 'employee', id: 'e-lan', role: 'gs', password: PW, projectId: 'p3' })
    expect(out.status).toBe(500)
    expect(world.accounts.find((a) => a.id === 'u-parked')).toMatchObject({ role: 'viewer', active: false, hidden: true })
    expect(world.banned.has('u-parked')).toBe(true)
    expect(world.employees.map((e) => [e.fullName, e.active])).toContainEqual(['Trần Thị Lan', false])
  })
})

describe('changeRole: GS/Visitor → employee (A1)', () => {
  it('locks and hides the account, keeps its projects, and adds the employee', async () => {
    const world = freshWorld()
    const { ports } = makePorts(world)
    const out = await changeRole(ports, { kind: 'account', id: 'u-gs', role: 'employee' })

    expect(out.status).toBe(200)
    const employee = world.employees.find((e) => e.id === out.body.employeeId)!
    expect(employee).toMatchObject({ fullName: 'Lê Trung Hiếu', active: true })
    expect(world.accounts.find((a) => a.id === 'u-gs')).toMatchObject({ active: false, hidden: true })
    expect(world.banned.has('u-gs')).toBe(true)
    expect(world.members).toContainEqual({ userId: 'u-gs', projectId: 'p1' })
    expect(world.authUsers.has('u-gs')).toBe(true)
  })

  it('gives the account back its state when the employee cannot be added', async () => {
    const world = freshWorld()
    const { ports } = makePorts(world, { insertEmployee: { message: 'boom' } })
    const out = await changeRole(ports, { kind: 'account', id: 'u-gs', role: 'employee' })
    expect(out.status).toBe(500)
    expect(world).toEqual(freshWorld())
  })

  it('names the employee who already holds the name', async () => {
    const world = freshWorld()
    const { ports } = makePorts(world)
    const out = await changeRole(ports, { kind: 'account', id: 'u-parked', role: 'employee' })
    expect(out).toEqual({ status: 400, body: { error: 'Đã có nhân viên tên " trần thị lan".' } })
    expect(world).toEqual(freshWorld())
  })

  it('refuses an admin and a missing account', async () => {
    const { ports } = makePorts(freshWorld())
    expect((await changeRole(ports, { kind: 'account', id: 'u-admin', role: 'employee' })).status).toBe(403)
    expect((await changeRole(ports, { kind: 'account', id: 'nope', role: 'employee' })).status).toBe(404)
  })
})

describe('changeRole: GS ↔ Visitor', () => {
  it('turns a GS into a Visitor and keeps the memberships', async () => {
    const world = freshWorld()
    const { ports } = makePorts(world)
    expect(await changeRole(ports, { kind: 'account', id: 'u-gs', role: 'viewer' })).toEqual({ status: 200, body: { ok: true } })
    expect(world.accounts.find((a) => a.id === 'u-gs')?.role).toBe('viewer')
    expect(world.members).toContainEqual({ userId: 'u-gs', projectId: 'p1' })
  })

  it('needs a project to turn a Visitor into a GS, and adds it', async () => {
    const world = freshWorld()
    const { ports } = makePorts(world)
    expect((await changeRole(ports, { kind: 'account', id: 'u-view', role: 'gs' })).status).toBe(400)
    expect(await changeRole(ports, { kind: 'account', id: 'u-view', role: 'gs', projectId: 'p2' })).toEqual({ status: 200, body: { ok: true } })
    expect(world.accounts.find((a) => a.id === 'u-view')?.role).toBe('gs')
    expect(world.members).toContainEqual({ userId: 'u-view', projectId: 'p2' })
  })

  it('puts the role back when the project cannot be added', async () => {
    const world = freshWorld()
    const { ports } = makePorts(world, { addMembership: { message: 'boom' } })
    const out = await changeRole(ports, { kind: 'account', id: 'u-view', role: 'gs', projectId: 'p2' })
    expect(out.status).toBe(500)
    expect(world.accounts.find((a) => a.id === 'u-view')?.role).toBe('viewer')
  })

  it('does nothing when the role is already the one asked for', async () => {
    const world = freshWorld()
    const { ports, calls } = makePorts(world)
    expect((await changeRole(ports, { kind: 'account', id: 'u-gs', role: 'gs' })).status).toBe(200)
    expect(calls).toEqual(['readAccount'])
  })

  it('refuses turning an employee into an employee', async () => {
    const { ports } = makePorts(freshWorld())
    expect((await changeRole(ports, { kind: 'employee', id: 'e-hai', role: 'employee' })).status).toBe(400)
  })
})
