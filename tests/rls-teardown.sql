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
delete from projects where code in ('RLSX', 'RLSY', 'RLSE', 'RLSW', 'RLSH');

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

-- 7. The bay the suite writes to must be an untouched bay again.
--
-- AD ONLY, deliberately. The denied deck's bay and the single cell_events row
-- it carries are read-only evidence: rls-fixtures.sql advances DD's cell once,
-- through the app's real mechanism, so that a distinctively-named event exists
-- for the cross-project reads at lines 204 and 792 to find. Resetting it, or
-- pruning its event below, deletes the thing those tests are looking for --
-- which is exactly what the first version of this statement did, and it turned
-- an intermittent failure into a permanent one.
--
-- rls-fixtures.sql inserts them `on conflict (deck_id, code) do nothing`, so
-- they are seeded ONCE and then carry whatever the last run left behind. That
-- is fine for a row nobody writes; these two are written by four tests every
-- run.
--
-- It matters because several of those tests assert on a CHANGE -- a stage that
-- moves, a note that appears, a geometry column the guard refuses -- and an
-- assertion about a change silently becomes a no-op when the stored value
-- already equals the one being written. That is not hypothetical: it is what
-- made `can attach a note to the bay it is recording` fail on a run where the
-- previous run had left the bay already sitting on the stage the test was
-- about to write to it.
--
-- Done here rather than in rls-fixtures.sql because the fixtures are seeded by
-- hand, once, and this file runs after every suite. It joins statements 5 and
-- 6 above, which exist for the same reason: a run killed mid-test leaves state
-- that breaks the next one.
--
-- TWO statements, and no trigger is disabled to do it. 0019's guard refuses a
-- note that changes without its stage, so the note is cleared in the same
-- statement as a stage flip that is guaranteed to be a real change (null goes
-- to the deck's stage, anything else goes to null). The second statement then
-- settles the stage at null, which is either a legal stage-only change or a
-- no-op. Disabling cell_states_assert_gs_write would have been one statement,
-- and would have left the guard off on the customer's database for as long as
-- it took this script to crash.
-- Since 0024 the bay's progress is its cell_states row, one per work.
update cell_states cs
set stage_id = case when cs.stage_id is null then s.id else null end,
    note = ''
from decks d
join deck_stages s on s.deck_id = d.id
where d.id = cs.deck_id and d.code = 'AD' and s.work_id = cs.work_id;

update cell_states cs
set stage_id = null
from decks d
where d.id = cs.deck_id and d.code = 'AD' and cs.stage_id is not null;

-- 8. And the history that bay accumulates.
--
-- Every run appends three or four cell_events rows to the same cell, for ever:
-- 68 of them by the time anyone counted, growing on a customer's database.
-- They record the audit trail of a fixture, not of any real deck, and nothing
-- reads them after the run that wrote them.
--
-- AD only, for the reason given in 7: DD's one event is what two tests read.
delete from cell_events e
using cells c, decks d
where e.cell_id = c.id and c.deck_id = d.id and d.code = 'AD';

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

  select count(*) into n from projects where code in ('RLSX', 'RLSY', 'RLSE', 'RLSW', 'RLSH');
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

  -- The reset the next run depends on. A fixture bay that starts a run already
  -- carrying a note, or already on the stage a test is about to write, turns
  -- that test into an assertion about nothing.
  select count(*) into n
  from cell_states cs join decks d on d.id = cs.deck_id
  where d.code = 'AD' and (cs.stage_id is not null or coalesce(cs.note, '') <> '');
  return next format('%s the written fixture bay is reset to not-started with no note: %s still dirty, expected 0',
                     case when n = 0 then 'PASS' else 'FAIL' end, n);

  select count(*) into n
  from cell_events e join cells c on c.id = e.cell_id join decks d on d.id = c.deck_id
  where d.code = 'AD';
  return next format('%s no accumulated cell_events survive on the written bay: %s found, expected 0',
                     case when n = 0 then 'PASS' else 'FAIL' end, n);

  -- The other half of the same rule: the read-only evidence on DD must still
  -- be there. A prune that is one deck code too wide deletes it silently, and
  -- the suite then fails on the NEXT run, in a different file, for a reason
  -- that looks nothing like a teardown bug.
  select count(*) into n
  from cell_events e join cells c on c.id = e.cell_id join decks d on d.id = c.deck_id
  where d.code = 'DD' and e.to_stage_name = 'RLS Denied Coat';
  return next format('%s the denied deck''s seeded event is intact: %s found, expected 1',
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
