import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { beforeAll, describe, expect, it } from 'vitest'
import { toAuthEmail } from '../src/config'

const url = process.env.VITE_SUPABASE_URL
const anon = process.env.VITE_SUPABASE_ANON_KEY
const username = process.env.RLS_TEST_GS_USERNAME
const password = process.env.RLS_TEST_GS_PASSWORD

const configured = Boolean(url && anon && username && password)

// The fixed id `tests/rls-fixtures.sql` assigns to the 'RLSD' (denied)
// project. Fixed so this suite can reference a project the GS session
// cannot itself read via RLS, without needing a service-role lookup.
const RLSD_PROJECT_ID = '00000000-0000-4000-8000-0000000000d1'

// A suite that silently skips forever provides no coverage signal. When
// RLS_TESTS_REQUIRED=1, an absent .env.test.local must fail the run loudly
// instead of reporting a quiet, easy-to-miss "skipped".
it.skipIf(configured || process.env.RLS_TESTS_REQUIRED !== '1')(
  'fails loudly instead of silently skipping when RLS_TESTS_REQUIRED=1',
  () => {
    throw new Error(
      'RLS_TESTS_REQUIRED=1 but the RLS integration suite is not configured: set ' +
        'VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, RLS_TEST_GS_USERNAME and ' +
        'RLS_TEST_GS_PASSWORD in .env.test.local.',
    )
  },
)

// Fixture data (projects RLSA/RLSD, decks AD/DD, stages, cells, the denied
// deck's guide/zone/zone_cells/cell_events, project_members, and the
// gs_credentials / credential_access_log positive controls) is seeded once,
// by hand, via `tests/rls-fixtures.sql` -- see that file and
// supabase/README.md for the required run order. This suite only reads and
// writes through the GS session; it does not create or tear down fixtures
// itself, so re-running it does not depend on Supabase CLI access beyond
// the initial fixture run.
describe.skipIf(!configured)('RLS as a GS session', () => {
  let gs: SupabaseClient
  let gsUserId: string

  beforeAll(async () => {
    gs = createClient(url!, anon!, { auth: { persistSession: false } })
    const { data, error } = await gs.auth.signInWithPassword({
      email: toAuthEmail(username!),
      password: password!,
    })
    expect(error).toBeNull()
    gsUserId = data.user!.id
  })

  it('sees only the project it is a member of', async () => {
    const { data } = await gs.from('projects').select('code')
    expect(data?.map((p) => p.code)).toEqual(['RLSA'])
  })

  it('sees only the decks of that project', async () => {
    const { data } = await gs.from('decks').select('code')
    expect(data?.map((d) => d.code)).toEqual(['AD'])
  })

  it('cannot read gs_credentials at all', async () => {
    // Positive control: tests/rls-fixtures.sql inserts a dummy-ciphertext
    // row for this exact GS account, so the table is not merely empty.
    // gs_credentials has both zero RLS policies AND (since 0007) zero table
    // grants for anon/authenticated, so a GS session is denied at the grant
    // check before RLS is even consulted: PostgREST surfaces this as 42501
    // (permission denied), not an RLS-driven empty result set.
    const { data, error } = await gs.from('gs_credentials').select('user_id')
    expect(error?.code).toBe('42501')
    expect(data).toBeNull()
  })

  it('cannot read the credential access log', async () => {
    // Positive control: tests/rls-fixtures.sql inserts a log row naming
    // this GS account as the target, so the table is not merely empty.
    const { data } = await gs.from('credential_access_log').select('id')
    expect(data ?? []).toEqual([])
  })

  it('cannot read another user profile', async () => {
    // Non-vacuous because tests/rls-fixtures.sql's precondition check "at
    // least one admin profile exists" guarantees a second, real profile row
    // is present (the bootstrap admin, linhdeptrai123). If the policy were
    // `true` instead of `id = auth.uid()`, that row would appear here too.
    const { data } = await gs.from('profiles').select('username')
    expect(data?.map((p) => p.username)).toEqual(['rlstest-gs'])
  })

  it("cannot see another project's deck_guides row", async () => {
    // error must be checked, not just data: `data ?? []` equals `[]` for a
    // successful empty result AND for `data === null` from any unrelated
    // failure (a renamed table, a bad embed, PGRST205) -- an empty array
    // only proves denial once a real, error-free query produced it.
    const { data, error } = await gs.from('deck_guides').select('id')
    expect(error).toBeNull()
    expect(data ?? []).toEqual([])
  })

  it("cannot see another project's zones or zone_cells rows", async () => {
    const zones = await gs.from('zones').select('id')
    expect(zones.error).toBeNull()
    expect(zones.data ?? []).toEqual([])

    const zoneCells = await gs.from('zone_cells').select('zone_id')
    expect(zoneCells.error).toBeNull()
    expect(zoneCells.data ?? []).toEqual([])
  })

  it("cannot see another project's cell_events row", async () => {
    // Disambiguates from the cell_events row GS's own stage-advance test
    // below legitimately creates, which carries a different stage name.
    const { data, error } = await gs.from('cell_events').select('id').eq('to_stage_name', 'RLS Denied Coat')
    expect(error).toBeNull()
    expect(data ?? []).toEqual([])
  })

  it("cannot see another project's cell via the decks join", async () => {
    const { data, error } = await gs.from('cells').select('id, decks!inner(code)').eq('decks.code', 'DD')
    expect(error).toBeNull()
    expect(data ?? []).toEqual([])
  })

  it('can advance the stage of a cell in its own project, and the write lands', async () => {
    const { data: stage } = await gs.from('project_stages').select('id').single()
    const { data: cell } = await gs.from('cells').select('id').single()
    const { data: updated, error } = await gs
      .from('cells')
      .update({ stage_id: stage!.id })
      .eq('id', cell!.id)
      .select('stage_id')
      .single()
    // An update matching zero rows also returns error === null, so the
    // read-back of the actual value is what proves the write landed.
    expect(error).toBeNull()
    expect(updated?.stage_id).toBe(stage!.id)
  })

  it('cannot change a cell geometry column', async () => {
    const { data: cell } = await gs.from('cells').select('id').single()
    const { error } = await gs.from('cells').update({ area_m2: 1 }).eq('id', cell!.id)
    expect(error).not.toBeNull()
    expect(error!.message).toContain('only stage_id')
  })

  it('cannot create a project', async () => {
    const { error } = await gs.from('projects').insert({ name: 'X', code: 'XXX' })
    expect(error).not.toBeNull()
    expect(error!.code).toBe('42501')
  })

  it('cannot escalate its own profile to admin', async () => {
    // No policy grants a GS UPDATE on profiles at all (profiles_admin_all
    // requires is_admin(); profiles_self_read is SELECT-only). With zero
    // applicable policies, Postgres filters the row out of the UPDATE's
    // view entirely, so this affects zero rows and returns error === null
    // -- the escalation is disproved by reading the role back, not by an
    // error.
    const { data, error } = await gs
      .from('profiles')
      .update({ role: 'admin' })
      .eq('id', gsUserId)
      .select('role')
    expect(error).toBeNull()
    expect(data ?? []).toEqual([])

    const { data: check } = await gs.from('profiles').select('role').eq('id', gsUserId).single()
    expect(check?.role).toBe('gs')
  })

  it('cannot add itself to a project it is not a member of (escalation attempt)', async () => {
    // Targets the denied project's fixed id directly (the GS session
    // cannot read it via RLS to look it up) with its own, genuinely valid
    // user id, so the failure is unambiguously the INSERT policy's WITH
    // CHECK and not a foreign-key or duplicate-key error.
    const { error } = await gs
      .from('project_members')
      .insert({ project_id: RLSD_PROJECT_ID, user_id: gsUserId })
    expect(error).not.toBeNull()
    expect(error!.code).toBe('42501')
  })

  it('cannot change a project_stage weight', async () => {
    // Same "no applicable UPDATE policy" shape as the profile-role test
    // above: project_stages_admin_all requires is_admin(); the member
    // policy is SELECT-only. Zero rows affected, error === null, so the
    // read-back after the attempt is the actual assertion.
    const { data: stage } = await gs.from('project_stages').select('id, weight').single()
    const { error } = await gs
      .from('project_stages')
      .update({ weight: 0 })
      .eq('id', stage!.id)
    expect(error).toBeNull()

    const { data: check } = await gs.from('project_stages').select('weight').eq('id', stage!.id).single()
    expect(Number(check?.weight)).toBe(Number(stage!.weight))
  })
})
