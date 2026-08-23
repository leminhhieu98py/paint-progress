-- Schema verification for paint-progress.
--
-- ============================================================================
-- READ THIS FIRST: this script connects as `postgres`, which has
-- rolbypassrls = true. Every statement below runs with RLS bypassed, so NOT
-- ONE check in this file can observe an RLS policy accept or reject a
-- request -- postgres never asks. This script verifies structure only: that
-- the expected functions, policies, grants and triggers exist with the
-- right shape. It cannot prove the security boundary actually holds for an
-- `authenticated` session. The only test that exercises real RLS decisions
-- is tests/rls.integration.test.ts, run as an actual GS user. All rows PASS
-- here is necessary and NOT sufficient: do not read a screen of green rows
-- as "RLS is verified".
-- ============================================================================
--
-- What this checks:
--   1. A cell cannot be assigned a stage from a different project
--      (cells_assert_stage_project).
--   2. A cell can be assigned a stage from its own project, and doing so
--      logs exactly one cell_events row (cells_log_stage_change).
--   3. cells_set_audit_columns stamps updated_at when a cell's stage changes.
--      (That it does NOT stamp on any other update is check 25, added by 0011;
--      that a non-admin cannot supply one is check 28, added by 0013.)
--   4. Re-setting the same stage is a no-op: it must not log a second event.
--   5. The cell_events name snapshot (from 0005) is durable against a
--      RENAME: renaming the stage of an already-recorded event must not
--      change what that event says happened, because cell_events no longer
--      holds a foreign key to project_stages. Exercised on cell c1 / stage
--      s1, which must stay alive afterwards (see check 8 below).
--   6. The same snapshot is durable against a hard DELETE of the stage:
--      the recorded name and id must survive, with the id left dangling
--      (no longer present in project_stages) rather than nulled or
--      cascaded away. Exercised on a SEPARATE fixture, cell c2 / stage s3,
--      specifically so that destroying s3 does not disarm check 8.
--   7. A cell still pointing at a live stage of the project is present
--      right before cleanup — i.e. the depth-mismatch race that 0004/0005
--      exist to fix is actually armed, not accidentally defused by an
--      earlier check. See the comment above check 7 for why this exists.
--   8. A project (with its decks, stages, cells and cell_events) can be
--      deleted cleanly. This is the regression the fix chain in
--      0003/0004/0005 exists to guarantee: deleting a project fans out
--      into a decks -> cells CASCADE and a project_stages -> cells.stage_id
--      SET NULL at a different cascade depth, and earlier attempts aborted
--      here twice. Check 7 immediately above is what guarantees this delete
--      is actually exercising that race and not passing vacuously.
--   9. Cleanup itself succeeds: deleting the two VERIFY projects (and
--      everything cascading from them) must not error.
--
-- Checks 10-24 are structural assertions that read only the system catalogs
-- (pg_class, pg_policies, pg_proc, pg_trigger, pg_constraint,
-- information_schema.role_table_grants, storage.buckets) and need no
-- authenticated session -- see the banner above for what that does and does
-- not prove. 10-20 are RLS assertions added by migrations 0006/0007/0008; 21
-- is a foreign-key structural assertion for the on-delete-action defect
-- class 0003/0004/0005 exist to fix; 22-24 are added by 0009 for the
-- `drawings` storage bucket, its policies, and the last two search_path
-- pins.
--   10. Every one of the 12 public tables has row level security enabled.
--   11. gs_credentials has zero rows in pg_policies: service_role bypasses
--       RLS, everyone else must be denied by the absence of any policy, not
--       by a permissive-looking policy that happens to always be false.
--   12. credential_access_log has exactly one policy, and it is a SELECT
--       policy (admin-only read; no insert/update/delete for anyone but
--       service_role).
--   13. is_admin() is security definer with search_path=public, pg_temp.
--       0008 added the explicit pg_temp: bare `search_path = public` still
--       searches pg_temp FIRST for relation names, and `authenticated` does
--       hold TEMPORARY on this database, so a session able to run DDL could
--       shadow `profiles` and make this return true. is_admin() is what
--       every admin policy resolves through, so this is the highest-value
--       target in the whole model.
--   14. my_projects() is security definer with search_path=public, pg_temp.
--       0007 pinned pg_temp explicitly and added an `active` filter so a
--       deactivated GS loses read access immediately, rather than only once
--       Task 7's handler removes their project_members rows.
--   15. assert_gs_updates_stage_only() is security INVOKER (0008 reverted
--       0007's elevation: the guard reads no tables and its only call,
--       is_admin(), is already definer, so definer bought nothing here and
--       would have let any table access added to the guard later silently
--       bypass RLS) with a pinned search_path (unaffected by invoker vs.
--       definer -- SET search_path works the same either way, and this
--       function is still a privilege boundary worth pinning).
--   16. log_cell_stage_change() is security definer with a pinned
--       search_path. This is the exact fix for the critical defect 0007
--       exists for: with RLS enabled on cell_events and no INSERT policy, a
--       security-invoker trigger made every stage change fail with 42501,
--       for admin and GS alike. Unlike check 15, this function DOES write
--       an RLS-protected table (cell_events) under its own logic, which is
--       why it must stay definer.
--   17. cells has exactly four triggers (three from 0002, one from 0006).
--   18. Of those, cells_assert_gs_stage_only sorts alphabetically before
--       cells_set_audit_columns by name -- necessary for Postgres's
--       same-timing firing order, but not sufficient alone (see 19).
--   19. cells_assert_gs_stage_only and cells_set_audit_columns are both
--       row-level BEFORE UPDATE triggers, with no column list (tgattr) and
--       no WHEN clause (tgqual). Check 18 alone would still PASS if
--       cells_assert_gs_stage_only were rewritten as AFTER UPDATE, or as
--       `BEFORE UPDATE OF stage_id` (tgtype unchanged at 19, but the guard
--       then stops firing on a geometry-only update) -- this check asserts
--       timing, row-level-ness, and the absence of a column/WHEN
--       restriction directly from the catalog, not just the name that
--       determines order among peers.
--   20. anon and authenticated hold no INSERT/UPDATE/DELETE grant on
--       gs_credentials, cell_events, or credential_access_log. gs_credentials
--       has no grant at all (0007); the other two keep SELECT, since their
--       read policies still need it, but lose write grants (0008) -- all
--       three are meant to be written only by service_role or by a definer
--       function running as postgres, so this makes each fail closed at the
--       grant level, not only by policy.
--   21. No foreign key in the public schema is left with a bare ON DELETE
--       (no action) -- pg_constraint.confdeltype = 'a'. This is the
--       structural check for the defect class that cost three review rounds
--       and two BLOCKED returns (0003/0004/0005): a foreign key created
--       without an explicit ON DELETE action instead of a considered
--       CASCADE/SET NULL/RESTRICT choice.
--
-- Checks 22-24 are added by 0009, the private `drawings` storage bucket and
-- the last two search_path pins.
--   22. The `drawings` bucket exists and is private. A public bucket would
--       make every deck drawing world-readable by URL.
--   23. storage.objects carries both drawings_admin_all and
--       drawings_member_read policies.
--   24. assert_stage_belongs_to_project and set_cell_audit_columns -- the
--       last two definer/invoker functions left unpinned after 0008 -- now
--       report search_path=public, pg_temp.
--
-- Check 25 is added by 0011 and has its own fixtures ('VERIFY C'), which is why
-- it lives in a third function rather than inside _verify_triggers: appending it
-- there would have renumbered every check after it for no gain.
--   25. set_cell_audit_columns stamps updated_at/updated_by ONLY when stage_id
--       actually changes. Those columns are the progress audit trail -- spec §9
--       reports "last updated, updated by" per cell to the customer -- and the
--       trigger fired on every UPDATE, so syncCells' geometry upsert re-stamped
--       every cell on the deck: a guide nudged in March rewrote the dates of
--       coats recorded weeks earlier. Asserted in both directions in one row,
--       because a guard that skipped the stamp unconditionally would satisfy
--       either half alone.
--
-- Check 26 is added by 0012, with its own fixtures ('VERIFY D') for the same
-- reason.
--   26. project_stages' (project_id, seq) uniqueness is DEFERRABLE INITIALLY
--       DEFERRED, and a reorder -- two rows swapping seq inside one statement --
--       is actually accepted. A stage's identity is its id (cells.stage_id and
--       zones.stage_id point at rows), seq is only display order, and saveStages
--       upserts on the id; the immediate constraint 0001 created rejected the
--       swap row by row even though the statement's final state is unique. Both
--       halves are asserted because the catalog shape alone would still PASS if
--       some later migration recreated the index in a way that broke the write.
--
-- Check 27 covers the OTHER stage write, with its own fixtures ('VERIFY E').
--   27. A middle stage can be removed and the survivors renumbered past the seq
--       it vacated -- the write the stage config panel issues on a removal, in
--       the order saveStages issues it (delete, then upsert). Check 26 exercises
--       a reorder, which shifts no seq into an occupied one, so it stayed green
--       through a regression that made removing anything but the LAST stage fail
--       outright. Also asserts the two consequences: a cell recorded at a
--       surviving stage still points at that stage after its seq moves, and a
--       cell recorded at the removed stage is nulled rather than cascaded away.
--
-- Check 28 is added by 0013, with its own fixtures ('VERIFY F').
--   28. A non-admin cannot forge cells.updated_at or cells.updated_by, while a
--       plain stage change is still accepted and still stamped. 0011 gave
--       set_cell_audit_columns a stage-changed guard, which stopped a geometry
--       save re-stamping every cell -- and as a side effect let a
--       client-supplied updated_at survive, where pre-0011 it was always
--       overwritten. 0006's non-admin guard did not list either column, so a GS
--       could PATCH a forged date or a forged author onto a coat record.
--
-- Checks 29-31 are added by 0014, with their own fixtures ('VERIFY G').
--   29. Deleting a stage a cell is CURRENTLY sitting at writes exactly ONE
--       cell_events row, and that row carries the deleted stage's NAME.
--       Before 0014 it carried NULL: cells.stage_id is ON DELETE SET NULL, so
--       the referential action reaches log_cell_stage_change after the
--       project_stages row is already gone, and 0005 dropped the FK that could
--       have recovered the name. Check 7 above stayed green because it reads
--       back the event created when the cell was SET to that stage -- a
--       different row, written while the stage still existed. The row count is
--       asserted in both directions: 2 means the cascade double-logged, 0 means
--       the BEFORE DELETE trigger did not fire. This row also carries the
--       catalog half -- log_stage_deletion_on_cells() must be security definer
--       with search_path pinned, or every stage deletion fails with 42501
--       against the RLS on cell_events.
--   30. NEGATIVE CONTROL for 29. Returning a cell to "not started" while its
--       stage is still alive -- which the GS modal offers -- must STILL be
--       logged, with the name. 0014's skip in log_cell_stage_change is one
--       missing `not exists` away from swallowing this too, and check 29 alone
--       would not notice: it would still see exactly one row.
--   31. A whole project can still be deleted with 0014's BEFORE DELETE trigger
--       -- and note this check IS its own cleanup step, so if it ever FAILs its
--       VERIFY G fixtures commit and stay in the database, the same shape as the
--       incident check 9 records. A FAIL here means residue, not just a red row.
--       in place. That trigger inserts into cell_events from inside the fan-out
--       of projects -> project_stages, racing projects -> decks -> cells
--       CASCADE at a different depth -- the defect class that aborted this
--       delete twice in Phase 1. Its `exists (select 1 from projects ...)`
--       guard is what makes it safe; this check is what proves the guard works.
--
-- Check 32 is added by 0015. Catalog-only, no fixtures.
--   32. public.cells is a member of the supabase_realtime publication. Realtime
--       replicates that publication and nothing else, so without this the GS
--       screen's channel reports SUBSCRIBED and then delivers nothing, with no
--       error on either side -- and spec §11 row 3's "every open client
--       converged" is quietly false.
--
-- How to run:
--   nvm use 22
--   npx supabase db query --linked -f supabase/verify_schema.sql
--
-- Every returned row must begin with PASS (32 rows in total, one per
-- numbered check above, 1-32 with no gaps). A row beginning with FAIL means
-- a regression in the trigger/FK/RLS behaviour set up across migrations
-- 0001-0015; re-read those migrations' comments before changing this file.
--
-- One standing exception while a migration is outstanding: checks 29-31 test
-- migration 0014, so against a database where 0014 has not been applied yet
-- check 29 reports FAIL with `from_stage_name NULL` -- which IS the defect
-- 0014 fixes, reproduced. A FAIL there means "not applied", not "broken", and
-- it is the evidence that the check is not vacuous. Check 32 stands in the same
-- relation to 0015: until that migration is applied it reports FAIL with 0
-- membership rows, which is exactly the state in which the GS screen's channel
-- subscribes successfully and then receives nothing.
--
-- ONCE THIS PROJECT HOLDS REAL PROJECT DATA, do not run this against it again.
-- The WARNING below is not theoretical. This file is self-cleaning in every
-- ordinary outcome -- one implicit transaction, so a raised error rolls the
-- whole thing back, and each check's begin/exception block is a subtransaction
-- that undoes its own inserts when it catches one -- but a CLEANUP step whose
-- failure is caught and reported as a FAIL row leaves that check's VERIFY
-- fixtures behind. See check 9's comment: that happened twice in Phase 1.
-- Point it at a disposable copy from then on.
--
-- WARNING: this script INSERTS and then DELETES test rows (projects named
-- 'VERIFY A' / 'VERIFY B' / 'VERIFY C' / 'VERIFY D' / 'VERIFY E' / 'VERIFY F'
-- / 'VERIFY G'
-- and everything cascading
-- from them). It is meant to run against a disposable or pre-production
-- database only. Never run it against a database holding real project data.

create or replace function _verify_triggers() returns setof text language plpgsql as $$
declare
  p1 uuid; p2 uuid; d1 uuid; s1 uuid; s2 uuid; s3 uuid; c1 uuid; c2 uuid;
  ev_count int; upd timestamptz; ev1_id bigint; ev2_id bigint;
  nm text; tsid uuid; n int;
begin
  insert into projects (name, code) values ('VERIFY A','VERIFYA') returning id into p1;
  insert into projects (name, code) values ('VERIFY B','VERIFYB') returning id into p2;
  insert into decks (project_id, seq, name, code, total_area_m2)
    values (p1, 1, 'Deck', 'VD', 100) returning id into d1;
  insert into project_stages (project_id, seq, name, color, weight)
    values (p1, 1, 'Coat 1', '#fadb14', 1) returning id into s1;
  insert into project_stages (project_id, seq, name, color, weight)
    values (p2, 1, 'Coat 1', '#fadb14', 1) returning id into s2;
  insert into cells (deck_id, code, x, y, w, h, area_m2)
    values (d1, 'R1C1', 0, 0, 1, 1, 100) returning id into c1;

  -- A third stage and second cell, both under p1, dedicated to the hard-delete
  -- durability check (check 6). seq = 2 so it does not collide with s1's
  -- unique (project_id, seq). Named distinctly so a failure message is
  -- unambiguous about which stage it refers to.
  insert into project_stages (project_id, seq, name, color, weight)
    values (p1, 2, 'Doomed Stage', '#ff4d4f', 0) returning id into s3;
  insert into cells (deck_id, code, x, y, w, h, area_m2)
    values (d1, 'R1C2', 0, 0.5, 1, 0.5, 50) returning id into c2;
  update cells set stage_id = s3 where id = c2;
  select id into ev2_id from cell_events where cell_id = c2 order by id limit 1;

  -- 1. a stage from another project must be rejected
  begin
    update cells set stage_id = s2 where id = c1;
    return next 'FAIL cross-project: the foreign stage was accepted';
  exception when others then
    return next 'PASS cross-project: ' || sqlerrm;
  end;

  -- 2. a stage from the deck's own project must be accepted
  begin
    update cells set stage_id = s1 where id = c1;
    return next 'PASS same-project: accepted';
  exception when others then
    return next 'FAIL same-project: ' || sqlerrm;
  end;

  -- capture the event row check 2 created; the rename-durability check below
  -- reads this exact row back after mutating its stage's name. s1 itself is
  -- deliberately never deleted in this script (see check 7) so c1 keeps
  -- pointing at a live stage all the way to cleanup.
  select id into ev1_id from cell_events where cell_id = c1 order by id limit 1;

  -- 3. that accepted change must have written exactly one cell_events row
  select count(*) into ev_count from cell_events where cell_id = c1;
  return next format('%s cell_events: %s row(s), expected 1',
                     case when ev_count = 1 then 'PASS' else 'FAIL' end, ev_count);

  -- 4. the audit trigger must have stamped updated_at for the stage change
  -- above. Weak on its own -- updated_at is `not null default now()`, so it is
  -- never null -- and it says nothing about updates that are NOT progress:
  -- that is check 25 (0011), which asserts both directions against a sentinel.
  select updated_at into upd from cells where id = c1;
  return next format('%s updated_at: %s',
                     case when upd is not null then 'PASS' else 'FAIL' end, upd);

  -- 5. setting the same stage again must NOT log a second event
  update cells set stage_id = s1 where id = c1;
  select count(*) into ev_count from cell_events where cell_id = c1;
  return next format('%s no-op update: %s event(s), expected 1',
                     case when ev_count = 1 then 'PASS' else 'FAIL' end, ev_count);

  -- 6. durability against a RENAME (c1 / s1, which stays alive afterwards).
  -- The reason 0005 exists: history must not be rewritten when configuration
  -- changes. Rename the stage, then confirm the already-recorded event still
  -- carries the old name. A live join would fail this. Renaming does not
  -- remove the row, so unlike a delete this cannot disarm check 7.
  update project_stages set name = 'Coat 3 RENAMED' where id = s1;
  select to_stage_name into nm from cell_events where id = ev1_id;
  return next format('%s snapshot survives a rename: recorded %L, stage is now %L',
                     case when nm = 'Coat 1' then 'PASS' else 'FAIL' end,
                     nm,
                     (select name from project_stages where id = s1));

  -- 7. durability against a hard DELETE, on a SEPARATE fixture (c2 / s3).
  -- This must not be s1/c1: deleting the only stage a project's cells point
  -- at removes the very cascade that the final cleanup delete below needs to
  -- exercise (see check 8's comment), silently disarming the regression test
  -- while still reporting all-PASS. cell_events no longer holds a foreign
  -- key to project_stages (0005), so to_stage_id is left pointing at a row
  -- that no longer exists ("dangling") instead of being nulled or cascading
  -- away. Wrapped like checks 1-2 so an unexpected failure here reports a
  -- readable FAIL row instead of aborting the function.
  begin
    delete from project_stages where id = s3;
    select to_stage_name, to_stage_id into nm, tsid from cell_events where id = ev2_id;
    return next format('%s snapshot survives stage deletion: recorded %L, to_stage_id %s',
                       case when nm = 'Doomed Stage'
                             and tsid = s3
                             and not exists (select 1 from project_stages where id = tsid)
                            then 'PASS' else 'FAIL' end,
                       nm,
                       case when exists (select 1 from project_stages where id = tsid)
                            then 'still exists (unexpected)' else 'dangling, as expected' end);
  exception when others then
    return next 'FAIL delete-durability: ' || sqlerrm;
  end;

  -- 8. Assert the race is actually armed before relying on the cleanup to
  -- test it. This check exists because a previous edit to this script
  -- silently removed the race by deleting the stage a cell still pointed
  -- at, leaving the cleanup passing for the wrong reason. A test that
  -- verifies its own arming cannot be disarmed quietly.
  select count(*) into n
  from cells c
  join decks d on d.id = c.deck_id
  join project_stages ps on ps.id = c.stage_id
  where d.project_id = p1;
  return next format('%s race armed: %s cell(s) still point at a live stage of p1, need >= 1',
                     case when n >= 1 then 'PASS' else 'FAIL' end, n);

  -- 9. cleanup: deleting the projects (and everything cascading from them)
  -- must succeed. Because check 8 just confirmed c1 still points at the
  -- live stage s1, this delete genuinely fans out into the two
  -- simultaneous, different-depth cascades that 0004/0005 exist to fix:
  -- projects -> decks -> cells (CASCADE, depth 2 from decks) racing against
  -- projects -> project_stages -> cells.stage_id (SET NULL, depth 1 from
  -- project_stages). Wrapped like checks 1-2 and 7 so a regression here
  -- reports a readable FAIL row instead of aborting the function with zero
  -- rows, which is what happened on the first two attempts at this task.
  begin
    delete from projects where id in (p1, p2);
    return next 'PASS cleanup: done';
  exception when others then
    return next 'FAIL cleanup: ' || sqlerrm;
  end;
end $$;

-- Checks 10-19: structural RLS assertions from migrations 0006/0007.
-- Catalog-only, no session required, no rows inserted or deleted.
create or replace function _verify_rls() returns setof text language plpgsql as $$
declare
  n           int;
  bad_tables  text;
  pol_count   int;
  pol_cmd     text;
  is_admin_ok boolean;
  my_proj_ok  boolean;
  assert_ok   boolean;
  log_ok      boolean;
  trig_count  int;
  trig_order  text;
  grant_count int;
begin
  -- 10. RLS enabled on every one of the 12 public tables.
  select count(*),
         string_agg(relname, ', ' order by relname) filter (where not relrowsecurity)
    into n, bad_tables
  from pg_class
  where relnamespace = 'public'::regnamespace
    and relkind = 'r'
    and relname in (
      'profiles', 'gs_credentials', 'credential_access_log', 'projects',
      'project_stages', 'project_members', 'decks', 'deck_guides',
      'cells', 'zones', 'zone_cells', 'cell_events'
    );
  return next format('%s rls enabled on all 12 tables: %s of 12 found, offenders: %s',
                     case when n = 12 and bad_tables is null then 'PASS' else 'FAIL' end,
                     n, coalesce(bad_tables, 'none'));

  -- 11. gs_credentials must carry no policy at all (default-deny via absence,
  -- not via a policy that merely evaluates to false).
  select count(*) into pol_count
  from pg_policies where schemaname = 'public' and tablename = 'gs_credentials';
  return next format('%s gs_credentials has zero policies: %s found',
                     case when pol_count = 0 then 'PASS' else 'FAIL' end, pol_count);

  -- 12. credential_access_log has exactly one policy, and it is SELECT.
  select count(*), max(cmd) into pol_count, pol_cmd
  from pg_policies where schemaname = 'public' and tablename = 'credential_access_log';
  return next format('%s credential_access_log has exactly one select policy: %s found, cmd=%s',
                     case when pol_count = 1 and pol_cmd = 'SELECT' then 'PASS' else 'FAIL' end,
                     pol_count, coalesce(pol_cmd, 'n/a'));

  -- 13. is_admin() is security definer with search_path=public, pg_temp.
  -- Without security definer, the profiles admin policy recurses
  -- infinitely: it calls is_admin(), which itself reads profiles under RLS.
  -- pg_temp must be listed explicitly (0008): bare `search_path = public`
  -- still searches pg_temp FIRST for relation names, and `authenticated`
  -- holds TEMPORARY on this database, so a DDL-capable session could shadow
  -- `profiles` and make every admin policy in the system resolve true.
  select p.prosecdef and 'search_path=public, pg_temp' = any (p.proconfig)
    into is_admin_ok
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace and p.proname = 'is_admin';
  return next format('%s is_admin() is security definer with search_path=public, pg_temp: %s',
                     case when is_admin_ok then 'PASS' else 'FAIL' end,
                     coalesce(is_admin_ok::text, 'function not found'));

  -- 14. my_projects() is security definer with search_path=public, pg_temp
  -- (0007 pinned pg_temp explicitly, and added an `active` filter that is
  -- not observable from this catalog-only script -- see the banner above).
  select p.prosecdef and 'search_path=public, pg_temp' = any (p.proconfig)
    into my_proj_ok
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace and p.proname = 'my_projects';
  return next format('%s my_projects() is security definer with search_path=public, pg_temp: %s',
                     case when my_proj_ok then 'PASS' else 'FAIL' end,
                     coalesce(my_proj_ok::text, 'function not found'));

  -- 15. assert_gs_updates_stage_only() is security INVOKER (0008 reverted
  -- 0007's elevation: the guard reads no tables, and its only call,
  -- is_admin(), is already definer and so is unaffected by the caller's
  -- privileges -- definer bought nothing here and would have let any table
  -- access added to the guard later silently bypass RLS), with search_path
  -- still pinned (SET search_path works identically on an invoker
  -- function, and this remains a privilege boundary worth pinning).
  select (not p.prosecdef) and 'search_path=public, pg_temp' = any (p.proconfig)
    into assert_ok
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace and p.proname = 'assert_gs_updates_stage_only';
  return next format('%s assert_gs_updates_stage_only() is security invoker with search_path=public, pg_temp: %s',
                     case when assert_ok then 'PASS' else 'FAIL' end,
                     coalesce(assert_ok::text, 'function not found'));

  -- 16. log_cell_stage_change() is security definer with a pinned
  -- search_path. This is the exact fix for 0007's critical defect: with RLS
  -- enabled on cell_events and no INSERT policy, a security-invoker trigger
  -- made every stage change fail with 42501, for admin and GS alike.
  select p.prosecdef and 'search_path=public, pg_temp' = any (p.proconfig)
    into log_ok
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace and p.proname = 'log_cell_stage_change';
  return next format('%s log_cell_stage_change() is security definer with search_path=public, pg_temp: %s',
                     case when log_ok then 'PASS' else 'FAIL' end,
                     coalesce(log_ok::text, 'function not found'));

  -- 17. cells carries exactly four triggers (three from 0002, one from 0006).
  select count(*) into trig_count
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  where c.relname = 'cells' and not t.tgisinternal;
  return next format('%s cells has four triggers: %s found',
                     case when trig_count = 4 then 'PASS' else 'FAIL' end, trig_count);

  -- 18. cells_assert_gs_stage_only must sort alphabetically before
  -- cells_set_audit_columns by name. Necessary for Postgres's same-timing
  -- firing order, but not sufficient alone -- a name comparison proves
  -- nothing about whether either trigger is actually BEFORE UPDATE. See 19.
  select string_agg(tgname, ',' order by tgname) into trig_order
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  where c.relname = 'cells' and not t.tgisinternal
    and t.tgname in ('cells_assert_gs_stage_only', 'cells_set_audit_columns');
  return next format('%s cells_assert_gs_stage_only sorts before cells_set_audit_columns: order is %s',
                     case when trig_order = 'cells_assert_gs_stage_only,cells_set_audit_columns'
                          then 'PASS' else 'FAIL' end,
                     coalesce(trig_order, 'not found'));

  -- 19. Both triggers must actually BE row-level BEFORE UPDATE triggers,
  -- with no column list and no WHEN clause. Check 18 alone would still PASS
  -- if cells_assert_gs_stage_only were rewritten as AFTER UPDATE -- its
  -- name still sorts first, but a rejected write would then reach
  -- cells_set_audit_columns's stamp anyway, destroying the load-bearing
  -- guarantee. tgtype alone is not enough either: `BEFORE UPDATE OF
  -- stage_id` leaves tgtype at the same value (19) and would still PASS a
  -- tgtype-only check, while the guard silently stops firing on a
  -- geometry-only update -- the same hole as the original finding, one
  -- level down. tgattr (the column list; empty = fires on any column) and
  -- tgqual (the WHEN condition; null = none) close that. tgtype bitmask:
  -- bit 0 (1) = row-level, bit 1 (2) = BEFORE, bit 4 (16) = UPDATE.
  select count(*) into trig_count
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  where c.relname = 'cells' and not t.tgisinternal
    and t.tgname in ('cells_assert_gs_stage_only', 'cells_set_audit_columns')
    and (t.tgtype & 1) = 1
    and (t.tgtype & 2) = 2
    and (t.tgtype & 16) > 0
    and coalesce(array_length(t.tgattr::int2[], 1), 0) = 0
    and t.tgqual is null;
  return next format('%s cells_assert_gs_stage_only and cells_set_audit_columns are both row-level BEFORE UPDATE with no column list or WHEN clause: %s of 2 qualify',
                     case when trig_count = 2 then 'PASS' else 'FAIL' end, trig_count);

  -- 20. anon and authenticated hold no INSERT/UPDATE/DELETE grant on
  -- gs_credentials, cell_events, or credential_access_log. All three are
  -- meant to be written only by service_role or by a definer function
  -- running as postgres, so each must fail closed at the grant level, not
  -- only by policy. gs_credentials has no grant at all (0007); the other
  -- two keep SELECT, since their read policies still need it (0008).
  select count(*) into grant_count
  from information_schema.role_table_grants
  where table_schema = 'public'
    and table_name in ('gs_credentials', 'cell_events', 'credential_access_log')
    and grantee in ('anon', 'authenticated')
    and privilege_type in ('INSERT', 'UPDATE', 'DELETE');
  return next format('%s anon/authenticated hold no insert/update/delete grant on gs_credentials, cell_events or credential_access_log: %s found, expected 0',
                     case when grant_count = 0 then 'PASS' else 'FAIL' end, grant_count);

  -- 21. No foreign key in the public schema may be left with a bare
  -- ON DELETE (no action, confdeltype = 'a', Postgres's own default). An FK
  -- with no explicit delete action is the exact defect class that cost this
  -- project three review rounds and two BLOCKED returns (0003/0004/0005
  -- exist to fix instances of it) -- this is the structural check that
  -- would have caught it directly instead of relying on the cascade-depth
  -- race in checks 8-9 to surface it indirectly.
  select count(*) filter (where confdeltype = 'a'),
         string_agg(conname, ', ' order by conname) filter (where confdeltype = 'a')
    into n, bad_tables
  from pg_constraint
  where contype = 'f'
    and connamespace = 'public'::regnamespace;
  return next format('%s no foreign key with a bare ON DELETE (no action): %s offender(s): %s',
                     case when n = 0 then 'PASS' else 'FAIL' end,
                     n, coalesce(bad_tables, 'none'));

  -- 22. The `drawings` bucket (0009) exists and is private. A public bucket
  -- would make every deck drawing world-readable by URL.
  select count(*) into n from storage.buckets where id = 'drawings' and public = false;
  return next format('%s drawings bucket exists and is private: %s',
                     case when n = 1 then 'PASS' else 'FAIL' end, n);

  -- 23. storage.objects carries both drawings storage policies (0009):
  -- admin read+write, and GS read where the path's project is in
  -- my_projects().
  select count(*) into n from pg_policies
   where schemaname = 'storage' and tablename = 'objects'
     and policyname in ('drawings_admin_all', 'drawings_member_read');
  return next format('%s drawings storage policies: %s of 2',
                     case when n = 2 then 'PASS' else 'FAIL' end, n);

  -- 24. The last two definer/invoker functions (0009) now pin search_path.
  select count(*) into n from pg_proc
   where proname in ('assert_stage_belongs_to_project', 'set_cell_audit_columns')
     and proconfig @> array['search_path=public, pg_temp'];
  return next format('%s remaining functions pin search_path: %s of 2',
                     case when n = 2 then 'PASS' else 'FAIL' end, n);
end $$;

-- Check 25 (migration 0011): the progress audit columns are stamped only by a
-- progress change.
--
-- Its own fixtures, so it can be appended without renumbering checks 1-24.
--
-- The sentinel is planted by the INSERT, and that is forced rather than
-- preferred. This check needs a client-supplied updated_at that the old trigger
-- would overwrite and the fixed one must leave alone, and a sentinel has to be
-- used because the script runs inside one transaction: now() is the transaction
-- timestamp, so a re-stamp would be indistinguishable from no stamp at all if
-- the comparison were against now().
--
-- It used to plant that sentinel with `update cells set updated_at = sentinel`.
-- Migration 0013 added updated_at and updated_by to
-- cells_assert_gs_stage_only's rejected-column list, and this script runs as
-- postgres with auth.uid() null -- so is_admin() is false and that UPDATE is now
-- refused before the audit trigger ever runs, which would have turned this check
-- FAIL on a perfectly correct schema. (That guard is also why the stage-unchanged
-- update cannot write a geometry column: those have been on its list since 0006.)
--
-- What is left, and what is used here, is an update that changes no guarded
-- column at all: setting stage_id to the value it already holds. It is a real
-- UPDATE -- the row version is rewritten and every BEFORE/AFTER UPDATE trigger
-- fires -- and it is stage-unchanged in exactly the sense set_cell_audit_columns
-- tests, so it is the same case a geometry save presents to that trigger.
--
-- updated_by is not asserted. It is set from auth.uid() in the same `if` as
-- updated_at, which is null in this session, so it cannot be observed to change
-- either way -- guarding updated_at guards both.
create or replace function _verify_audit_columns() returns setof text language plpgsql as $$
declare
  p uuid; d uuid; s1 uuid; s2 uuid; cid uuid;
  sentinel timestamptz := timestamptz '2000-01-01 00:00:00+00';
  after_geometry timestamptz; after_stage timestamptz;
begin
  begin
    insert into projects (name, code) values ('VERIFY C','VERIFYC') returning id into p;
    insert into decks (project_id, seq, name, code, total_area_m2)
      values (p, 1, 'Deck', 'VC', 100) returning id into d;
    insert into project_stages (project_id, seq, name, color, weight)
      values (p, 1, 'Coat 1', '#fadb14', 1) returning id into s1;
    insert into project_stages (project_id, seq, name, color, weight)
      values (p, 2, 'Coat 2', '#bfbfbf', 0) returning id into s2;
    -- The sentinel and the recorded stage both go in with the row. Both
    -- triggers involved here are UPDATE-only, so an INSERT keeps what is
    -- supplied -- which is what makes 0013's new rejected columns irrelevant to
    -- planting it.
    insert into cells (deck_id, code, x, y, w, h, area_m2, stage_id, updated_at)
      values (d, 'R1C1', 0, 0, 1, 1, 100, s1, sentinel) returning id into cid;

    -- Stage unchanged, twice: stage_id set to the value it already holds. A real
    -- UPDATE -- the row version is rewritten and every trigger on the table
    -- fires -- that changes no column the non-admin guard rejects, so it reaches
    -- set_cell_audit_columns as exactly the case a geometry save presents. The
    -- old trigger would have answered it by overwriting the sentinel with now().
    -- Twice, because the second leaves updated_at at the value the row already
    -- holds, as PostgREST's geometry-only UPDATE does, and must not disturb it
    -- either.
    update cells set stage_id = s1 where id = cid;
    update cells set stage_id = s1 where id = cid;
    select updated_at into after_geometry from cells where id = cid;

    -- Real progress: the stamp must land. Without this half, a trigger body that
    -- skipped the stamp unconditionally would report PASS -- and the audit trail
    -- would simply stop recording anything. It is also what proves 0013's guard
    -- does not block the trigger's own write: the guard runs first and sees an
    -- updated_at the client did not touch, then the audit trigger stamps it.
    update cells set stage_id = s2 where id = cid;
    select updated_at into after_stage from cells where id = cid;

    delete from projects where id = p;

    return next format(
      '%s audit columns follow progress only: after a stage-unchanged update %L (want %L), after a stage change %L (want anything but the sentinel)',
      case when after_geometry = sentinel and after_stage <> sentinel
           then 'PASS' else 'FAIL' end,
      after_geometry, sentinel, after_stage);
  exception when others then
    return next 'FAIL audit columns: ' || sqlerrm;
  end;
end $$;

-- Check 26 (migration 0012): (project_id, seq) uniqueness is deferred, and a
-- reorder is accepted.
--
-- Its own fixtures, so it can be appended without renumbering checks 1-25.
--
-- Two halves in one row. The catalog half pins the shape a future reader might
-- "tidy" back to a plain unique constraint; the functional half pins the write
-- that shape exists for -- a single UPDATE moving two rows past each other,
-- which is what a reorder in the stage config panel produces once saveStages
-- keys its upsert on the id instead of the seq.
--
-- What is deliberately NOT asserted here: that a genuine duplicate seq is still
-- rejected. A deferred violation is only raised at the outer COMMIT, and this
-- script runs as one transaction, so provoking one would abort the whole
-- verification run instead of returning a FAIL row. Forcing it early with SET
-- CONSTRAINTS ALL IMMEDIATE inside a subtransaction would leave the constraint
-- mode altered for whatever ran afterwards. The catalog half is what guards it:
-- contype = 'u' over exactly (project_id, seq) is the constraint still being
-- there, and `deferred` changes only WHEN it is checked, never whether.
create or replace function _verify_stage_seq_deferrable() returns setof text language plpgsql as $$
declare
  p uuid;
  shape_ok boolean;
  swap_ok boolean := false;
  swap_err text := 'none';
  seqs text;
begin
  begin
    select c.contype = 'u' and c.condeferrable and c.condeferred
      into shape_ok
    from pg_constraint c
    where c.conrelid = 'public.project_stages'::regclass
      and c.conname = 'project_stages_project_id_seq_key'
      -- attname is `name`, not `text`, and there is no name[] = text[] operator
      -- -- so the cast is load-bearing, not decoration.
      and (select array_agg(a.attname::text order by k.ord)
             from unnest(c.conkey) with ordinality as k(attnum, ord)
             join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum)
          = array['project_id', 'seq'];

    insert into projects (name, code) values ('VERIFY D','VERIFYD') returning id into p;
    insert into project_stages (project_id, seq, name, color, weight)
      values (p, 1, 'Coat 1', '#fadb14', 0.5);
    insert into project_stages (project_id, seq, name, color, weight)
      values (p, 2, 'Coat 2', '#bfbfbf', 0.5);

    begin
      -- One statement, both rows: after the first row is rewritten two rows hold
      -- seq 2, which an immediate constraint rejects even though the statement
      -- leaves the seqs unique.
      update project_stages set seq = 3 - seq where project_id = p;
      swap_ok := true;
    exception when others then
      swap_err := sqlerrm;
    end;

    select string_agg(seq::text || '=' || name, ', ' order by seq) into seqs
    from project_stages where project_id = p;

    delete from projects where id = p;

    return next format(
      '%s stage seq uniqueness is deferred and a reorder is accepted: shape %s, swap %s (%s), after swap: %s',
      case when coalesce(shape_ok, false) and swap_ok and seqs = '1=Coat 2, 2=Coat 1'
           then 'PASS' else 'FAIL' end,
      coalesce(shape_ok::text, 'constraint missing'), swap_ok, swap_err, coalesce(seqs, 'none'));
  exception when others then
    return next 'FAIL stage seq uniqueness is deferred: ' || sqlerrm;
  end;
end $$;

-- Check 27: removing a middle stage and renumbering the survivors -- the write
-- the stage config panel actually issues, and the one check 26 does not cover.
--
-- Its own fixtures ('VERIFY E'), so it can be appended without renumbering
-- checks 1-26.
--
-- Check 26 exercises a reorder: two rows swapping seq inside one statement, which
-- is why 0012 exists. A removal is a different write and it was broken in a
-- different way. The panel renumbers the survivors 1..n, so removing anything but
-- the LAST stage moves a survivor into a seq the row being removed still holds --
-- and saveStages upserted the survivors before deleting the removed row, so the
-- upsert put two rows at one seq and Postgres rejected it. Nothing was deleted,
-- and only the last stage in a project could ever be removed. A green check 26
-- said nothing about that, because a reorder shifts no seq into an occupied one.
--
-- What this asserts is the fixed write in the order saveStages now issues it:
-- delete the removed id, then upsert the survivors with their new seqs, in the
-- `insert ... on conflict (id) do update` shape PostgREST produces. Plus the two
-- consequences that make it worth the round trip: a cell recorded at a SURVIVING
-- stage still points at that stage (identity is the id, so its seq moving from 4
-- to 3 does not move the cell), and a cell recorded at the REMOVED stage is
-- nulled rather than cascaded away (cells.stage_id ... on delete set null, 0001)
-- -- which is precisely what the panel's confirmation dialog promises.
--
-- What this deliberately does NOT do is reproduce the broken order. It cannot:
-- this script runs as one transaction and 0012 defers the constraint to COMMIT,
-- so an upsert followed by a delete inside a single transaction is accepted. The
-- defect needed the upsert to commit on its own, which is what it did as a
-- separate PostgREST round trip. The regression is pinned in
-- src/lib/projectsApi.test.ts, against a stand-in that enforces the constraint
-- per statement; this check pins that the fixed write is one the database
-- actually accepts.
create or replace function _verify_stage_removal() returns setof text language plpgsql as $$
declare
  p uuid; d uuid;
  s1 uuid; s2 uuid; s3 uuid; s4 uuid; s5 uuid;
  survivor_cell uuid; orphan_cell uuid;
  write_ok boolean := false;
  write_err text := 'none';
  seqs text;
  survivor_stage uuid; survivor_seq int; orphan_stage uuid;
begin
  begin
    insert into projects (name, code) values ('VERIFY E','VERIFYE') returning id into p;
    insert into decks (project_id, seq, name, code, total_area_m2)
      values (p, 1, 'Deck', 'VE', 500) returning id into d;
    -- The five-stage template a new project is seeded with, which is the shape
    -- every real removal starts from.
    insert into project_stages (project_id, seq, name, color, weight)
      values (p, 1, 'Coat 1', '#fadb14', 0.2) returning id into s1;
    insert into project_stages (project_id, seq, name, color, weight)
      values (p, 2, 'Coat 2', '#bfbfbf', 0.2) returning id into s2;
    insert into project_stages (project_id, seq, name, color, weight)
      values (p, 3, 'Coat 3', '#52c41a', 0.2) returning id into s3;
    insert into project_stages (project_id, seq, name, color, weight)
      values (p, 4, 'Coat 4', '#1677ff', 0.2) returning id into s4;
    insert into project_stages (project_id, seq, name, color, weight)
      values (p, 5, 'Coat 5', '#722ed1', 0.2) returning id into s5;

    -- One cell recorded at a stage that survives, one at the stage being
    -- removed. Without both, the check could pass while doing the wrong thing to
    -- either.
    insert into cells (deck_id, code, x, y, w, h, area_m2, stage_id)
      values (d, 'R1C1', 0, 0, 0.5, 1, 250, s4) returning id into survivor_cell;
    insert into cells (deck_id, code, x, y, w, h, area_m2, stage_id)
      values (d, 'R1C2', 0.5, 0, 0.5, 1, 250, s2) returning id into orphan_cell;

    begin
      -- The delete goes first: it frees seq 2 so the renumbering below has
      -- somewhere to land. Reverse these two statements against a live PostgREST
      -- and the upsert fails on its own commit -- see the comment above.
      delete from project_stages where id = s2;

      -- The survivors, renumbered 1..4, in the statement shape PostgREST builds
      -- for an upsert keyed on the primary key.
      insert into project_stages (id, project_id, seq, name, color, weight) values
        (s1, p, 1, 'Coat 1', '#fadb14', 0.25),
        (s3, p, 2, 'Coat 3', '#52c41a', 0.25),
        (s4, p, 3, 'Coat 4', '#1677ff', 0.25),
        (s5, p, 4, 'Coat 5', '#722ed1', 0.25)
      on conflict (id) do update set
        seq = excluded.seq, name = excluded.name,
        color = excluded.color, weight = excluded.weight;
      write_ok := true;
    exception when others then
      write_err := sqlerrm;
    end;

    select string_agg(seq::text || '=' || name, ', ' order by seq) into seqs
    from project_stages where project_id = p;
    select stage_id into survivor_stage from cells where id = survivor_cell;
    select seq into survivor_seq from project_stages where id = survivor_stage;
    select stage_id into orphan_stage from cells where id = orphan_cell;

    delete from projects where id = p;

    return next format(
      '%s a middle stage can be removed and the survivors renumbered: write %s (%s), after: %s, cell at a surviving stage still on Coat 4 (now seq %s): %s, cell at the removed stage nulled: %s',
      case when write_ok
            and seqs = '1=Coat 1, 2=Coat 3, 3=Coat 4, 4=Coat 5'
            and survivor_stage = s4
            and survivor_seq = 3
            and orphan_stage is null
           then 'PASS' else 'FAIL' end,
      write_ok, write_err, coalesce(seqs, 'none'),
      coalesce(survivor_seq::text, 'gone'), survivor_stage = s4, orphan_stage is null);
  exception when others then
    return next 'FAIL a middle stage can be removed: ' || sqlerrm;
  end;
end $$;

-- Check 28 (migration 0013): a non-admin cannot forge the progress audit
-- columns, and the audit trigger still stamps them.
--
-- Its own fixtures ('VERIFY F'), so it can be appended without renumbering
-- checks 1-27.
--
-- This script runs as postgres with auth.uid() null, so is_admin() is false and
-- this session IS the non-admin case cells_assert_gs_stage_only exists for --
-- the one place in this file where that is an advantage rather than the
-- limitation the banner at the top describes.
--
-- Three halves, because each alone is satisfiable by a wrong guard. Rejecting a
-- forged updated_at and a forged updated_by are what 0013 adds; accepting a plain
-- stage change is what stops a guard that simply rejects everything from
-- reporting PASS -- and that last one also carries the ordering claim in 0013's
-- comment, since the audit trigger has to stamp updated_at on that accepted
-- write despite this guard having inspected the same column moments earlier.
-- Asserted on the message, not merely on "something was raised": a forged
-- updated_by is also a foreign-key violation, so without matching the text this
-- check would pass on a schema where 0013 was never applied.
create or replace function _verify_gs_audit_guard() returns setof text language plpgsql as $$
declare
  p uuid; d uuid; s1 uuid; s2 uuid; cid uuid;
  sentinel timestamptz := timestamptz '2000-01-01 00:00:00+00';
  guard_msg text := 'only stage_id may be changed by a non-admin';
  at_rejected boolean := false; at_err text := 'accepted';
  by_rejected boolean := false; by_err text := 'accepted';
  stage_ok boolean := false; stage_err text := 'none';
  stamped timestamptz;
begin
  begin
    insert into projects (name, code) values ('VERIFY F','VERIFYF') returning id into p;
    insert into decks (project_id, seq, name, code, total_area_m2)
      values (p, 1, 'Deck', 'VF', 100) returning id into d;
    insert into project_stages (project_id, seq, name, color, weight)
      values (p, 1, 'Coat 1', '#fadb14', 1) returning id into s1;
    insert into project_stages (project_id, seq, name, color, weight)
      values (p, 2, 'Coat 2', '#bfbfbf', 0) returning id into s2;
    -- Recorded at Coat 1 with a sentinel timestamp, planted on the INSERT
    -- because both triggers are UPDATE-only.
    insert into cells (deck_id, code, x, y, w, h, area_m2, stage_id, updated_at)
      values (d, 'R1C1', 0, 0, 1, 1, 100, s1, sentinel) returning id into cid;

    -- A forged date, carried alongside a legitimate stage change -- the shape a
    -- crafted PATCH would take, since a GS is allowed to move the stage.
    begin
      update cells set stage_id = s2, updated_at = timestamptz '2030-06-01 00:00:00+00'
       where id = cid;
    exception when others then
      at_rejected := sqlerrm like '%' || guard_msg || '%';
      at_err := sqlerrm;
    end;

    -- A forged author: attributing a coat to somebody who never recorded it.
    begin
      update cells set stage_id = s2, updated_by = gen_random_uuid() where id = cid;
    exception when others then
      by_rejected := sqlerrm like '%' || guard_msg || '%';
      by_err := sqlerrm;
    end;

    -- What a GS is actually for, which must still work -- and must still be
    -- stamped by set_cell_audit_columns afterwards.
    begin
      update cells set stage_id = s2 where id = cid;
      stage_ok := true;
    exception when others then
      stage_err := sqlerrm;
    end;
    select updated_at into stamped from cells where id = cid;

    delete from projects where id = p;

    return next format(
      '%s non-admin cannot forge the audit columns: updated_at rejected %s (%s), updated_by rejected %s (%s), plain stage change accepted %s (%s) and stamped off the sentinel %s',
      case when at_rejected and by_rejected and stage_ok and stamped <> sentinel
           then 'PASS' else 'FAIL' end,
      at_rejected, at_err, by_rejected, by_err, stage_ok, stage_err,
      stamped <> sentinel);
  exception when others then
    return next 'FAIL non-admin cannot forge the audit columns: ' || sqlerrm;
  end;
end $$;

-- Checks 29-31 (migration 0014): the stage-deletion audit gap, its negative
-- control, and the project-delete cascade the new trigger sits inside.
--
-- Its own fixtures ('VERIFY G'), so it can be appended without renumbering
-- checks 1-28.
--
-- Every cell below takes its stage on the INSERT, never on an UPDATE. That is
-- deliberate: cells_log_stage_change is an AFTER UPDATE trigger, so an insert
-- logs nothing, and the event counts below can therefore be read as "events
-- caused by the statement under test" rather than "events, minus the ones the
-- setup happened to create".
create or replace function _verify_stage_deletion_audit() returns setof text language plpgsql as $$
declare
  p uuid; d uuid; s_doomed uuid; s_live uuid; c_doomed uuid; c_live uuid;
  fn_ok boolean;
  del_count int; del_name text; del_from uuid;
  live_count int; live_name text;
  project_deleted boolean := false; project_err text := 'none';
begin
  select p2.prosecdef and 'search_path=public, pg_temp' = any (p2.proconfig)
    into fn_ok
  from pg_proc p2
  where p2.pronamespace = 'public'::regnamespace
    and p2.proname = 'log_stage_deletion_on_cells';

  begin
    insert into projects (name, code) values ('VERIFY G','VERIFYG') returning id into p;
    insert into decks (project_id, seq, name, code, total_area_m2)
      values (p, 1, 'Deck', 'VG', 100) returning id into d;
    insert into project_stages (project_id, seq, name, color, weight)
      values (p, 1, 'Doomed Coat', '#ff4d4f', 0.5) returning id into s_doomed;
    insert into project_stages (project_id, seq, name, color, weight)
      values (p, 2, 'Living Coat', '#52c41a', 0.5) returning id into s_live;
    insert into cells (deck_id, code, x, y, w, h, area_m2, stage_id)
      values (d, 'R1C1', 0, 0, 1, 0.5, 60, s_doomed) returning id into c_doomed;
    insert into cells (deck_id, code, x, y, w, h, area_m2, stage_id)
      values (d, 'R2C1', 0, 0.5, 1, 0.5, 40, s_live) returning id into c_live;

    -- 29. the removal itself
    delete from project_stages where id = s_doomed;

    select count(*) into del_count from cell_events where cell_id = c_doomed;
    select from_stage_name, from_stage_id into del_name, del_from
      from cell_events where cell_id = c_doomed order by id desc limit 1;

    return next format(
      '%s stage deletion is logged once, with the name: %s row(s) (expected 1), from_stage_name %L (expected %L), from_stage_id retained %s, log_stage_deletion_on_cells definer+search_path %s',
      case when del_count = 1
             and del_name = 'Doomed Coat'
             and del_from = s_doomed
             and coalesce(fn_ok, false)
           then 'PASS' else 'FAIL' end,
      del_count, del_name, 'Doomed Coat', del_from = s_doomed,
      coalesce(fn_ok::text, 'function not found'));

    -- 30. negative control: an ordinary return to "not started", stage alive
    update cells set stage_id = null where id = c_live;
    select count(*) into live_count from cell_events where cell_id = c_live;
    select from_stage_name into live_name
      from cell_events where cell_id = c_live order by id desc limit 1;

    return next format(
      '%s clearing a cell whose stage is still alive is still logged with its name: %s row(s) (expected 1), from_stage_name %L (expected %L)',
      case when live_count = 1 and live_name = 'Living Coat' then 'PASS' else 'FAIL' end,
      live_count, live_name, 'Living Coat');

    -- 31. the project delete, with the new BEFORE DELETE trigger inside it
    begin
      delete from projects where id = p;
      project_deleted := true;
    exception when others then
      project_err := sqlerrm;
    end;

    return next format(
      '%s a project delete still succeeds with project_stages_log_deletion in place: %s (%s)',
      case when project_deleted then 'PASS' else 'FAIL' end,
      project_deleted, project_err);
  exception when others then
    return next 'FAIL stage deletion audit: ' || sqlerrm;
    return next 'FAIL stage deletion audit negative control: not reached';
    return next 'FAIL project delete with the deletion trigger: not reached';
  end;
end $$;

-- Check 32 (migration 0015): cells is published for realtime.
create or replace function _verify_realtime_publication() returns setof text language plpgsql as $$
declare
  n int;
begin
  select count(*) into n
  from pg_publication_tables
  where pubname = 'supabase_realtime'
    and schemaname = 'public'
    and tablename = 'cells';

  return next format(
    '%s public.cells is published for realtime: %s membership row(s) in supabase_realtime, need 1',
    case when n = 1 then 'PASS' else 'FAIL' end, n);
end $$;

-- A single top-level SELECT: `supabase db query -f` surfaces only the last
-- result set a multi-statement file produces, so the checks are combined
-- here with UNION ALL rather than issued as separate SELECTs.
select * from _verify_triggers()
union all
select * from _verify_rls()
union all
select * from _verify_audit_columns()
union all
select * from _verify_stage_seq_deferrable()
union all
select * from _verify_stage_removal()
union all
select * from _verify_gs_audit_guard()
union all
select * from _verify_stage_deletion_audit()
union all
select * from _verify_realtime_publication();

drop function _verify_triggers();
drop function _verify_rls();
drop function _verify_audit_columns();
drop function _verify_stage_seq_deferrable();
drop function _verify_stage_removal();
drop function _verify_gs_audit_guard();
drop function _verify_stage_deletion_audit();
drop function _verify_realtime_publication();
