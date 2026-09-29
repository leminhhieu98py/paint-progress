import { createClient, type SupabaseClient } from '@supabase/supabase-js'
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
const adminUsername = process.env.RLS_TEST_ADMIN_USERNAME
const adminPassword = process.env.RLS_TEST_ADMIN_PASSWORD

const configured = Boolean(url && anon && gsUsername && adminUsername && adminPassword)

/** Every employee this file makes starts with this, so residue is findable. */
const EMPLOYEE_PREFIX = 'RLS NL '

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
