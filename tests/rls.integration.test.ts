import { createClient, FunctionsHttpError, type SupabaseClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { toAuthEmail } from '../src/config'

const url = process.env.VITE_SUPABASE_URL
const anon = process.env.VITE_SUPABASE_ANON_KEY
const username = process.env.RLS_TEST_GS_USERNAME
const password = process.env.RLS_TEST_GS_PASSWORD
const adminUsername = process.env.RLS_TEST_ADMIN_USERNAME
const adminPassword = process.env.RLS_TEST_ADMIN_PASSWORD

const configured = Boolean(url && anon && username && password)
// The admin half is gated separately from the GS half on purpose: with only
// the GS credentials present the fifteen GS assertions still run, rather than
// the whole file disappearing. A missing admin credential is not silent
// either -- the loud-fail test below names all six variables.
const adminConfigured = configured && Boolean(adminUsername && adminPassword)

// The fixed id `tests/rls-fixtures.sql` assigns to the 'RLSD' (denied)
// project. Fixed so this suite can reference a project the GS session
// cannot itself read via RLS, without needing a service-role lookup.
const RLSD_PROJECT_ID = '00000000-0000-4000-8000-0000000000d1'

// Scratch projects the admin suites below create and destroy. Distinct codes
// so any residue is identifiable at a glance, and so `tests/rls-teardown.sql`
// can find it without guessing. RLSX is the shared spine of the admin-policy
// suite; RLSY exists only inside the projects_admin_all test (which needs a
// project it can itself create and delete); RLSE belongs to the Edge Function
// suite.
const ADMIN_SPINE_CODE = 'RLSX'
const ADMIN_SCRATCH_CODE = 'RLSY'
const EF_PROJECT_CODE = 'RLSE'

// Accounts the Edge Function's `create` action makes. Every one of them is a
// real auth user, so the prefix is what `tests/rls-teardown.sql` matches on.
const EF_USERNAME_PREFIX = 'rlstest-ef-'

// A syntactically valid uuid that is deliberately not any project's id. Used
// to make the `create` action's last insert fail on
// project_members_project_id_fkey, which is what drives the rollback path.
const ABSENT_PROJECT_ID = '00000000-0000-4000-8000-0000000000ff'

/**
 * A password for an account this suite creates and then destroys. 64 hex
 * characters from the platform CSPRNG, so it is not guessable for the seconds
 * the account exists. It lives only in this process's memory: never written
 * to a file, never logged, and never handed to a matcher that would print it
 * (see `expectSecretEquals`).
 */
function throwawayPassword(): string {
  return `${randomUUID()}${randomUUID()}`.replace(/-/g, '')
}

/** Unique per run, so a leftover account from a crashed run cannot collide. */
function throwawayUsername(kind: string): string {
  return `${EF_USERNAME_PREFIX}${kind}-${Date.now().toString(36)}`
}

/**
 * Asserts a secret equals the expected value without either value reaching the
 * test output. `expect(actual).toBe(expected)` prints both sides in the diff of
 * a failing assertion, which is precisely how a password ends up in a CI log.
 * Comparing first and asserting on the boolean prints only `false !== true`.
 */
function expectSecretEquals(actual: unknown, expected: string): void {
  expect(typeof actual).toBe('string')
  expect(actual === expected).toBe(true)
}

interface InvokeResult {
  status: number
  body: Record<string, unknown>
}

/**
 * Invokes admin-users and returns the status and parsed body for every
 * outcome, success or not. supabase-js turns any non-2xx into a
 * FunctionsHttpError whose `.message` is a generic "non-2xx status code"; the
 * function's own `{ error }` body and the status are only reachable through
 * `.context`, the raw unconsumed Response -- and the status is most of what
 * these tests assert on.
 */
async function invokeAdminUsers(
  client: SupabaseClient,
  body: Record<string, string> | string,
  headers?: Record<string, string>,
): Promise<InvokeResult> {
  const { data, error } = await client.functions.invoke('admin-users', { body, headers })
  if (!error) return { status: 200, body: (data ?? {}) as Record<string, unknown> }
  if (error instanceof FunctionsHttpError) {
    return {
      status: error.context.status,
      body: (await error.context.json()) as Record<string, unknown>,
    }
  }
  throw error
}

// A suite that silently skips forever provides no coverage signal. When
// RLS_TESTS_REQUIRED=1, an absent .env.test.local must fail the run loudly
// instead of reporting a quiet, easy-to-miss "skipped".
it.skipIf(adminConfigured || process.env.RLS_TESTS_REQUIRED !== '1')(
  'fails loudly instead of silently skipping when RLS_TESTS_REQUIRED=1',
  () => {
    throw new Error(
      'RLS_TESTS_REQUIRED=1 but the RLS integration suite is not fully configured: set ' +
        'VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, RLS_TEST_GS_USERNAME, ' +
        'RLS_TEST_GS_PASSWORD, RLS_TEST_ADMIN_USERNAME and RLS_TEST_ADMIN_PASSWORD ' +
        'in .env.test.local.',
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

  // Skipped until 0022 is pushed to the linked project: until then the call
  // fails with PGRST202 (no such function), which is not the refusal this
  // asserts. Unskip in the change that applies it, as with the 0019 note tests.
  it.skip('can name its co-workers through coworker_names(), but an anonymous client cannot', async () => {
    // 0022. profiles stays admin-plus-self; this definer function is the one
    // narrow window a tablet has onto other people's names, and it is granted
    // to `authenticated` only. Anonymous gets the grant refusal (42501), not
    // an empty list -- an empty list would be indistinguishable from "nobody
    // shares a project with you".
    const { data, error } = await gs.rpc('coworker_names')
    expect(error).toBeNull()
    // The fixture GS is alone on RLSA, so the only names it may see are the
    // admins' -- and the precondition check in tests/rls-fixtures.sql
    // guarantees at least one admin profile exists.
    expect((data ?? []).length).toBeGreaterThan(0)
    for (const row of data ?? []) expect(Object.keys(row).sort()).toEqual(['full_name', 'id'])

    const anonClient = createClient(url!, anon!, { auth: { persistSession: false } })
    const refused = await anonClient.rpc('coworker_names')
    expect(refused.error?.code).toBe('42501')
  })

  // Skipped until 0023 is pushed, for the same reason as the test above.
  it.skip('cannot set a report note on a cell event', async () => {
    // 0023. The function is the only write path onto cell_events besides the
    // audit trigger, and it refuses anyone is_admin() does not vouch for. A
    // GS must be told no, not handed a silent no-op.
    const { error } = await gs.rpc('set_report_note', {
      p_event_id: 1, p_report_note: 'x', p_hidden: false,
    })
    expect(error).not.toBeNull()
    expect(error?.message).toMatch(/admin/i)
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
    // error must be checked, not just data: `data ?? []` equals `[]` for a
    // successful empty result AND for `data === null` from any unrelated
    // failure. SELECT is still granted on this table (only INSERT/UPDATE/
    // DELETE are revoked -- see verify_schema.sql check 20), so the denial
    // here must be a policy-driven empty set, not a 42501.
    const { data, error } = await gs.from('credential_access_log').select('id')
    expect(error).toBeNull()
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
    const { data: stage } = await gs.from('deck_stages').select('id').single()
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

  it('can attach a note to the bay it is recording, and the note lands', async () => {
    const { data: stage } = await gs.from('deck_stages').select('id').single()
    const { data: cell } = await gs.from('cells').select('id, stage_id').single()
    // The target is whichever stage this cell is NOT on, read at the moment of
    // the write. An earlier test in this file leaves the cell at the deck's one
    // stage, and re-sending that same value is a note-only update, which 0019
    // refuses -- so a hardcoded target here would make this test's result
    // depend on the order the file happens to run in.
    const target = cell!.stage_id === null ? stage!.id : null
    // Written in ONE statement with the stage, which is both what the app does
    // and, since 0019, the only shape the guard accepts.
    const { data: updated, error } = await gs
      .from('cells')
      .update({ stage_id: target, note: 'Bề mặt còn ẩm, hoãn sơn sang mai' })
      .eq('id', cell!.id)
      .select('note')
      .single()
    expect(error).toBeNull()
    expect(updated?.note).toBe('Bề mặt còn ẩm, hoãn sơn sang mai')
  })

  it('cannot change a note without changing the stage', async () => {
    // The audit trigger fires on a stage change only, so a note-only write
    // would move cells.note with nothing in cell_events naming who wrote it.
    const { data: cell } = await gs.from('cells').select('id').single()
    const { error } = await gs
      .from('cells')
      .update({ note: 'không đi kèm công đoạn' })
      .eq('id', cell!.id)
    expect(error).not.toBeNull()
    expect(error!.message).toContain('a note may only be changed together with the stage')
  })

  it('cannot forge the author of a note it writes', async () => {
    // The same escalation the geometry test guards, in the shape the new
    // column opens: a legitimate note carrying a forged updated_by.
    const { data: stage } = await gs.from('deck_stages').select('id').single()
    const { data: cell } = await gs.from('cells').select('id, stage_id').single()
    const { error } = await gs
      .from('cells')
      .update({
        stage_id: cell!.stage_id === null ? stage!.id : null,
        note: 'x',
        updated_by: '00000000-0000-0000-0000-000000000000',
      })
      .eq('id', cell!.id)
    expect(error).not.toBeNull()
    expect(error!.message).toContain('may be changed by a non-admin')
  })

  it('cannot change a cell geometry column', async () => {
    const { data: cell } = await gs.from('cells').select('id').single()
    const { error } = await gs.from('cells').update({ area_m2: 1 }).eq('id', cell!.id)
    expect(error).not.toBeNull()
    // Matched on the half of the message 0019 did not change, so this passes
    // both before and after that migration is applied.
    expect(error!.message).toContain('may be changed by a non-admin')
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

  it('cannot change a deck stage weight', async () => {
    // Same "no applicable UPDATE policy" shape as the profile-role test
    // above: deck_stages_admin_all requires is_admin(); the member
    // policy is SELECT-only. Zero rows affected, error === null, so the
    // read-back after the attempt is the actual assertion.
    const { data: stage } = await gs.from('deck_stages').select('id, weight').single()
    const { error } = await gs
      .from('deck_stages')
      .update({ weight: 0 })
      .eq('id', stage!.id)
    expect(error).toBeNull()

    const { data: check } = await gs.from('deck_stages').select('weight').eq('id', stage!.id).single()
    expect(Number(check?.weight)).toBe(Number(stage!.weight))
  })
})

// ---------------------------------------------------------------------------
// The admin half of the model. Until this suite existed, every policy that
// resolves through is_admin() had been reasoned about and never executed.
//
// Each policy below gets a positive assertion through the admin session AND
// the same operation through a GS session, which must be refused. The pairing
// is the point: a policy rewritten to `using (true)` passes every
// positive-only assertion in this file, and only the GS half notices.
//
// Unlike the GS suite above, this one creates its own rows -- an admin with no
// writes is not an admin -- so it owns a teardown. Anything it cannot reach
// from an authenticated session (auth users, credential_access_log rows) is
// listed in tests/rls-teardown.sql.
// ---------------------------------------------------------------------------
describe.skipIf(!adminConfigured)('RLS as an admin session', () => {
  let admin: SupabaseClient
  let gs: SupabaseClient
  let adminUserId: string
  let gsUserId: string
  let projectId: string
  let stageId: string
  let deckId: string
  let cellId: string
  let zoneId: string

  beforeAll(async () => {
    admin = createClient(url!, anon!, { auth: { persistSession: false } })
    const adminSignIn = await admin.auth.signInWithPassword({
      email: toAuthEmail(adminUsername!),
      password: adminPassword!,
    })
    expect(adminSignIn.error).toBeNull()
    adminUserId = adminSignIn.data.user!.id

    gs = createClient(url!, anon!, { auth: { persistSession: false } })
    const gsSignIn = await gs.auth.signInWithPassword({
      email: toAuthEmail(username!),
      password: password!,
    })
    expect(gsSignIn.error).toBeNull()
    gsUserId = gsSignIn.data.user!.id

    // Residue from a crashed earlier run would collide with projects.code's
    // unique constraint. Deleting the project cascades to its stages, decks,
    // guides, cells, zones, zone_cells and memberships, so this one statement
    // clears the whole spine.
    const cleared = await admin.from('projects').delete().in('code', [ADMIN_SPINE_CODE, ADMIN_SCRATCH_CODE])
    expect(cleared.error).toBeNull()

    // The spine every per-policy test below hangs its own rows off. These
    // inserts are themselves admin-only writes, so a broken policy fails
    // setup rather than producing a confusing cascade of assertion failures.
    const project = await admin
      .from('projects')
      .insert({ name: 'RLS Admin Spine', code: ADMIN_SPINE_CODE })
      .select('id')
      .single()
    expect(project.error).toBeNull()
    projectId = project.data!.id

    // The deck first: since 0018 a stage hangs off a deck, not a project.
    const deck = await admin
      .from('decks')
      .insert({ project_id: projectId, seq: 1, name: 'Admin Deck', code: 'XD', total_area_m2: 100 })
      .select('id')
      .single()
    expect(deck.error).toBeNull()
    deckId = deck.data!.id

    const stage = await admin
      .from('deck_stages')
      .insert({ deck_id: deckId, seq: 1, name: 'Admin Coat 1', color: '#1677ff', weight: 1 })
      .select('id')
      .single()
    expect(stage.error).toBeNull()
    stageId = stage.data!.id

    const cell = await admin
      .from('cells')
      .insert({ deck_id: deckId, code: 'R1C1', x: 0, y: 0, w: 1, h: 1, area_m2: 100 })
      .select('id')
      .single()
    expect(cell.error).toBeNull()
    cellId = cell.data!.id

    const zone = await admin
      .from('zones')
      .insert({ deck_id: deckId, seq: 1, name: 'Admin Zone', stage_id: stageId })
      .select('id')
      .single()
    expect(zone.error).toBeNull()
    zoneId = zone.data!.id
  })

  afterAll(async () => {
    // Runs even when a test above fails. One delete per scratch project code;
    // everything this suite created hangs off one of the two and goes with it.
    if (!admin) return
    const removed = await admin.from('projects').delete().in('code', [ADMIN_SPINE_CODE, ADMIN_SCRATCH_CODE])
    expect(removed.error).toBeNull()
    const survivors = await admin.from('projects').select('code').in('code', [ADMIN_SPINE_CODE, ADMIN_SCRATCH_CODE])
    expect(survivors.data ?? []).toEqual([])
  })

  it('projects_admin_all: creates, reads, renames and deletes a project no GS can see', async () => {
    const created = await admin
      .from('projects')
      .insert({ name: 'RLS Admin Scratch', code: ADMIN_SCRATCH_CODE })
      .select('id')
      .single()
    expect(created.error).toBeNull()
    const scratchId = created.data!.id

    // Reading RLSD is the discriminating half. The admin holds no
    // project_members row at all, so projects_member_read can never return it
    // -- only projects_admin_all can. The GS suite above asserts the same
    // session sees exactly ['RLSA'].
    const seen = await admin.from('projects').select('code').in('code', [ADMIN_SCRATCH_CODE, 'RLSD'])
    expect(seen.error).toBeNull()
    expect((seen.data ?? []).map((p) => p.code).sort()).toEqual(['RLSD', ADMIN_SCRATCH_CODE])

    const renamed = await admin
      .from('projects')
      .update({ name: 'RLS Admin Scratch Renamed' })
      .eq('id', scratchId)
      .select('name')
      .single()
    expect(renamed.error).toBeNull()
    expect(renamed.data?.name).toBe('RLS Admin Scratch Renamed')

    // Negative control, same row: the GS can neither see it nor rename it.
    const gsRead = await gs.from('projects').select('id').eq('id', scratchId)
    expect(gsRead.error).toBeNull()
    expect(gsRead.data ?? []).toEqual([])

    // No UPDATE policy applies to a GS on projects, so Postgres filters the
    // row out of the statement's view: zero rows, error null. The read-back
    // through the admin session is what proves nothing changed.
    const gsRename = await gs
      .from('projects')
      .update({ name: 'hijacked by a GS' })
      .eq('id', scratchId)
      .select('name')
    expect(gsRename.error).toBeNull()
    expect(gsRename.data ?? []).toEqual([])
    const afterGs = await admin.from('projects').select('name').eq('id', scratchId).single()
    expect(afterGs.data?.name).toBe('RLS Admin Scratch Renamed')

    const deleted = await admin.from('projects').delete().eq('id', scratchId).select('id')
    expect(deleted.error).toBeNull()
    expect((deleted.data ?? []).length).toBe(1)
  })

  it('deck_stages_admin_all: creates, reads, reweights and deletes a stage no GS can see', async () => {
    const created = await admin
      .from('deck_stages')
      .insert({ deck_id: deckId, seq: 2, name: 'Admin Coat 2', color: '#52c41a', weight: 0.5 })
      .select('id')
      .single()
    expect(created.error).toBeNull()
    const id = created.data!.id

    const read = await admin.from('deck_stages').select('name, weight').eq('id', id).single()
    expect(read.error).toBeNull()
    expect(read.data?.name).toBe('Admin Coat 2')

    const reweighted = await admin
      .from('deck_stages')
      .update({ weight: 0.25 })
      .eq('id', id)
      .select('weight')
      .single()
    expect(reweighted.error).toBeNull()
    expect(Number(reweighted.data?.weight)).toBe(0.25)

    const gsRead = await gs.from('deck_stages').select('id').eq('id', id)
    expect(gsRead.error).toBeNull()
    expect(gsRead.data ?? []).toEqual([])

    const gsWrite = await gs.from('deck_stages').update({ weight: 1 }).eq('id', id).select('weight')
    expect(gsWrite.error).toBeNull()
    expect(gsWrite.data ?? []).toEqual([])
    const afterGs = await admin.from('deck_stages').select('weight').eq('id', id).single()
    expect(Number(afterGs.data?.weight)).toBe(0.25)

    const deleted = await admin.from('deck_stages').delete().eq('id', id).select('id')
    expect(deleted.error).toBeNull()
    expect((deleted.data ?? []).length).toBe(1)
  })

  it("project_members_admin_all: reads another user's membership and manages its own", async () => {
    // The discriminating read: rlstest-gs's RLSA membership is somebody
    // else's row, so project_members_self_read (user_id = auth.uid()) cannot
    // return it to this session. Only project_members_admin_all can.
    const otherUsersRow = await admin
      .from('project_members')
      .select('project_id, user_id')
      .eq('user_id', gsUserId)
    expect(otherUsersRow.error).toBeNull()
    expect((otherUsersRow.data ?? []).length).toBe(1)

    const created = await admin
      .from('project_members')
      .insert({ project_id: projectId, user_id: adminUserId })
      .select('project_id')
    expect(created.error).toBeNull()
    expect((created.data ?? []).length).toBe(1)

    // Negative control, same row: the GS sees only its own memberships. It
    // must not see the one the admin just made for a different user id.
    const gsRead = await gs.from('project_members').select('project_id, user_id')
    expect(gsRead.error).toBeNull()
    expect((gsRead.data ?? []).every((row) => row.user_id === gsUserId)).toBe(true)
    expect((gsRead.data ?? []).some((row) => row.project_id === projectId)).toBe(false)

    const deleted = await admin
      .from('project_members')
      .delete()
      .eq('project_id', projectId)
      .eq('user_id', adminUserId)
      .select('project_id')
    expect(deleted.error).toBeNull()
    expect((deleted.data ?? []).length).toBe(1)
  })

  it('decks_admin_all: creates, reads, renames and deletes a deck no GS can see', async () => {
    const created = await admin
      .from('decks')
      .insert({ project_id: projectId, seq: 2, name: 'Admin Deck 2', code: 'XD2', total_area_m2: 50 })
      .select('id')
      .single()
    expect(created.error).toBeNull()
    const id = created.data!.id

    const read = await admin.from('decks').select('code').eq('id', id).single()
    expect(read.error).toBeNull()
    expect(read.data?.code).toBe('XD2')

    const renamed = await admin.from('decks').update({ name: 'Admin Deck 2b' }).eq('id', id).select('name').single()
    expect(renamed.error).toBeNull()
    expect(renamed.data?.name).toBe('Admin Deck 2b')

    const gsRead = await gs.from('decks').select('id').eq('id', id)
    expect(gsRead.error).toBeNull()
    expect(gsRead.data ?? []).toEqual([])

    const gsWrite = await gs.from('decks').update({ name: 'hijacked by a GS' }).eq('id', id).select('name')
    expect(gsWrite.error).toBeNull()
    expect(gsWrite.data ?? []).toEqual([])
    const afterGs = await admin.from('decks').select('name').eq('id', id).single()
    expect(afterGs.data?.name).toBe('Admin Deck 2b')

    const deleted = await admin.from('decks').delete().eq('id', id).select('id')
    expect(deleted.error).toBeNull()
    expect((deleted.data ?? []).length).toBe(1)
  })

  it('deck_guides_admin_all: creates, reads, moves and deletes a guide no GS can see', async () => {
    const created = await admin
      .from('deck_guides')
      .insert({ deck_id: deckId, axis: 'x', pos: 0.25, offset_mm: 250, label: 'admin guide' })
      .select('id')
      .single()
    expect(created.error).toBeNull()
    const id = created.data!.id

    const read = await admin.from('deck_guides').select('label').eq('id', id).single()
    expect(read.error).toBeNull()
    expect(read.data?.label).toBe('admin guide')

    const moved = await admin
      .from('deck_guides')
      .update({ offset_mm: 375 })
      .eq('id', id)
      .select('offset_mm')
      .single()
    expect(moved.error).toBeNull()
    expect(Number(moved.data?.offset_mm)).toBe(375)

    const gsRead = await gs.from('deck_guides').select('id').eq('id', id)
    expect(gsRead.error).toBeNull()
    expect(gsRead.data ?? []).toEqual([])

    const gsWrite = await gs.from('deck_guides').update({ offset_mm: 0 }).eq('id', id).select('offset_mm')
    expect(gsWrite.error).toBeNull()
    expect(gsWrite.data ?? []).toEqual([])
    const afterGs = await admin.from('deck_guides').select('offset_mm').eq('id', id).single()
    expect(Number(afterGs.data?.offset_mm)).toBe(375)

    const deleted = await admin.from('deck_guides').delete().eq('id', id).select('id')
    expect(deleted.error).toBeNull()
    expect((deleted.data ?? []).length).toBe(1)
  })

  it('cells_admin_all: creates, reads, reshapes and deletes a cell, including geometry a GS cannot touch', async () => {
    const created = await admin
      .from('cells')
      .insert({ deck_id: deckId, code: 'R2C2', x: 0.5, y: 0.5, w: 0.25, h: 0.25, area_m2: 25 })
      .select('id')
      .single()
    expect(created.error).toBeNull()
    const id = created.data!.id

    const read = await admin.from('cells').select('code').eq('id', id).single()
    expect(read.error).toBeNull()
    expect(read.data?.code).toBe('R2C2')

    // Geometry, deliberately. assert_gs_updates_stage_only rejects exactly
    // this column for a non-admin and returns early for is_admin(), so a
    // successful area_m2 write is the trigger's admin branch and
    // cells_admin_all's UPDATE half proven in one statement. The GS suite
    // above asserts the mirror image on its own project's cell.
    const reshaped = await admin.from('cells').update({ area_m2: 30 }).eq('id', id).select('area_m2').single()
    expect(reshaped.error).toBeNull()
    expect(Number(reshaped.data?.area_m2)).toBe(30)

    const gsRead = await gs.from('cells').select('id').eq('id', id)
    expect(gsRead.error).toBeNull()
    expect(gsRead.data ?? []).toEqual([])

    // cells_member_update's USING clause excludes this deck, so the row is
    // filtered out before the trigger ever sees it: zero rows, not the
    // 'only stage_id' exception the GS gets on its own project's cell.
    const gsWrite = await gs.from('cells').update({ area_m2: 1 }).eq('id', id).select('area_m2')
    expect(gsWrite.error).toBeNull()
    expect(gsWrite.data ?? []).toEqual([])
    const afterGs = await admin.from('cells').select('area_m2').eq('id', id).single()
    expect(Number(afterGs.data?.area_m2)).toBe(30)

    const deleted = await admin.from('cells').delete().eq('id', id).select('id')
    expect(deleted.error).toBeNull()
    expect((deleted.data ?? []).length).toBe(1)
  })

  it('zones_admin_all: creates, reads, renames and deletes a zone no GS can see', async () => {
    const created = await admin
      .from('zones')
      .insert({ deck_id: deckId, seq: 2, name: 'Admin Zone 2', stage_id: stageId })
      .select('id')
      .single()
    expect(created.error).toBeNull()
    const id = created.data!.id

    const read = await admin.from('zones').select('name').eq('id', id).single()
    expect(read.error).toBeNull()
    expect(read.data?.name).toBe('Admin Zone 2')

    const renamed = await admin.from('zones').update({ name: 'Admin Zone 2b' }).eq('id', id).select('name').single()
    expect(renamed.error).toBeNull()
    expect(renamed.data?.name).toBe('Admin Zone 2b')

    const gsRead = await gs.from('zones').select('id').eq('id', id)
    expect(gsRead.error).toBeNull()
    expect(gsRead.data ?? []).toEqual([])

    const gsWrite = await gs.from('zones').update({ name: 'hijacked by a GS' }).eq('id', id).select('name')
    expect(gsWrite.error).toBeNull()
    expect(gsWrite.data ?? []).toEqual([])
    const afterGs = await admin.from('zones').select('name').eq('id', id).single()
    expect(afterGs.data?.name).toBe('Admin Zone 2b')

    const deleted = await admin.from('zones').delete().eq('id', id).select('id')
    expect(deleted.error).toBeNull()
    expect((deleted.data ?? []).length).toBe(1)
  })

  it('zone_cells_admin_all: creates, reads and deletes a membership a GS can neither see nor forge', async () => {
    const created = await admin
      .from('zone_cells')
      .insert({ zone_id: zoneId, cell_id: cellId })
      .select('zone_id')
    expect(created.error).toBeNull()
    expect((created.data ?? []).length).toBe(1)

    const read = await admin.from('zone_cells').select('zone_id, cell_id').eq('zone_id', zoneId)
    expect(read.error).toBeNull()
    expect((read.data ?? []).length).toBe(1)

    const gsRead = await gs.from('zone_cells').select('zone_id').eq('zone_id', zoneId)
    expect(gsRead.error).toBeNull()
    expect(gsRead.data ?? []).toEqual([])

    // zone_cells has no column worth updating, so the GS write half is an
    // INSERT. No INSERT policy applies to a non-admin, and unlike an UPDATE
    // an insert cannot be silently filtered to zero rows -- it is refused.
    const gsInsert = await gs.from('zone_cells').insert({ zone_id: zoneId, cell_id: cellId })
    expect(gsInsert.error).not.toBeNull()
    expect(gsInsert.error!.code).toBe('42501')

    const deleted = await admin
      .from('zone_cells')
      .delete()
      .eq('zone_id', zoneId)
      .eq('cell_id', cellId)
      .select('zone_id')
    expect(deleted.error).toBeNull()
    expect((deleted.data ?? []).length).toBe(1)
  })

  it("profiles_admin_all: reads every profile and writes another user's", async () => {
    // profiles_self_read is SELECT-only and scoped to id = auth.uid(), so
    // seeing rlstest-gs's row at all is only possible through
    // profiles_admin_all. The GS suite asserts the same query returns exactly
    // ['rlstest-gs'] for a GS session.
    const all = await admin.from('profiles').select('id, username, full_name')
    expect(all.error).toBeNull()
    const usernames = (all.data ?? []).map((p) => p.username)
    expect(usernames).toContain(username)
    expect(usernames).toContain(adminUsername)

    const target = (all.data ?? []).find((p) => p.username === username)!
    const originalFullName = target.full_name as string
    try {
      const written = await admin
        .from('profiles')
        .update({ full_name: 'RLS admin write probe' })
        .eq('id', target.id)
        .select('full_name')
        .single()
      expect(written.error).toBeNull()
      expect(written.data?.full_name).toBe('RLS admin write probe')

      // Negative control, mirrored: the GS cannot write the admin's profile.
      // (The GS suite already proves it cannot escalate its own.)
      const gsWrite = await gs
        .from('profiles')
        .update({ full_name: 'hijacked by a GS' })
        .eq('id', adminUserId)
        .select('full_name')
      expect(gsWrite.error).toBeNull()
      expect(gsWrite.data ?? []).toEqual([])
    } finally {
      // full_name is display-only, but rlstest-gs is a shared fixture: leave
      // it exactly as found even when an assertion above throws.
      const restored = await admin
        .from('profiles')
        .update({ full_name: originalFullName })
        .eq('id', target.id)
        .select('full_name')
        .single()
      expect(restored.error).toBeNull()
      expect(restored.data?.full_name).toBe(originalFullName)
    }
  })

  it('cell_events_admin_read: reads an event from a project it is not a member of, and still cannot forge one', async () => {
    // The fixture event on the denied deck. The GS suite asserts this exact
    // filter returns [] for a GS session, and the admin holds no membership
    // anywhere, so cell_events_member_read cannot supply it either.
    const seen = await admin.from('cell_events').select('id, to_stage_name').eq('to_stage_name', 'RLS Denied Coat')
    expect(seen.error).toBeNull()
    expect((seen.data ?? []).length).toBeGreaterThanOrEqual(1)

    const gsSeen = await gs.from('cell_events').select('id').eq('to_stage_name', 'RLS Denied Coat')
    expect(gsSeen.error).toBeNull()
    expect(gsSeen.data ?? []).toEqual([])

    // Append-only by system: 0008 revoked INSERT/UPDATE/DELETE from both anon
    // and authenticated, so the denial is a grant failure (42501) for the
    // admin exactly as it is for the GS. Being an admin buys a read here, not
    // a write -- an audit trail its own reader can forge is not an audit
    // trail. Note this is one of the two tables where admin and GS agree.
    const adminForge = await admin
      .from('cell_events')
      .insert({ cell_id: cellId, to_stage_name: 'forged by the admin' })
    expect(adminForge.error).not.toBeNull()
    expect(adminForge.error!.code).toBe('42501')

    const gsForge = await gs
      .from('cell_events')
      .insert({ cell_id: cellId, to_stage_name: 'forged by a GS' })
    expect(gsForge.error).not.toBeNull()
    expect(gsForge.error!.code).toBe('42501')
  })

  it('credential_log_admin_read: reads the access log, and still cannot read gs_credentials', async () => {
    // The asymmetry at the centre of the credential design. The admin may see
    // WHO read a password and WHEN (tests/rls-fixtures.sql seeds one such
    // row, so this is not an empty-table pass) ...
    const log = await admin.from('credential_access_log').select('id, admin_id, target_user_id')
    expect(log.error).toBeNull()
    expect((log.data ?? []).length).toBeGreaterThanOrEqual(1)

    const gsLog = await gs.from('credential_access_log').select('id')
    expect(gsLog.error).toBeNull()
    expect(gsLog.data ?? []).toEqual([])

    // ... and may not see the passwords themselves from a browser session,
    // not even as an admin. gs_credentials has zero policies AND no grant for
    // authenticated (0007), so this is refused at the grant check before RLS
    // is consulted -- 42501, not an empty result set. Reading a password
    // requires the Edge Function, which holds the service key and writes the
    // log row above. tests/rls-fixtures.sql seeds a gs_credentials row, so
    // the table is not merely empty.
    const creds = await admin.from('gs_credentials').select('user_id')
    expect(creds.error?.code).toBe('42501')
    expect(creds.data).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// The admin-users Edge Function. Before this suite it had never had a single
// path executed from a test -- only curl by hand.
//
// This is the one surface that can read a GS password, so the paths that
// matter most are the ones that refuse: an inactive admin, a GS session, a
// malformed body. The happy paths matter too, because a create that half
// succeeds leaves a real auth user behind.
//
// Every call here goes through supabase-js `functions.invoke` with a real
// session JWT, so the request shape is the app's. It is NOT a browser: node's
// fetch does not enforce CORS, so nothing in this file exercises the
// function's CORS layer or its OPTIONS preflight. That remains unproven.
// ---------------------------------------------------------------------------
describe.skipIf(!adminConfigured)('admin-users Edge Function', () => {
  let admin: SupabaseClient
  let gs: SupabaseClient
  let adminUserId: string
  let gsUserId: string
  let projectId: string

  // The throwaway GS account the four happy paths walk through, in order.
  let efUserId: string
  let efUsername: string
  let efPassword: string

  beforeAll(async () => {
    admin = createClient(url!, anon!, { auth: { persistSession: false } })
    const adminSignIn = await admin.auth.signInWithPassword({
      email: toAuthEmail(adminUsername!),
      password: adminPassword!,
    })
    expect(adminSignIn.error).toBeNull()
    adminUserId = adminSignIn.data.user!.id

    gs = createClient(url!, anon!, { auth: { persistSession: false } })
    const gsSignIn = await gs.auth.signInWithPassword({
      email: toAuthEmail(username!),
      password: password!,
    })
    expect(gsSignIn.error).toBeNull()
    gsUserId = gsSignIn.data.user!.id

    const cleared = await admin.from('projects').delete().eq('code', EF_PROJECT_CODE)
    expect(cleared.error).toBeNull()

    const project = await admin
      .from('projects')
      .insert({ name: 'RLS EdgeFn Scratch', code: EF_PROJECT_CODE })
      .select('id')
      .single()
    expect(project.error).toBeNull()
    projectId = project.data!.id

    efUsername = throwawayUsername('gs')
    efPassword = throwawayPassword()
  })

  afterAll(async () => {
    // Runs even when a test above fails, and removes everything an
    // authenticated admin session can reach: the scratch project, and with it
    // (by cascade) any project_members row left pointing at it.
    //
    // Two kinds of residue are deliberately NOT removed here, because no
    // authenticated session can:
    //   - the auth.users rows `create` made. Nothing in the API deletes an
    //     auth user; only the service key or `postgres` can.
    //   - the credential_access_log rows `reveal` wrote. 0008 revoked
    //     INSERT/UPDATE/DELETE on that table from `authenticated` precisely so
    //     that its own reader cannot edit it -- which includes this suite.
    // Both are removed by tests/rls-teardown.sql, which must delete the log
    // rows FIRST: credential_access_log.target_user_id is ON DELETE SET NULL
    // (0003), so dropping the profile row first would null the only column
    // that identifies those rows as this suite's. That ordering is also why
    // the rlstest-ef-% profiles are left standing here rather than deleted.
    if (!admin) return
    const removed = await admin.from('projects').delete().eq('code', EF_PROJECT_CODE)
    expect(removed.error).toBeNull()
  })

  it('create: makes a real GS account, its profile and its membership', async () => {
    const result = await invokeAdminUsers(admin, {
      action: 'create',
      username: efUsername,
      fullName: 'RLS Edge Function Throwaway',
      password: efPassword,
      projectId,
    })
    expect(result.status).toBe(200)
    expect(typeof result.body.userId).toBe('string')
    efUserId = result.body.userId as string

    const profile = await admin
      .from('profiles')
      .select('username, full_name, role, active')
      .eq('id', efUserId)
      .single()
    expect(profile.error).toBeNull()
    expect(profile.data?.username).toBe(efUsername)
    expect(profile.data?.role).toBe('gs')
    expect(profile.data?.active).toBe(true)

    const membership = await admin.from('project_members').select('project_id').eq('user_id', efUserId)
    expect(membership.error).toBeNull()
    expect((membership.data ?? []).map((m) => m.project_id)).toEqual([projectId])
  })

  it('reveal: returns the stored password and writes the access log row', async () => {
    expect(efUserId).toBeTruthy()

    const result = await invokeAdminUsers(admin, { action: 'reveal', userId: efUserId })
    expect(result.status).toBe(200)
    // The whole point of the feature: the ciphertext round-trips to exactly
    // the password `create` was given. Compared without printing either side.
    expectSecretEquals(result.body.password, efPassword)

    // The log is the only record of who read what, so a reveal that does not
    // write one is a reveal that did not happen. Reading it back here also
    // exercises credential_log_admin_read against a row the function wrote
    // rather than one the fixture seeded.
    const log = await admin
      .from('credential_access_log')
      .select('id, admin_id, target_user_id')
      .eq('target_user_id', efUserId)
    expect(log.error).toBeNull()
    expect((log.data ?? []).length).toBe(1)
    expect(log.data![0].admin_id).toBe(adminUserId)

    const gsLog = await gs.from('credential_access_log').select('id').eq('target_user_id', efUserId)
    expect(gsLog.error).toBeNull()
    expect(gsLog.data ?? []).toEqual([])
  })

  it('set-password: changes the real password and the stored ciphertext together', async () => {
    expect(efUserId).toBeTruthy()
    const nextPassword = throwawayPassword()

    const result = await invokeAdminUsers(admin, {
      action: 'set-password',
      userId: efUserId,
      password: nextPassword,
    })
    expect(result.status).toBe(200)
    expect(result.body.ok).toBe(true)

    // Both halves, because the failure mode this action's ordering exists to
    // prevent is exactly the two disagreeing: a supervisor locked out of an
    // account whose password the admin can no longer look up. So assert the
    // account really signs in with the new value AND that reveal returns it.
    const asUser = createClient(url!, anon!, { auth: { persistSession: false } })
    const signIn = await asUser.auth.signInWithPassword({
      email: toAuthEmail(efUsername),
      password: nextPassword,
    })
    expect(signIn.error).toBeNull()
    expect(signIn.data.session).not.toBeNull()
    await asUser.auth.signOut()

    const revealed = await invokeAdminUsers(admin, { action: 'reveal', userId: efUserId })
    expect(revealed.status).toBe(200)
    expectSecretEquals(revealed.body.password, nextPassword)
    efPassword = nextPassword
  })

  it('deactivate: bans the account, drops its membership and marks the profile inactive', async () => {
    expect(efUserId).toBeTruthy()

    const result = await invokeAdminUsers(admin, { action: 'deactivate', userId: efUserId })
    expect(result.status).toBe(200)
    expect(result.body.ok).toBe(true)

    const profile = await admin.from('profiles').select('active').eq('id', efUserId).single()
    expect(profile.error).toBeNull()
    expect(profile.data?.active).toBe(false)

    const membership = await admin.from('project_members').select('project_id').eq('user_id', efUserId)
    expect(membership.error).toBeNull()
    expect(membership.data ?? []).toEqual([])

    // The ban is what stops a new sign-in. Asserted with the password that
    // demonstrably worked in the previous test, so a failure here is the ban
    // and not a wrong credential.
    const asUser = createClient(url!, anon!, { auth: { persistSession: false } })
    const signIn = await asUser.auth.signInWithPassword({
      email: toAuthEmail(efUsername),
      password: efPassword,
    })
    expect(signIn.error).not.toBeNull()
    expect(signIn.data.session).toBeNull()
  })

  it('create: rolls the auth user back when a downstream insert fails, leaving no orphan', async () => {
    const orphanUsername = throwawayUsername('orphan')
    const orphanPassword = throwawayPassword()

    // The gs_credentials insert itself cannot be made to fail from a client:
    // its only constraints are a fresh primary key and a NOT NULL the function
    // always supplies. So the rollback is driven through the insert that CAN
    // fail -- project_members, on a project id that does not exist. That is
    // strictly the harder case for cleanup, because by then the auth user, the
    // profile AND the credential row all exist and all three must disappear.
    const result = await invokeAdminUsers(admin, {
      action: 'create',
      username: orphanUsername,
      fullName: 'RLS Edge Function Rollback Probe',
      password: orphanPassword,
      projectId: ABSENT_PROJECT_ID,
    })
    expect(result.status).toBe(400)
    // The message names what failed in the admin's terms and NOT the table it
    // failed on. This assertion used to require the string 'project_members',
    // which pinned the schema leak in place: the function returned Postgres's
    // own text -- table and constraint names -- to the client on nine branches.
    // What the test is actually for is below: that the rollback ran.
    expect(String(result.body.error)).toContain('Không gán được dự án')
    expect(String(result.body.error)).not.toContain('project_members')

    // Two independent proofs that nothing survived. The profile is gone --
    // and since nothing in the function deletes a profile, its absence can
    // only be the auth.users cascade, i.e. the rollback's deleteUser ran ...
    const profile = await admin.from('profiles').select('id').eq('username', orphanUsername)
    expect(profile.error).toBeNull()
    expect(profile.data ?? []).toEqual([])

    // ... and the account cannot sign in. `create` sets email_confirm, so an
    // orphaned auth user would be a fully working login with no profile: this
    // assertion is the one that would catch a rollback that deleted the
    // profile but left the account.
    const asUser = createClient(url!, anon!, { auth: { persistSession: false } })
    const signIn = await asUser.auth.signInWithPassword({
      email: toAuthEmail(orphanUsername),
      password: orphanPassword,
    })
    expect(signIn.error).not.toBeNull()
    expect(signIn.data.session).toBeNull()
  })

  it('returns 400 Invalid JSON on a malformed body', async () => {
    // A raw string plus an explicit content-type, so supabase-js sends the
    // bytes verbatim instead of JSON.stringify-ing them into valid JSON.
    const result = await invokeAdminUsers(admin, '{"action": "reveal"', {
      'content-type': 'application/json',
    })
    expect(result.status).toBe(400)
    expect(result.body.error).toBe('Invalid JSON')
  })

  it('refuses a GS session with 403', async () => {
    // The negative control for every 200 above: the same function, the same
    // request shape, a non-admin JWT. 'probe-unknown-action' is deliberate --
    // an accepted caller gets 400 "Unknown action", so 403 here can only be
    // the admin gate and not a rejected payload.
    const result = await invokeAdminUsers(gs, { action: 'probe-unknown-action' })
    expect(result.status).toBe(403)
    expect(result.body.error).toBe('Forbidden')
  })

  // 20s, not the 5s default: this test makes three round trips against the live
  // project (flip the flag, invoke the function, restore through the admin
  // session) and it timed out at 5s once during Phase 3. A timeout here is an
  // environment signal, not a correctness one, and aborting it mid-way risks
  // skipping the restore in the `finally`.
  it('refuses an admin whose profile has been deactivated with 403', async () => {
    // is_admin() and callerAdminId both require profiles.active, so this is
    // the check that makes deactivating an admin actually revoke them. The
    // function returns a bare { error: 'Forbidden' } for both "not an admin"
    // and "admin but inactive", so the status code alone cannot show which
    // rule fired -- only these three rows, together, discriminate it:
    //
    //   rlstest-admin              role=admin, active=true  -> succeeds
    //     (every 200 elsewhere in this describe block)
    //   rlstest-gs                 role=gs,    active=true  -> 403
    //     ('refuses a GS session with 403', above)
    //   rlstest-gs, flipped        role=admin, active=false -> 403
    //     (this test)
    //
    // If profile.active were dropped from callerAdminId, all three rows would
    // still be green -- the role check alone would explain them -- so the
    // third row is the one that actually exercises the active check, and it
    // is written here rather than by deactivating rlstest-admin.
    //
    // Deactivating rlstest-admin itself is a trap: once active is false no
    // policy on profiles grants that session an UPDATE any more
    // (profiles_admin_all needs is_admin(); profiles_self_read is SELECT
    // only), so it cannot restore itself. The only fix is a second,
    // still-active admin session -- and for as long as that second account
    // exists, it can call `reveal` and read every GS password. That window is
    // the trade-off this design avoids entirely: no second account is ever
    // created. rlstest-gs is the subject instead, and the still-active
    // rlstest-admin fixture -- already a real, separate admin -- does the
    // restoring.
    //
    // Both columns move in the same UPDATE, so this row is never
    // simultaneously role='admin' and active=true. That also closes the read
    // side: is_admin() (supabase/migrations/0006_rls.sql) is `role = 'admin'
    // and active`, so for the entire time this row holds role='admin' its
    // active is false, and is_admin() for this session never once evaluates
    // true. There is no moment where rlstest-gs's RLS reads actually widen.
    const flipped = await admin
      .from('profiles')
      .update({ role: 'admin', active: false })
      .eq('id', gsUserId)
      .select('role, active')
      .single()
    expect(flipped.error).toBeNull()
    expect(flipped.data?.role).toBe('admin')
    expect(flipped.data?.active).toBe(false)

    try {
      const refused = await invokeAdminUsers(gs, { action: 'probe-unknown-action' })
      expect(refused.status).toBe(403)
      expect(refused.body.error).toBe('Forbidden')
    } finally {
      // Restored through rlstest-admin, which was never touched above and so
      // needs no precondition probe of its own -- unlike the rejected design,
      // this restore does not depend on the row under test being able to act
      // on itself, so it always works.
      const restored = await admin
        .from('profiles')
        .update({ role: 'gs', active: true })
        .eq('id', gsUserId)
        .select('role, active')
        .single()
      expect(restored.error).toBeNull()
      expect(restored.data?.role).toBe('gs')
      expect(restored.data?.active).toBe(true)
    }
  }, 20_000)
})
