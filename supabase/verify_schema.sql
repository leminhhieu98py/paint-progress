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
--   3. cells_set_audit_columns stamps updated_at on every update.
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
-- Checks 10-19 are structural RLS assertions added by migrations 0006/0007.
-- They read only the system catalogs (pg_class, pg_policies, pg_proc,
-- pg_trigger) and need no authenticated session -- see the banner above for
-- what that does and does not prove.
--   10. Every one of the 12 public tables has row level security enabled.
--   11. gs_credentials has zero rows in pg_policies: service_role bypasses
--       RLS, everyone else must be denied by the absence of any policy, not
--       by a permissive-looking policy that happens to always be false.
--   12. credential_access_log has exactly one policy, and it is a SELECT
--       policy (admin-only read; no insert/update/delete for anyone but
--       service_role).
--   13. is_admin() is security definer with search_path=public.
--   14. my_projects() is security definer with search_path=public, pg_temp.
--       0007 pinned pg_temp explicitly and added an `active` filter so a
--       deactivated GS loses read access immediately, rather than only once
--       Task 7's handler removes their project_members rows.
--   15. assert_gs_updates_stage_only() is security definer with a pinned
--       search_path. 0007 elevated it -- it calls is_admin(), a privilege
--       boundary -- and added an `id` comparison so a GS cannot renumber a
--       cell's primary key through the update path.
--   16. log_cell_stage_change() is security definer with a pinned
--       search_path. This is the exact fix for the critical defect 0007
--       exists for: with RLS enabled on cell_events and no INSERT policy, a
--       security-invoker trigger made every stage change fail with 42501,
--       for admin and GS alike. Checks 13-16 all matter for the same
--       underlying reason: without security definer, a function that reads
--       or writes an RLS-protected table under the caller's own privileges
--       either recurses (profiles, via is_admin) or is denied (cell_events).
--   17. cells has exactly four triggers (three from 0002, one from 0006).
--   18. Of those, cells_assert_gs_stage_only sorts alphabetically before
--       cells_set_audit_columns by name -- necessary for Postgres's
--       same-timing firing order, but not sufficient alone (see 19).
--   19. cells_assert_gs_stage_only and cells_set_audit_columns are both
--       row-level BEFORE UPDATE triggers. Check 18 alone would still PASS
--       if cells_assert_gs_stage_only were rewritten as an AFTER UPDATE
--       trigger, silently destroying the guarantee that a rejected write
--       never reaches the audit stamp -- this check asserts timing directly
--       via tgtype, not just the name that determines order among peers.
--
-- How to run:
--   nvm use 22
--   npx supabase db query --linked -f supabase/verify_schema.sql
--
-- Every returned row must begin with PASS (19 rows in total, one per
-- numbered check above, 1-19 with no gaps). A row beginning with FAIL means
-- a regression in the trigger/FK/RLS behaviour set up across migrations
-- 0001-0007; re-read those migrations' comments before changing this file.
--
-- WARNING: this script INSERTS and then DELETES test rows (projects named
-- 'VERIFY A' / 'VERIFY B' and everything cascading from them). It is meant
-- to run against a disposable or pre-production database only. Never run
-- it against a database holding real project data.

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

  -- 4. the audit trigger must have stamped updated_at
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

  -- 13. is_admin() is security definer with search_path=public. Without
  -- security definer, the profiles admin policy recurses infinitely: it
  -- calls is_admin(), which itself reads profiles under RLS.
  select p.prosecdef and 'search_path=public' = any (p.proconfig)
    into is_admin_ok
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace and p.proname = 'is_admin';
  return next format('%s is_admin() is security definer with search_path=public: %s',
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

  -- 15. assert_gs_updates_stage_only() is security definer with a pinned
  -- search_path. 0007 elevated it because it calls is_admin() and is itself
  -- a privilege boundary, so its own search_path must not be attacker
  -- influenced.
  select p.prosecdef and 'search_path=public, pg_temp' = any (p.proconfig)
    into assert_ok
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace and p.proname = 'assert_gs_updates_stage_only';
  return next format('%s assert_gs_updates_stage_only() is security definer with search_path=public, pg_temp: %s',
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

  -- 19. Both triggers must actually BE row-level BEFORE UPDATE triggers.
  -- Check 18 alone would still PASS if cells_assert_gs_stage_only were
  -- rewritten as an AFTER UPDATE trigger -- its name still sorts first, but
  -- a rejected write would then reach cells_set_audit_columns's stamp
  -- anyway, destroying the load-bearing guarantee. tgtype is a bitmask:
  -- bit 0 (1) = row-level, bit 1 (2) = BEFORE, bit 4 (16) = UPDATE.
  select count(*) into trig_count
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  where c.relname = 'cells' and not t.tgisinternal
    and t.tgname in ('cells_assert_gs_stage_only', 'cells_set_audit_columns')
    and (t.tgtype & 1) = 1
    and (t.tgtype & 2) = 2
    and (t.tgtype & 16) > 0;
  return next format('%s cells_assert_gs_stage_only and cells_set_audit_columns are both row-level BEFORE UPDATE triggers: %s of 2 qualify',
                     case when trig_count = 2 then 'PASS' else 'FAIL' end, trig_count);
end $$;

-- A single top-level SELECT: `supabase db query -f` surfaces only the last
-- result set a multi-statement file produces, so the two checks are combined
-- here with UNION ALL rather than issued as two separate SELECTs.
select * from _verify_triggers()
union all
select * from _verify_rls();

drop function _verify_triggers();
drop function _verify_rls();
