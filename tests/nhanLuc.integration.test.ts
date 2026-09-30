import { createClient, FunctionsHttpError, type SupabaseClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { toAuthEmail } from '../src/config'

/*
  Nhân lực (0037, NL-03): one person, one row across GS/Visitor accounts and
  employees, observed through a real admin session against the linked dev
  project. OWNER-RUN ONLY: it writes to the live database (it creates and
  deletes its own employees, and renames the rlstest-gs fixture's full name
  for one statement and puts it back). Skipped when .env.test.local is absent,
  like tests/rls.integration.test.ts, whose fixtures it reuses.
*/

const url = process.env.VITE_SUPABASE_URL
const anon = process.env.VITE_SUPABASE_ANON_KEY
const gsUsername = process.env.RLS_TEST_GS_USERNAME
const gsPassword = process.env.RLS_TEST_GS_PASSWORD
const adminUsername = process.env.RLS_TEST_ADMIN_USERNAME
const adminPassword = process.env.RLS_TEST_ADMIN_PASSWORD

const configured = Boolean(url && anon && gsUsername && adminUsername && adminPassword)

/** Every employee this file makes starts with this, so residue is findable. */
const EMPLOYEE_PREFIX = 'RLS NL '

/** tests/rls-teardown.sql purges accounts by this prefix and this project code. */
const EF_USERNAME_PREFIX = 'rlstest-ef-'
const NL_PROJECT_CODE = 'RLSN'

const throwawayPassword = () => `${randomUUID()}${randomUUID()}`.replace(/-/g, '')
const throwawayUsername = (kind: string) => `${EF_USERNAME_PREFIX}nl-${kind}-${Date.now().toString(36)}`

async function invokeAdminUsers(client: SupabaseClient, body: Record<string, string>) {
  const { data, error } = await client.functions.invoke('admin-users', { body })
  if (!error) return { status: 200, body: (data ?? {}) as Record<string, unknown> }
  if (error instanceof FunctionsHttpError) {
    return { status: error.context.status, body: (await error.context.json()) as Record<string, unknown> }
  }
  throw error
}

describe.skipIf(!configured)('0037 unique person names, as an admin session', () => {
  let admin: SupabaseClient
  let gsId: string
  let gsFullName: string
  const madeEmployees: string[] = []

  beforeAll(async () => {
    admin = createClient(url!, anon!, { auth: { persistSession: false } })
    const signIn = await admin.auth.signInWithPassword({
      email: toAuthEmail(adminUsername!),
      password: adminPassword!,
    })
    expect(signIn.error).toBeNull()
    const gs = await admin.from('profiles').select('id, full_name, hidden').eq('username', gsUsername!).single()
    expect(gs.error).toBeNull()
    // The fixture GS must be visible for the account half of the rule to apply.
    expect(gs.data?.hidden).toBe(false)
    gsId = gs.data!.id as string
    gsFullName = gs.data!.full_name as string
  })

  afterAll(async () => {
    if (!admin) return
    if (madeEmployees.length > 0) {
      const removed = await admin.from('employees').delete().in('id', madeEmployees)
      expect(removed.error).toBeNull()
    }
    const leftovers = await admin.from('employees').delete().like('full_name', `${EMPLOYEE_PREFIX}%`)
    expect(leftovers.error).toBeNull()
    // The fixture's name is back whatever happened above.
    const restored = await admin.from('profiles').update({ full_name: gsFullName }).eq('id', gsId)
    expect(restored.error).toBeNull()
  })

  it('refuses an employee named like a visible GS account, case and outer spaces folded', async () => {
    const attempt = await admin
      .from('employees')
      .insert({ full_name: `  ${gsFullName.toUpperCase()} ` })
      .select('id')
    expect(attempt.error?.code).toBe('PPDUP')
    expect(attempt.error?.details).toBe('account')
    expect(attempt.error?.message).toContain('duplicate_person_name')
    const none = await admin.from('employees').select('id').ilike('full_name', gsFullName.trim())
    expect(none.error).toBeNull()
    expect(none.data ?? []).toEqual([])
  })

  it('refuses renaming an employee onto a visible GS account', async () => {
    const name = `${EMPLOYEE_PREFIX}${Date.now().toString(36)} rename`
    const made = await admin.from('employees').insert({ full_name: name }).select('id').single()
    expect(made.error).toBeNull()
    madeEmployees.push(made.data!.id as string)

    const renamed = await admin.from('employees').update({ full_name: gsFullName }).eq('id', made.data!.id)
    expect(renamed.error?.code).toBe('PPDUP')
    expect(renamed.error?.details).toBe('account')
  })

  it('refuses giving a visible account the name of an employee, and lets the account keep its own', async () => {
    const name = `${EMPLOYEE_PREFIX}${Date.now().toString(36)} account`
    const made = await admin.from('employees').insert({ full_name: name }).select('id').single()
    expect(made.error).toBeNull()
    madeEmployees.push(made.data!.id as string)

    const clash = await admin.from('profiles').update({ full_name: name.toLowerCase() }).eq('id', gsId).select('full_name')
    expect(clash.error?.code).toBe('PPDUP')
    expect(clash.error?.details).toBe('employee')

    const same = await admin.from('profiles').update({ full_name: gsFullName }).eq('id', gsId).select('full_name')
    expect(same.error).toBeNull()
    expect(same.data?.[0]?.full_name).toBe(gsFullName)
  })

  it('still refuses a second employee of the same name through 0032\'s index', async () => {
    const name = `${EMPLOYEE_PREFIX}${Date.now().toString(36)} twice`
    const made = await admin.from('employees').insert({ full_name: name }).select('id').single()
    expect(made.error).toBeNull()
    madeEmployees.push(made.data!.id as string)
    const twice = await admin.from('employees').insert({ full_name: ` ${name.toUpperCase()}` })
    expect(twice.error?.code).toBe('23505')
  })
})

/*
  The admin-users Edge Function after Nhân lực (NL-04, NL-05). Needs the new
  function deployed to dev. Every account it makes is `rlstest-ef-nl-…`, which
  tests/rls-teardown.sql removes with the auth users; its employees are
  removed in afterAll.
*/
describe.skipIf(!configured)('admin-users after Nhân lực, as an admin session', () => {
  let admin: SupabaseClient
  let projectId: string
  const stamp = Date.now().toString(36)

  beforeAll(async () => {
    admin = createClient(url!, anon!, { auth: { persistSession: false } })
    const signIn = await admin.auth.signInWithPassword({
      email: toAuthEmail(adminUsername!),
      password: adminPassword!,
    })
    expect(signIn.error).toBeNull()
    await admin.from('projects').delete().eq('code', NL_PROJECT_CODE)
    const project = await admin.from('projects').insert({ name: 'RLS Nhân lực Scratch', code: NL_PROJECT_CODE }).select('id').single()
    expect(project.error).toBeNull()
    projectId = project.data!.id as string
  })

  afterAll(async () => {
    if (!admin) return
    const employees = await admin.from('employees').delete().like('full_name', `${EMPLOYEE_PREFIX}%`)
    expect(employees.error).toBeNull()
    const project = await admin.from('projects').delete().eq('code', NL_PROJECT_CODE)
    expect(project.error).toBeNull()
  })

  it('creates a Visitor without a project and writes it no membership (NL-05)', async () => {
    const made = await invokeAdminUsers(admin, {
      action: 'create', username: throwawayUsername('visitor'), fullName: `${EMPLOYEE_PREFIX}${stamp} visitor`,
      password: throwawayPassword(), role: 'viewer',
    })
    expect(made.status).toBe(200)
    const members = await admin.from('project_members').select('project_id').eq('user_id', made.body.userId as string)
    expect(members.error).toBeNull()
    expect(members.data ?? []).toEqual([])
  })

  it('still needs a project for a GS', async () => {
    const made = await invokeAdminUsers(admin, {
      action: 'create', username: throwawayUsername('noproj'), fullName: `${EMPLOYEE_PREFIX}${stamp} noproj`,
      password: throwawayPassword(), role: 'gs',
    })
    expect(made.status).toBe(400)
  })

  it('refuses an account named like an employee, in Vietnamese, and leaves no login behind', async () => {
    const name = `${EMPLOYEE_PREFIX}${stamp} taken`
    const employee = await admin.from('employees').insert({ full_name: name }).select('id').single()
    expect(employee.error).toBeNull()
    const username = throwawayUsername('taken')
    const made = await invokeAdminUsers(admin, {
      action: 'create', username, fullName: name.toUpperCase(), password: throwawayPassword(), role: 'viewer',
    })
    expect(made.status).toBe(400)
    expect(String(made.body.error)).toContain('Đã có nhân viên tên')
    const profile = await admin.from('profiles').select('id').eq('username', username)
    expect(profile.data ?? []).toEqual([])
  })

  it('turns an employee into a Visitor, back into an employee, then into a GS on the same account (NL-04, A1)', async () => {
    const name = `${EMPLOYEE_PREFIX}${stamp} round trip`
    const employee = await admin.from('employees').insert({ full_name: name }).select('id').single()
    expect(employee.error).toBeNull()
    const username = throwawayUsername('trip')

    const toVisitor = await invokeAdminUsers(admin, {
      action: 'change_role', kind: 'employee', id: employee.data!.id as string, role: 'viewer',
      username, password: throwawayPassword(),
    })
    expect(toVisitor.status).toBe(200)
    expect(toVisitor.body.reactivated).toBe(false)
    const userId = toVisitor.body.userId as string
    const gone = await admin.from('employees').select('id').eq('id', employee.data!.id as string)
    expect(gone.data ?? []).toEqual([])
    const account = await admin.from('profiles').select('full_name, role, active, hidden').eq('id', userId).single()
    expect(account.data).toEqual({ full_name: name, role: 'viewer', active: true, hidden: false })

    const toEmployee = await invokeAdminUsers(admin, { action: 'change_role', kind: 'account', id: userId, role: 'employee' })
    expect(toEmployee.status).toBe(200)
    const parked = await admin.from('profiles').select('active, hidden').eq('id', userId).single()
    expect(parked.data).toEqual({ active: false, hidden: true })
    const back = await admin.from('employees').select('full_name, active').eq('id', toEmployee.body.employeeId as string).single()
    expect(back.data).toEqual({ full_name: name, active: true })

    const toGs = await invokeAdminUsers(admin, {
      action: 'change_role', kind: 'employee', id: toEmployee.body.employeeId as string, role: 'gs',
      password: throwawayPassword(), projectId,
    })
    expect(toGs.status).toBe(200)
    expect(toGs.body).toMatchObject({ userId, username, reactivated: true })
    const reopened = await admin.from('profiles').select('role, active, hidden').eq('id', userId).single()
    expect(reopened.data).toEqual({ role: 'gs', active: true, hidden: false })
    const members = await admin.from('project_members').select('project_id').eq('user_id', userId)
    expect((members.data ?? []).map((m) => m.project_id)).toEqual([projectId])
  })

  it('refuses Hiện lại on a parked account whose name an employee now carries', async () => {
    const name = `${EMPLOYEE_PREFIX}${stamp} unhide`
    const made = await invokeAdminUsers(admin, {
      action: 'create', username: throwawayUsername('unhide'), fullName: name, password: throwawayPassword(), role: 'viewer',
    })
    expect(made.status).toBe(200)
    const toEmployee = await invokeAdminUsers(admin, {
      action: 'change_role', kind: 'account', id: made.body.userId as string, role: 'employee',
    })
    expect(toEmployee.status).toBe(200)
    const unhide = await invokeAdminUsers(admin, { action: 'unhide', userId: made.body.userId as string })
    expect(unhide.status).toBe(400)
    expect(String(unhide.body.error)).toContain('Đã có nhân viên tên')
  })
})

/*
  Review I-1 / N-1: a BEFORE trigger runs before RLS checks the new row, so
  0037 refuses anyone who may not write the row before it looks a name up,
  with RLS's own 42501 and message. anon (refused on the grant) and a GS get
  the same refusal for a name that exists as for one that does not -- never
  PPDUP.
*/
describe.skipIf(!configured || !gsPassword)('0037 tells anon and a GS nothing about names', () => {
  let admin: SupabaseClient
  let gs: SupabaseClient
  let anonClient: SupabaseClient
  let known: string
  const unknown = `${EMPLOYEE_PREFIX}${Date.now().toString(36)} nobody`

  beforeAll(async () => {
    admin = createClient(url!, anon!, { auth: { persistSession: false } })
    expect((await admin.auth.signInWithPassword({ email: toAuthEmail(adminUsername!), password: adminPassword! })).error).toBeNull()
    gs = createClient(url!, anon!, { auth: { persistSession: false } })
    expect((await gs.auth.signInWithPassword({ email: toAuthEmail(gsUsername!), password: gsPassword! })).error).toBeNull()
    anonClient = createClient(url!, anon!, { auth: { persistSession: false } })
    const fixture = await admin.from('profiles').select('full_name').eq('username', gsUsername!).single()
    expect(fixture.error).toBeNull()
    known = fixture.data!.full_name as string
  })

  afterAll(async () => {
    if (!admin) return
    // Nothing should have been written; this only guards a regression.
    await admin.from('employees').delete().like('full_name', `${EMPLOYEE_PREFIX}%`)
  })

  const refusal = (error: { code?: string; message?: string } | null) => {
    expect(error).not.toBeNull()
    expect(error?.code).toBe('42501')
    expect(error?.message ?? '').not.toContain('duplicate_person_name')
    return error?.message
  }

  it.each([
    ['anon', () => anonClient],
    ['a GS session', () => gs],
  ])('gives %s the same refusal for an existing and an unknown employee name', async (_who, client) => {
    const existing = await client().from('employees').insert({ full_name: known.toUpperCase() })
    const missing = await client().from('employees').insert({ full_name: unknown })
    expect(refusal(existing.error)).toBe(refusal(missing.error))
    expect(existing.error?.details ?? null).toBe(missing.error?.details ?? null)
    expect(refusal(existing.error)).toMatch(/permission denied|row-level security policy/)
  })

  it.each([
    ['anon', () => anonClient],
    ['a GS session', () => gs],
  ])('refuses %s any insert into profiles on the grant, before any name is looked at', async (_who, client) => {
    const existing = await client().from('profiles').insert({ id: randomUUID(), username: 'rlstest-nl-probe', full_name: known, role: 'gs' })
    const missing = await client().from('profiles').insert({ id: randomUUID(), username: 'rlstest-nl-probe2', full_name: unknown, role: 'gs' })
    expect(refusal(existing.error)).toMatch(/permission denied/)
    expect(refusal(missing.error)).toMatch(/permission denied/)
  })
})
