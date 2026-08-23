-- Teardown for tests/rls.integration.test.ts.
--
--   nvm use 22
--   npx supabase db query --linked -f tests/rls-teardown.sql
--
-- Run this after every run of the RLS integration suite against the live
-- project. Every returned row must begin with PASS.
--
-- WHY THIS FILE EXISTS AT ALL
--
-- The suite's own afterAll hooks remove everything an authenticated admin
-- session can reach: the scratch projects RLSX / RLSY / RLSE and, by cascade,
-- their stages, decks, guides, cells, zones, zone_cells and memberships. Two
-- kinds of residue are out of reach of any session, by design:
--
--   1. auth.users rows. The Edge Function's `create` action makes real auth
--      users. Nothing in the client API deletes one -- only the service key or
--      `postgres` can -- so a suite that creates an account cannot remove it.
--   2. credential_access_log rows. Migration 0008 revoked INSERT/UPDATE/DELETE
--      on that table from `authenticated` precisely so that the only role that
--      may READ the log cannot edit it. That guarantee applies to the test
--      suite too, and it should: an audit log a test can tidy up is not an
--      audit log.
--
-- ORDER IS LOAD-BEARING. credential_access_log.target_user_id is ON DELETE SET
-- NULL (0003), because an audit row must outlive its subject. So the log rows
-- have to go BEFORE the auth user: delete the account first and
-- target_user_id becomes null, which is the only column that identifies those
-- rows as the test suite's. Do not reorder the statements below.
--
-- This script is idempotent and safe to run when there is nothing to clean:
-- every statement is a filtered DELETE, and re-running it simply deletes zero
-- rows. Running it is also how residue from a crashed run gets cleared, so
-- when in doubt, run it.
--
-- Only one top-level SELECT appears, at the end: `supabase db query -f`
-- surfaces only the LAST statement's result set when a file contains more than
-- one, so every assertion is combined into that single SELECT.
--
-- WARNING: this script deletes rows. It only ever matches the test suite's own
-- prefixes (`rlstest-ef-%` accounts, project codes RLSX / RLSY / RLSE), and
-- assertions 7-10 below check that the shared fixtures it must NOT touch --
-- RLSA, RLSD, rlstest-gs and its credential and log rows -- are still intact
-- afterwards. It never references linhdeptrai123 or rlstest-gs in a DELETE.

-- 1. The access log rows `reveal` wrote, identified through the account they
-- targeted. Must precede the auth.users delete below.
delete from credential_access_log
where target_user_id in (select id from profiles where username like 'rlstest-ef-%');

-- 2. The real auth users the Edge Function's `create` action made. Cascades to
-- profiles (0001: profiles.id references auth.users on delete cascade) and
-- from there to gs_credentials and project_members.
delete from auth.users where email like 'rlstest-ef-%@app.local';

-- 3. Any rlstest-ef-% profile whose auth user was already gone. A crashed run
-- can leave either half, since the auth user and the profile are separate
-- writes. (This used to also cover a temporary admin profile the
-- inactive-admin test created and deleted; that test now flips rlstest-gs
-- instead and creates no account, so nothing of its own reaches this step.)
delete from profiles where username like 'rlstest-ef-%';

-- 4. The scratch projects, in case a run was killed before afterAll.
delete from projects where code in ('RLSX', 'RLSY', 'RLSE');

-- 5. The admin fixture must be able to act as an admin on the next run. The
-- inactive-admin test flips this flag and restores it in a `finally`, and
-- tests/rls-fixtures.sql sets it at setup; this is the third place, because a
-- run killed mid-test is exactly when someone reaches for this file.
update profiles set active = true where username = 'rlstest-admin';

-- 6. The GS fixture must be a GS again. The inactive-admin test flips it to
-- role='admin', active=false in one statement and restores it through the
-- still-active admin session in a `finally` -- but that test makes three
-- network round trips against the live project and has timed out at least once
-- in this phase, and a `finally` is not guaranteed to run when the runner
-- aborts the test. Left flipped, rlstest-gs is an INACTIVE admin: harmless
-- (resolveAdmin requires active, so it can reveal nothing) but it breaks every
-- GS test on the next run, and rls-fixtures.sql would report it as a FAIL
-- rather than repair it. This makes it self-healing instead of self-detecting.
update profiles set role = 'gs', active = true where username = 'rlstest-gs';

create or replace function _verify_teardown() returns setof text language plpgsql as $$
declare
  n int;
begin
  -- Residue that must be gone -------------------------------------------
  select count(*) into n from auth.users where email like 'rlstest-ef-%@app.local';
  return next format('%s no Edge Function auth users survive: %s found, expected 0',
                     case when n = 0 then 'PASS' else 'FAIL' end, n);

  select count(*) into n from profiles where username like 'rlstest-ef-%';
  return next format('%s no Edge Function profiles survive: %s found, expected 0',
                     case when n = 0 then 'PASS' else 'FAIL' end, n);

  select count(*) into n
  from gs_credentials gc
  left join profiles p on p.id = gc.user_id
  where p.id is null or p.username like 'rlstest-ef-%';
  return next format('%s no Edge Function credential rows survive: %s found, expected 0',
                     case when n = 0 then 'PASS' else 'FAIL' end, n);

  select count(*) into n from projects where code in ('RLSX', 'RLSY', 'RLSE');
  return next format('%s no scratch projects survive: %s found, expected 0',
                     case when n = 0 then 'PASS' else 'FAIL' end, n);

  -- A null on either column means a profile was deleted while a log row still
  -- referenced it, i.e. statement 1 above ran too late or not at all. The
  -- rows are then unattributable, which is worse than residue.
  select count(*) into n from credential_access_log
  where admin_id is null or target_user_id is null;
  return next format('%s no orphaned access-log rows: %s found, expected 0 (a non-zero count means the delete order was violated)',
                     case when n = 0 then 'PASS' else 'FAIL' end, n);

  select count(*) into n from profiles where username = 'rlstest-admin' and active;
  return next format('%s rlstest-admin is active again: %s found',
                     case when n = 1 then 'PASS' else 'FAIL' end, n);

  -- Fixtures this script must NOT have touched ---------------------------
  select count(*) into n from projects where code in ('RLSA', 'RLSD');
  return next format('%s the RLSA/RLSD fixtures are intact: %s found, expected 2',
                     case when n = 2 then 'PASS' else 'FAIL' end, n);

  select count(*) into n from profiles where username in ('linhdeptrai123', 'rlstest-gs', 'rlstest-admin');
  return next format('%s the three real accounts are intact: %s found, expected 3',
                     case when n = 3 then 'PASS' else 'FAIL' end, n);

  select count(*) into n
  from gs_credentials gc join profiles p on p.id = gc.user_id
  where p.username = 'rlstest-gs';
  return next format('%s the rlstest-gs credential fixture is intact: %s found, expected 1',
                     case when n = 1 then 'PASS' else 'FAIL' end, n);

  select count(*) into n
  from credential_access_log l join profiles g on g.id = l.target_user_id
  where g.username = 'rlstest-gs';
  return next format('%s the rlstest-gs access-log fixture is intact: %s found, expected at least 1',
                     case when n >= 1 then 'PASS' else 'FAIL' end, n);
end $$;

select * from _verify_teardown();
drop function _verify_teardown();
