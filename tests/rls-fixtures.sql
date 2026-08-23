-- Fixture seeder for tests/rls.integration.test.ts.
--
-- Run by hand, as `postgres` via the Supabase CLI -- AFTER the three
-- dashboard accounts exist (the bootstrap admin `linhdeptrai123`, the test
-- GS `rlstest-gs` and the test admin `rlstest-admin`). See
-- supabase/README.md and .env.test.local.example for the full, required run
-- order.
--
-- Originally a one-off. It is now also the recovery path when a run of the
-- integration suite is killed: it purges the admin and Edge Function suites'
-- residue and restores rlstest-admin's `active` flag before re-seeding (see
-- the purge block below, and tests/rls-teardown.sql for the routine cleanup
-- this duplicates).
--
--   nvm use 22
--   npx supabase db query --linked -f tests/rls-fixtures.sql
--
-- Every returned row must begin with PASS before the integration suite is
-- run. A row beginning with FAIL means a precondition this script cannot
-- supply on its own -- almost always a missing or misconfigured account --
-- and the integration suite must not be trusted until it is fixed and this
-- script re-run clean. This script deliberately does not error out when an
-- account is missing (the account-dependent inserts below are written as
-- `insert ... select ... from profiles where ...`, which silently inserts
-- zero rows rather than raising an error); the FAIL rows are how that
-- absence is actually reported.
--
-- Almost every statement above the final SELECT is idempotent (ON CONFLICT
-- DO NOTHING / NOT EXISTS guards, or -- for the stage-change update -- the
-- app's own no-op guard in log_cell_stage_change), so re-running this
-- script is safe. The one exception: the credential_access_log insert
-- correlates per (admin, gs) pair rather than per row, so with more than
-- one admin profile a re-run can add another row for a pair that did not
-- exist yet, until every admin/gs pair has one. That converges and breaks
-- nothing -- it never duplicates an existing pair, and the assertion below
-- only checks "at least one" -- but it is not the same as every other
-- statement here, which are all true no-ops on a second run. Unlike
-- supabase/verify_schema.sql, this script does NOT delete its own rows
-- afterwards: these fixtures are meant to persist across many runs of the
-- integration suite, not be created and torn down by each one. The purge
-- block below is not an exception to that: it deletes the *other* suites'
-- scratch rows (project codes RLSX/RLSY/RLSE and `rlstest-ef-%` accounts),
-- never anything this file seeds.
--
-- Only one top-level SELECT appears, at the end. `supabase db query -f`
-- surfaces only the LAST statement's result set when a file contains more
-- than one top-level SELECT -- a behaviour discovered while building
-- supabase/verify_schema.sql -- so every precondition assertion below is
-- combined into that single SELECT rather than issued separately.
--
-- WARNING: this script INSERTS test rows (projects 'RLS Allowed' / 'RLS
-- Denied' and everything under them, plus a gs_credentials row and a
-- credential_access_log row) and links the real `rlstest-gs` account to
-- one of those projects. It is meant to run against a disposable or
-- pre-production database only. Never run it against a database holding
-- real project data.

-- Residue purge, first. tests/rls-teardown.sql is what normally removes the
-- rows the admin and Edge Function suites create, and the suites' own afterAll
-- hooks remove everything a session can reach -- but both can be skipped: a
-- SIGKILL mid-run skips the hooks, and forgetting to run the teardown script
-- skips the rest. This block exists because of that, and it deliberately
-- duplicates statements 1-4 of tests/rls-teardown.sql rather than trusting
-- them to have run. Left in place, that residue makes the next run fail on
-- projects.code's unique constraint instead of on anything real.
--
-- The order matches rls-teardown.sql for the same reason: log rows before the
-- auth user, because credential_access_log.target_user_id is ON DELETE SET
-- NULL (0003) and deleting the account first would erase the only column that
-- identifies those rows.
delete from credential_access_log
where target_user_id in (select id from profiles where username like 'rlstest-ef-%');
delete from auth.users where email like 'rlstest-ef-%@app.local';
delete from profiles where username like 'rlstest-ef-%';
delete from projects where code in ('RLSX', 'RLSY', 'RLSE');

-- The admin fixture must be able to act as an admin, unconditionally. Nothing
-- in the current suite deliberately sets rlstest-admin.active to false any
-- more -- the inactive-admin Edge Function test flips rlstest-gs instead (see
-- tests/rls.integration.test.ts, 'refuses an admin whose profile has been
-- deactivated with 403'), precisely so restoring the flipped row never needs
-- a second, temporary admin account. This line stays anyway, as a
-- belt-and-braces measure rather than the primary restore path: it is what
-- makes a run that somehow left rlstest-admin inactive recoverable without
-- hand-editing the database, and it is a no-op when the flag is already true.
update profiles set active = true where username = 'rlstest-admin';

-- Domain fixtures: two projects, one deck each, one stage each, one cell
-- each. None of this depends on any auth account existing yet.
--
-- RLSD's id is pinned to a fixed, well-known uuid (rather than the default
-- gen_random_uuid()) so tests/rls.integration.test.ts can reference the
-- denied project directly for its "add itself to a project it cannot read"
-- escalation test, without needing a service-role lookup.
insert into projects (id, name, code) values
  ('00000000-0000-4000-8000-0000000000d1', 'RLS Denied', 'RLSD')
  on conflict (code) do nothing;
insert into projects (name, code) values ('RLS Allowed', 'RLSA')
  on conflict (code) do nothing;

insert into decks (project_id, seq, name, code, total_area_m2)
select id, 1, 'Allowed Deck', 'AD', 100 from projects where code = 'RLSA'
  on conflict (project_id, code) do nothing;
insert into decks (project_id, seq, name, code, total_area_m2)
select id, 1, 'Denied Deck', 'DD', 100 from projects where code = 'RLSD'
  on conflict (project_id, code) do nothing;

-- NOT `on conflict (project_id, seq)`, which is what this used to say and
-- what every other insert in this file still does. Migration 0012 made
-- project_stages_project_id_seq_key DEFERRABLE INITIALLY DEFERRED so a stage
-- reorder can swap two seqs inside one statement, and Postgres refuses a
-- deferrable unique constraint as an ON CONFLICT arbiter: the old form failed
-- outright with `55000: ON CONFLICT does not support deferrable unique
-- constraints/exclusion constraints as arbiters`, aborting this whole script
-- before a single assertion could be reported. 0012's own migration comment
-- predicted exactly this. A NOT EXISTS guard keys on the same pair without
-- naming the constraint, and matches the deck_guides insert further down.
insert into project_stages (project_id, seq, name, color, weight)
select p.id, 1, 'Coat 1', '#fadb14', 1
from projects p
where p.code = 'RLSA'
  and not exists (
    select 1 from project_stages where project_id = p.id and seq = 1
  );
-- Distinctively named so a leaked cell_events row is unambiguous in the
-- suite's cross-project cell_events assertion.
insert into project_stages (project_id, seq, name, color, weight)
select p.id, 1, 'RLS Denied Coat', '#ff4d4f', 1
from projects p
where p.code = 'RLSD'
  and not exists (
    select 1 from project_stages where project_id = p.id and seq = 1
  );

insert into cells (deck_id, code, x, y, w, h, area_m2)
select id, 'R1C1', 0, 0, 1, 1, 100 from decks where code = 'AD'
  on conflict (deck_id, code) do nothing;
insert into cells (deck_id, code, x, y, w, h, area_m2)
select id, 'R1C1', 0, 0, 1, 1, 100 from decks where code = 'DD'
  on conflict (deck_id, code) do nothing;

-- A guide and a zone/zone_cells pair on the denied deck. Neither AD nor
-- RLSA has any row in these two tables, so "GS sees zero rows here" is by
-- itself a sufficient cross-project assertion in the suite -- no marker
-- column needed for those two.
insert into deck_guides (deck_id, axis, pos, offset_mm, label)
select d.id, 'x', 0.5, 100, 'rls denied guide'
from decks d
where d.code = 'DD'
  and not exists (
    select 1 from deck_guides where deck_id = d.id and label = 'rls denied guide'
  );

insert into zones (deck_id, seq, name, stage_id)
select d.id, 1, 'RLS Denied Zone', ps.id
from decks d
join project_stages ps on ps.project_id = d.project_id and ps.name = 'RLS Denied Coat'
where d.code = 'DD'
  on conflict (deck_id, stage_id, seq) do nothing;

insert into zone_cells (zone_id, cell_id)
select z.id, c.id
from zones z, decks d, cells c
where z.name = 'RLS Denied Zone' and d.code = 'DD' and c.deck_id = d.id
  on conflict (zone_id, cell_id) do nothing;

-- Advance the denied deck's own cell through the app's real mechanism (not
-- a hand-written cell_events insert) so the AFTER trigger creates a
-- distinctively-named cell_events row. Only stage_id changes, so this is
-- allowed by assert_gs_updates_stage_only regardless of who runs it, and
-- the trigger's own no-op guard (0004/0005) makes re-running this safe: a
-- second run sets the same value, so no second event is logged.
update cells set stage_id = (
  select id from project_stages where name = 'RLS Denied Coat'
) where deck_id = (select id from decks where code = 'DD');

-- Account-dependent fixtures. Each is written as `insert ... select ...
-- from profiles where ...`, so if the account it depends on does not exist
-- yet, the SELECT returns zero rows and the INSERT silently does nothing --
-- no error here, just a FAIL in the assertions below.

-- Link the real GS account to the allowed project only.
insert into project_members (project_id, user_id)
select pr.id, p.id
from projects pr, profiles p
where pr.code = 'RLSA' and p.username = 'rlstest-gs'
  on conflict (project_id, user_id) do nothing;

-- Hidden positive control for "cannot read gs_credentials at all". The
-- ciphertext is a dummy string: no test ever decrypts it, only checks that
-- a GS session cannot see the row exists. Pointed at the GS profile's own
-- user id, so no extra identity is needed.
insert into gs_credentials (user_id, secret)
select id, 'dummy-ciphertext-never-decrypted-only-checked-for-invisibility'
from profiles where username = 'rlstest-gs'
  on conflict (user_id) do nothing;

-- Hidden positive control for "cannot read the credential access log": a
-- realistic entry recording that an admin looked up the GS's own
-- credentials. The GS must not be able to read this regardless of whose
-- record it references.
insert into credential_access_log (admin_id, target_user_id)
select a.id, g.id
from profiles a, profiles g
where a.role = 'admin' and g.username = 'rlstest-gs'
  and not exists (
    select 1 from credential_access_log l
    where l.admin_id = a.id and l.target_user_id = g.id
  )
limit 1;

-- Precondition assertions. These are what make the integration suite's
-- negative tests non-vacuous instead of accidentally passing because a row
-- never existed to hide in the first place. See the file header for why
-- these all have to live in one SELECT.
create or replace function _verify_fixture_preconditions() returns setof text language plpgsql as $$
declare
  n int;
begin
  -- 1. A second, real profile with role = 'admin' exists. This is what
  -- makes "cannot read another user profile" in the integration suite a
  -- genuine test of `id = auth.uid()`, rather than one that passes only
  -- because a single profile happens to be the only row in the table.
  select count(*) into n from profiles where role = 'admin';
  return next format('%s at least one admin profile exists: %s found',
                     case when n >= 1 then 'PASS' else 'FAIL' end, n);

  -- 2. The real GS test account's profile exists with the right role.
  select count(*) into n from profiles where username = 'rlstest-gs' and role = 'gs';
  return next format('%s rlstest-gs profile exists with role=gs: %s found',
                     case when n = 1 then 'PASS' else 'FAIL' end, n);

  -- 3. That profile is a member of the allowed project.
  select count(*) into n
  from project_members pm
  join profiles p on p.id = pm.user_id
  join projects pr on pr.id = pm.project_id
  where p.username = 'rlstest-gs' and pr.code = 'RLSA';
  return next format('%s rlstest-gs is a member of RLSA: %s found',
                     case when n = 1 then 'PASS' else 'FAIL' end, n);

  -- 4. ...and is NOT a member of the denied project.
  select count(*) into n
  from project_members pm
  join profiles p on p.id = pm.user_id
  join projects pr on pr.id = pm.project_id
  where p.username = 'rlstest-gs' and pr.code = 'RLSD';
  return next format('%s rlstest-gs is NOT a member of RLSD: %s found, expected 0',
                     case when n = 0 then 'PASS' else 'FAIL' end, n);

  -- 5. The gs_credentials positive control exists.
  select count(*) into n
  from gs_credentials gc
  join profiles p on p.id = gc.user_id
  where p.username = 'rlstest-gs';
  return next format('%s gs_credentials positive control exists: %s found',
                     case when n = 1 then 'PASS' else 'FAIL' end, n);

  -- 6. The credential_access_log positive control exists.
  select count(*) into n
  from credential_access_log l
  join profiles g on g.id = l.target_user_id
  where g.username = 'rlstest-gs';
  return next format('%s credential_access_log positive control exists: %s found',
                     case when n >= 1 then 'PASS' else 'FAIL' end, n);

  -- 7. The admin test account's profile exists, is an admin, and is active.
  -- Every one of the eleven is_admin() policies the suite exercises resolves
  -- through all three of those facts, so a FAIL here invalidates the whole
  -- admin half of the suite rather than one test.
  select count(*) into n from profiles
  where username = 'rlstest-admin' and role = 'admin' and active;
  return next format('%s rlstest-admin profile exists with role=admin and active: %s found',
                     case when n = 1 then 'PASS' else 'FAIL' end, n);

  -- 8. The purge at the top of this file actually cleared everything. A FAIL
  -- means a delete above did not match what a previous run left behind, and
  -- the admin suite's first insert will collide with it.
  select (select count(*) from auth.users where email like 'rlstest-ef-%@app.local')
       + (select count(*) from profiles where username like 'rlstest-ef-%')
       + (select count(*) from projects where code in ('RLSX', 'RLSY', 'RLSE'))
    into n;
  return next format('%s no residue from an earlier admin/Edge Function run: %s found, expected 0',
                     case when n = 0 then 'PASS' else 'FAIL' end, n);
end $$;

select * from _verify_fixture_preconditions();
drop function _verify_fixture_preconditions();
