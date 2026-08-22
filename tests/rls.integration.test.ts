import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { toAuthEmail } from '../src/config'

const url = process.env.VITE_SUPABASE_URL
const anon = process.env.VITE_SUPABASE_ANON_KEY
const username = process.env.RLS_TEST_GS_USERNAME
const password = process.env.RLS_TEST_GS_PASSWORD

const configured = Boolean(url && anon && username && password)

// A fixed, non-secret uuid for the decoy account created and torn down by
// this suite (see DECOY_ID usage below). Fixing it avoids any need to parse
// generated ids back out of the CLI's output.
const DECOY_ID = '00000000-0000-4000-8000-000000000001'

/**
 * Runs SQL as `postgres` via the Supabase CLI against the linked project,
 * bypassing RLS entirely (`postgres` has rolbypassrls = true). Used only to
 * set up fixture rows an RLS policy must hide from the GS session under
 * test, and to tear them down again -- never to exercise RLS itself, which
 * is what the `gs` client in the tests below is for.
 *
 * Requires the same `supabase login` / `supabase link` state (and `nvm use
 * 22` on PATH) that the rest of this repo's `npx supabase ...` commands do;
 * this only runs at all when `configured` is true, i.e. never in this task.
 */
function adminQuery(sql: string): void {
  const dir = mkdtempSync(join(tmpdir(), 'rls-fixture-'))
  try {
    const file = join(dir, 'q.sql')
    writeFileSync(file, sql)
    execFileSync('npx', ['supabase', 'db', 'query', '--linked', '-f', file], {
      stdio: ['ignore', 'ignore', 'inherit'],
    })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// Fixture rows this suite owns, on top of the ones seeded by hand per the
// task brief's Step 3 (profiles.rlstest-gs, projects RLSA/RLSD, decks
// AD/DD, project_stages 'Coat 1' on RLSA, one cell per deck). Setup runs a
// best-effort cleanup first so a crashed prior run does not block a retry.
//
// The decoy account (DECOY_ID) exists solely to satisfy the foreign key
// from `profiles` to `auth.users`: a genuine second profile row is the only
// way to make "cannot read another user's profile" a real test rather than
// one that passes because only one profile exists. It never signs in and
// carries no password worth guessing, so this is a different situation from
// this project's earlier, abandoned attempt to seed a *working* GS login by
// hand -- that failed because GoTrue rejects sign-in for a hand-seeded row;
// nothing here ever asks GoTrue to authenticate this row. Only columns
// confirmed present and non-generated on this project's `auth.users` are
// set (`confirmed_at` is a generated column and must not be inserted).
const CLEANUP_SQL = `
  delete from cell_events where to_stage_name = 'RLS Denied Coat';
  delete from deck_guides where label = 'rls denied guide';
  -- Cascades: project_stages -> zones (on delete cascade) -> zone_cells
  -- (on delete cascade), and sets the denied deck's cells.stage_id null.
  delete from project_stages where name = 'RLS Denied Coat';
  delete from credential_access_log
    where admin_id = '${DECOY_ID}' or target_user_id = '${DECOY_ID}';
  -- Cascades: auth.users -> profiles (on delete cascade) -> gs_credentials
  -- (on delete cascade).
  delete from auth.users where id = '${DECOY_ID}';
`

const SETUP_SQL = `
  ${CLEANUP_SQL}

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data,
    confirmation_token, recovery_token, email_change_token_new, email_change
  ) values (
    '00000000-0000-0000-0000-000000000000',
    '${DECOY_ID}',
    'authenticated', 'authenticated',
    'rlstest-decoy@app.local', 'not-used-decoy-account-never-signs-in',
    now(), now(), now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    '', '', '', ''
  );

  insert into profiles (id, username, full_name, role)
  values ('${DECOY_ID}', 'rlstest-decoy', 'RLS Test Decoy', 'admin');

  insert into gs_credentials (user_id, secret)
  values ('${DECOY_ID}', 'decoy-secret-must-not-be-readable');

  insert into credential_access_log (admin_id, target_user_id)
  values ('${DECOY_ID}', '${DECOY_ID}');

  -- A stage under the DENIED project (RLSD had none), distinctively named
  -- so a leaked cell_events row is unambiguous in the assertion below.
  insert into project_stages (project_id, seq, name, color, weight)
  select id, 1, 'RLS Denied Coat', '#ff4d4f', 1 from projects where code = 'RLSD';

  -- A guide and a zone/zone_cells pair on the denied deck. Neither AD nor
  -- RLSA has any row in these two tables, so "GS sees zero rows here" is by
  -- itself a sufficient cross-project assertion -- no marker column needed.
  insert into deck_guides (deck_id, axis, pos, offset_mm, label)
  select id, 'x', 0.5, 100, 'rls denied guide' from decks where code = 'DD';

  insert into zones (deck_id, seq, name, stage_id)
  select d.id, 1, 'RLS Denied Zone', ps.id
  from decks d
  join project_stages ps on ps.project_id = d.project_id and ps.name = 'RLS Denied Coat'
  where d.code = 'DD';

  insert into zone_cells (zone_id, cell_id)
  select z.id, c.id
  from zones z, decks d, cells c
  where z.name = 'RLS Denied Zone' and d.code = 'DD' and c.deck_id = d.id;

  -- Advance the denied deck's own cell through the app's real mechanism
  -- (not a hand-written cell_events insert) so the AFTER trigger creates a
  -- distinctively-named cell_events row. Only stage_id changes, so this is
  -- allowed by assert_gs_updates_stage_only regardless of who runs it.
  update cells set stage_id = (
    select id from project_stages where name = 'RLS Denied Coat'
  ) where deck_id = (select id from decks where code = 'DD');
`

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

describe.skipIf(!configured)('RLS as a GS session', () => {
  let gs: SupabaseClient
  let gsUserId: string

  beforeAll(async () => {
    adminQuery(SETUP_SQL)

    gs = createClient(url!, anon!, { auth: { persistSession: false } })
    const { data, error } = await gs.auth.signInWithPassword({
      email: toAuthEmail(username!),
      password: password!,
    })
    expect(error).toBeNull()
    gsUserId = data.user!.id
  })

  afterAll(() => {
    adminQuery(CLEANUP_SQL)
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
    // Positive control: a decoy secret genuinely exists in the table (see
    // SETUP_SQL). RLS with no policy must still return an empty set rather
    // than an error.
    const { data, error } = await gs.from('gs_credentials').select('user_id')
    expect(error?.code ?? null).not.toBe('PGRST301')
    expect(data ?? []).toEqual([])
  })

  it('cannot read the credential access log', async () => {
    // Positive control: a decoy log row genuinely exists (see SETUP_SQL).
    const { data } = await gs.from('credential_access_log').select('id')
    expect(data ?? []).toEqual([])
  })

  it('cannot read another user profile', async () => {
    // Positive control: the decoy profile genuinely exists (see SETUP_SQL),
    // so this only passes if the policy is truly `id = auth.uid()`.
    const { data } = await gs.from('profiles').select('username')
    expect(data?.map((p) => p.username)).toEqual(['rlstest-gs'])
  })

  it('cannot see another project\'s deck_guides row', async () => {
    const { data } = await gs.from('deck_guides').select('id')
    expect(data ?? []).toEqual([])
  })

  it('cannot see another project\'s zones or zone_cells rows', async () => {
    const zones = await gs.from('zones').select('id')
    expect(zones.data ?? []).toEqual([])

    const zoneCells = await gs.from('zone_cells').select('zone_id')
    expect(zoneCells.data ?? []).toEqual([])
  })

  it('cannot see another project\'s cell_events row', async () => {
    // Disambiguates from the cell_events row GS's own stage-advance test
    // below legitimately creates, which carries a different stage name.
    const { data } = await gs.from('cell_events').select('id').eq('to_stage_name', 'RLS Denied Coat')
    expect(data ?? []).toEqual([])
  })

  it('cannot see another project\'s cell via the decks join', async () => {
    const { data } = await gs.from('cells').select('id, decks!inner(code)').eq('decks.code', 'DD')
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

  it('cannot add another user to its own project (escalation attempt)', async () => {
    // Targets a project_id the GS session can legitimately read (RLSA), and
    // a user_id (the decoy's) it is not already a member with, so the
    // failure is unambiguously the INSERT policy's WITH CHECK and not a
    // duplicate-key error on the (project_id, user_id) primary key.
    const { data: project } = await gs.from('projects').select('id').eq('code', 'RLSA').single()
    const { error } = await gs
      .from('project_members')
      .insert({ project_id: project!.id, user_id: DECOY_ID })
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
