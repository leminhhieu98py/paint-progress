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
--   1. A cell cannot be assigned a stage from a different deck
--      (cells_assert_stage_project).
--   2. A cell can be assigned a stage from its own deck, and doing so
--      logs exactly one cell_events row (cells_log_stage_change).
--   3. cells_set_audit_columns stamps updated_at when a cell's stage changes.
--      (That it does NOT stamp on any other update is check 25, added by 0011;
--      that a non-admin cannot supply one is check 28, added by 0013.)
--   4. Re-setting the same stage is a no-op: it must not log a second event.
--   5. The cell_events name snapshot (from 0005) is durable against a
--      RENAME: renaming the stage of an already-recorded event must not
--      change what that event says happened, because cell_events no longer
--      holds a foreign key to deck_stages. Exercised on cell c1 / stage
--      s1, which must stay alive afterwards (see check 8 below).
--   6. The same snapshot is durable against a hard DELETE of the stage:
--      the recorded name and id must survive, with the id left dangling
--      (no longer present in deck_stages) rather than nulled or
--      cascaded away. Exercised on a SEPARATE fixture, cell c2 / stage s3,
--      specifically so that destroying s3 does not disarm check 8.
--   7. A cell still pointing at a live stage of the deck is present
--      right before cleanup — i.e. the depth-mismatch race that 0004/0005
--      exist to fix is actually armed, not accidentally defused by an
--      earlier check. See the comment above check 7 for why this exists.
--   8. A project (with its decks, stages, cells and cell_events) can be
--      deleted cleanly. This is the regression the fix chain in
--      0003/0004/0005 exists to guarantee: deleting a project fans out
--      into a decks -> cells CASCADE and a decks -> deck_stages -> cells.stage_id
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
--   26. deck_stages' (deck_id, seq) uniqueness is DEFERRABLE INITIALLY
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
--       deck_stages row is already gone, and 0005 dropped the FK that could
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
--       in place. That trigger inserts into cell_events from inside the fan-out
--       of decks -> deck_stages, racing decks -> cells
--       CASCADE at a different depth -- the defect class that aborted this
--       delete twice in Phase 1. Its `exists (select 1 from projects ...)`
--       guard is what makes it safe; this check is what proves the guard works.
--       Note that this check IS its own cleanup step, so if it ever FAILs its
--       VERIFY G fixtures commit and stay in the database, the same shape as the
--       incident check 9 records. A FAIL here means residue, not just a red row.
--
-- Check 32 is added by 0015. Catalog-only, no fixtures.
--   32. public.cells is a member of the supabase_realtime publication. Realtime
--       replicates that publication and nothing else, so without this the GS
--       screen's channel reports SUBSCRIBED and then delivers nothing, with no
--       error on either side -- and spec §11 row 3's "every open client
--       converged" is quietly false.
--
-- Check 33 is added by 0016. Catalog-only, no fixtures.
--   33. public.cells has REPLICA IDENTITY FULL (pg_class.relreplident = 'f').
--       Membership in the publication (check 32) is what makes INSERT and UPDATE
--       deliverable; this is what makes DELETE deliverable. Under the default
--       replica identity a delete's WAL old record carries only the primary key,
--       so Realtime cannot evaluate cells_member_read (0006) -- which needs
--       deck_id -- and silently drops the event for that subscriber. Measured
--       against the live project: with DEFAULT, a DELETE binding filtered on
--       deck_id AND an unfiltered one both received nothing. The consequence is
--       not cosmetic: a merge in the deck editor is one UPDATE of the survivor
--       plus a DELETE of each absorbed cell, so without this the absorbed cells
--       stay on the foreman's drawing with their area counted twice in every
--       reported percentage.
--
-- Checks 34-35 are added by 0022 and 0023. Catalog-only, no fixtures.
--   34. coworker_names() exists, is security definer with a pinned
--       search_path, and is executable by `authenticated` but NOT by `anon`.
--       It is a tablet's only window onto other people's names; a PUBLIC
--       grant left in place would hand every anonymous client the full name
--       of every admin.
--   35. cell_events carries the four report columns from 0023 and the named
--       foreign key progressApi embeds through; set_report_note() exists, is
--       security definer with a pinned search_path, is not executable by
--       `anon`; and `authenticated` still holds no UPDATE on cell_events --
--       the function is meant to be the only client-reachable write onto the
--       audit table, and a stray UPDATE grant would make it not so.
--
-- How to run:
--   nvm use 22
--   npx supabase db query --linked -f supabase/verify_schema.sql
--
-- Every returned row must begin with PASS: 43 rows in total on a linked
-- project with 0001-0030 applied (measured 2026-09-05; the numbering above
-- runs 1-41 because one earlier check emits two rows and some later ones
-- several). A row beginning with FAIL means
-- a regression in the trigger/FK/RLS behaviour set up across migrations
-- 0001-0023; re-read those migrations' comments before changing this file.
--
-- One standing exception while a migration is outstanding: checks 29-31 test
-- migration 0014, so against a database where 0014 has not been applied yet
-- check 29 reports FAIL with `from_stage_name NULL` -- which IS the defect
-- 0014 fixes, reproduced. A FAIL there means "not applied", not "broken", and
-- it is the evidence that the check is not vacuous. Check 32 stands in the same
-- relation to 0015: until that migration is applied it reports FAIL with 0
-- membership rows, which is exactly the state in which the GS screen's channel
-- subscribes successfully and then receives nothing. Check 33 stands in the same
-- relation to 0016: until that migration is applied it reports FAIL with
-- relreplident = 'd', which is exactly the state in which the channel delivers
-- INSERT and UPDATE and drops every DELETE.
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

-- Every fixture below hangs off a work: since 0024 a stage belongs to a
-- (work, deck) and a bay's progress lives in cell_states, one row per (bay,
-- work). One helper, so the seven fixture sets cannot drift from each other.
create or replace function _verify_seed_work(p uuid, d uuid) returns uuid language plpgsql as $$
declare
  w uuid;
begin
  insert into works (project_id, seq, name, kind, weight, counts)
    values (p, 1, 'Verify Work', 'bays', 1, true) returning id into w;
  insert into work_decks (work_id, deck_id, weight) values (w, d, 1);
  return w;
end $$;

create or replace function _verify_triggers() returns setof text language plpgsql as $$
declare
  p1 uuid; p2 uuid; d1 uuid; d2 uuid; w1 uuid; w2 uuid; s1 uuid; s2 uuid; s3 uuid; c1 uuid; c2 uuid;
  ev_count int; upd timestamptz; ev1_id bigint; ev2_id bigint;
  nm text; tsid uuid; n int;
begin
  insert into projects (name, code) values ('VERIFY A','VERIFYA') returning id into p1;
  insert into projects (name, code) values ('VERIFY B','VERIFYB') returning id into p2;
  insert into decks (project_id, seq, name, code, total_area_m2)
    values (p1, 1, 'Deck', 'VD', 100) returning id into d1;
  -- A deck of its own for p2: a stage hangs off a (work, deck), so the foreign
  -- stage this check offers bay c1 has to live on a foreign work and deck.
  insert into decks (project_id, seq, name, code, total_area_m2)
    values (p2, 1, 'Other Deck', 'VD2', 100) returning id into d2;
  w1 := _verify_seed_work(p1, d1);
  w2 := _verify_seed_work(p2, d2);
  insert into deck_stages (work_id, deck_id, seq, name, color, weight)
    values (w1, d1, 1, 'Coat 1', '#fadb14', 1) returning id into s1;
  insert into deck_stages (work_id, deck_id, seq, name, color, weight)
    values (w2, d2, 1, 'Coat 1', '#fadb14', 1) returning id into s2;
  insert into cells (deck_id, code, x, y, w, h, area_m2)
    values (d1, 'R1C1', 0, 0, 1, 1, 100) returning id into c1;

  -- A third stage and second bay, both under (w1, d1), dedicated to the
  -- hard-delete durability check (check 7). seq = 2 so it does not collide
  -- with s1's unique (work_id, deck_id, seq).
  insert into deck_stages (work_id, deck_id, seq, name, color, weight)
    values (w1, d1, 2, 'Doomed Stage', '#ff4d4f', 0) returning id into s3;
  insert into cells (deck_id, code, x, y, w, h, area_m2)
    values (d1, 'R1C2', 0, 0.5, 1, 0.5, 50) returning id into c2;
  -- Since 0024 a bay's position is a cell_states row per work, and creating
  -- one at a stage logs the move from "not started".
  insert into cell_states (cell_id, work_id, deck_id, stage_id) values (c2, w1, d1, s3);
  select id into ev2_id from cell_events where cell_id = c2 order by id limit 1;

  -- 1. a stage from another (work, deck) must be rejected
  begin
    insert into cell_states (cell_id, work_id, deck_id, stage_id) values (c1, w1, d1, s2);
    return next 'FAIL cross-deck: the foreign stage was accepted';
  exception when others then
    return next 'PASS cross-deck: ' || sqlerrm;
  end;

  -- 2. a stage from the bay's own (work, deck) must be accepted
  begin
    insert into cell_states (cell_id, work_id, deck_id, stage_id) values (c1, w1, d1, s1);
    return next 'PASS same-deck: accepted';
  exception when others then
    return next 'FAIL same-deck: ' || sqlerrm;
  end;

  -- capture the event row check 2 created; the rename-durability check below
  -- reads this exact row back after mutating its stage's name. s1 itself is
  -- deliberately never deleted in this script (see check 8).
  select id into ev1_id from cell_events where cell_id = c1 order by id limit 1;

  -- 3. that accepted change must have written exactly one cell_events row
  select count(*) into ev_count from cell_events where cell_id = c1;
  return next format('%s cell_events: %s row(s), expected 1',
                     case when ev_count = 1 then 'PASS' else 'FAIL' end, ev_count);

  -- 4. the audit trigger must have stamped updated_at on the state row.
  -- Weak on its own -- check 25 asserts both directions against a sentinel.
  select updated_at into upd from cell_states where cell_id = c1 and work_id = w1;
  return next format('%s updated_at: %s',
                     case when upd is not null then 'PASS' else 'FAIL' end, upd);

  -- 5. setting the same stage again must NOT log a second event
  update cell_states set stage_id = s1 where cell_id = c1 and work_id = w1;
  select count(*) into ev_count from cell_events where cell_id = c1;
  return next format('%s no-op update: %s event(s), expected 1',
                     case when ev_count = 1 then 'PASS' else 'FAIL' end, ev_count);

  -- 6. durability against a RENAME (c1 / s1, which stays alive afterwards).
  update deck_stages set name = 'Coat 3 RENAMED' where id = s1;
  select to_stage_name into nm from cell_events where id = ev1_id;
  return next format('%s snapshot survives a rename: recorded %L, stage is now %L',
                     case when nm = 'Coat 1' then 'PASS' else 'FAIL' end,
                     nm,
                     (select name from deck_stages where id = s1));

  -- 7. durability against a hard DELETE, on a SEPARATE fixture (c2 / s3).
  begin
    delete from deck_stages where id = s3;
    select to_stage_name, to_stage_id into nm, tsid from cell_events where id = ev2_id;
    return next format('%s snapshot survives stage deletion: recorded %L, to_stage_id %s',
                       case when nm = 'Doomed Stage'
                             and tsid = s3
                             and not exists (select 1 from deck_stages where id = tsid)
                            then 'PASS' else 'FAIL' end,
                       nm,
                       case when exists (select 1 from deck_stages where id = tsid)
                            then 'still exists (unexpected)' else 'dangling, as expected' end);
  exception when others then
    return next 'FAIL delete-durability: ' || sqlerrm;
  end;

  -- 8. Assert the race is actually armed before relying on the cleanup to
  -- test it: at least one state row still points at a live stage of p1.
  select count(*) into n
  from cell_states cs
  join decks d on d.id = cs.deck_id
  join deck_stages ps on ps.id = cs.stage_id
  where d.project_id = p1;
  return next format('%s race armed: %s bay state(s) still point at a live stage of p1, need >= 1',
                     case when n >= 1 then 'PASS' else 'FAIL' end, n);

  -- 9. cleanup: deleting the projects (and everything cascading from them)
  -- must succeed. projects -> decks -> cells -> cell_states (CASCADE) races
  -- projects -> works -> deck_stages -> cell_states.stage_id (SET NULL) at
  -- different depths, which is the 0004/0005 class of defect.
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
      'deck_stages', 'project_members', 'decks', 'deck_guides',
      'cells', 'zones', 'zone_cells', 'cell_events',
      'works', 'work_decks', 'cell_states'
    );
  return next format('%s rls enabled on all 15 tables: %s of 15 found, offenders: %s',
                     case when n = 15 and bad_tables is null then 'PASS' else 'FAIL' end,
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
  where p.pronamespace = 'public'::regnamespace and p.proname = 'assert_gs_state_write';
  return next format('%s assert_gs_state_write() is security invoker with search_path=public, pg_temp: %s',
                     case when assert_ok then 'PASS' else 'FAIL' end,
                     coalesce(assert_ok::text, 'function not found'));

  -- 16. log_cell_stage_change() is security definer with a pinned
  -- search_path. This is the exact fix for 0007's critical defect: with RLS
  -- enabled on cell_events and no INSERT policy, a security-invoker trigger
  -- made every stage change fail with 42501, for admin and GS alike.
  select p.prosecdef and 'search_path=public, pg_temp' = any (p.proconfig)
    into log_ok
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace and p.proname = 'log_cell_state_change';
  return next format('%s log_cell_state_change() is security definer with search_path=public, pg_temp: %s',
                     case when log_ok then 'PASS' else 'FAIL' end,
                     coalesce(log_ok::text, 'function not found'));

  -- 17. Since 0024 the four progress triggers live on cell_states, and cells
  -- -- geometry only now -- carries none.
  select count(*) into trig_count
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  where c.relname = 'cell_states' and not t.tgisinternal;
  select count(*) into n
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  where c.relname = 'cells' and not t.tgisinternal;
  return next format('%s cell_states has four triggers and cells has none: %s and %s found',
                     case when trig_count = 4 and n = 0 then 'PASS' else 'FAIL' end, trig_count, n);

  -- 18. cells_assert_gs_stage_only must sort alphabetically before
  -- cells_set_audit_columns by name. Necessary for Postgres's same-timing
  -- firing order, but not sufficient alone -- a name comparison proves
  -- nothing about whether either trigger is actually BEFORE UPDATE. See 19.
  select string_agg(tgname, ',' order by tgname) into trig_order
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  where c.relname = 'cell_states' and not t.tgisinternal
    and t.tgname in ('cell_states_assert_gs_write', 'cell_states_set_audit_columns');
  return next format('%s cell_states_assert_gs_write sorts before cell_states_set_audit_columns: order is %s',
                     case when trig_order = 'cell_states_assert_gs_write,cell_states_set_audit_columns'
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
  where c.relname = 'cell_states' and not t.tgisinternal
    and t.tgname in ('cell_states_assert_gs_write', 'cell_states_set_audit_columns')
    and (t.tgtype & 1) = 1
    and (t.tgtype & 2) = 2
    and (t.tgtype & 4) > 0
    and (t.tgtype & 16) > 0
    and coalesce(array_length(t.tgattr::int2[], 1), 0) = 0
    and t.tgqual is null;
  return next format('%s cell_states_assert_gs_write and cell_states_set_audit_columns are both row-level BEFORE INSERT OR UPDATE with no column list or WHEN clause: %s of 2 qualify',
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
   where proname in ('assert_cell_state_consistent', 'set_cell_state_audit_columns')
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
  p uuid; d uuid; w uuid; s1 uuid; s2 uuid; cid uuid;
  sentinel timestamptz := timestamptz '2000-01-01 00:00:00+00';
  after_geometry timestamptz; after_stage timestamptz;
begin
  begin
    insert into projects (name, code) values ('VERIFY C','VERIFYC') returning id into p;
    insert into decks (project_id, seq, name, code, total_area_m2)
      values (p, 1, 'Deck', 'VC', 100) returning id into d;
    w := _verify_seed_work(p, d);
    insert into deck_stages (work_id, deck_id, seq, name, color, weight)
      values (w, d, 1, 'Coat 1', '#fadb14', 1) returning id into s1;
    insert into deck_stages (work_id, deck_id, seq, name, color, weight)
      values (w, d, 2, 'Coat 2', '#bfbfbf', 0) returning id into s2;
    insert into cells (deck_id, code, x, y, w, h, area_m2)
      values (d, 'R1C1', 0, 0, 1, 1, 100) returning id into cid;
    insert into cell_states (cell_id, work_id, deck_id, stage_id) values (cid, w, d, s1);

    -- Plant the sentinel. Since 0024 the stamper writes updated_at on the
    -- insert too, and the non-admin guard refuses a client-supplied updated_at
    -- (this session has no auth.uid(), so it IS the non-admin case) -- so the
    -- sentinel goes in with that one guard held. A script running as postgres
    -- is the one place that is legitimate.
    alter table cell_states disable trigger cell_states_assert_gs_write;
    update cell_states set updated_at = sentinel where cell_id = cid and work_id = w;
    alter table cell_states enable trigger cell_states_assert_gs_write;

    -- Stage unchanged, twice: a real UPDATE that changes no guarded column,
    -- which is the case a geometry-free re-save presents. The old trigger
    -- would have overwritten the sentinel with now().
    update cell_states set stage_id = s1 where cell_id = cid and work_id = w;
    update cell_states set stage_id = s1 where cell_id = cid and work_id = w;
    select updated_at into after_geometry from cell_states where cell_id = cid and work_id = w;

    -- Real progress: the stamp must land.
    update cell_states set stage_id = s2 where cell_id = cid and work_id = w;
    select updated_at into after_stage from cell_states where cell_id = cid and work_id = w;

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

-- Check 26 (migrations 0012 + 0018): (deck_id, seq) uniqueness is deferred, and a
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
-- contype = 'u' over exactly (deck_id, seq) is the constraint still being
-- there, and `deferred` changes only WHEN it is checked, never whether.
create or replace function _verify_stage_seq_deferrable() returns setof text language plpgsql as $$
declare
  p uuid; d uuid; w uuid;
  shape_ok boolean;
  swap_ok boolean := false;
  swap_err text := 'none';
  seqs text;
begin
  begin
    select c.contype = 'u' and c.condeferrable and c.condeferred
      into shape_ok
    from pg_constraint c
    where c.conrelid = 'public.deck_stages'::regclass
      and c.conname = 'deck_stages_work_id_deck_id_seq_key'
      -- attname is `name`, not `text`, and there is no name[] = text[] operator
      -- -- so the cast is load-bearing, not decoration.
      and (select array_agg(a.attname::text order by k.ord)
             from unnest(c.conkey) with ordinality as k(attnum, ord)
             join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum)
          = array['work_id', 'deck_id', 'seq'];

    insert into projects (name, code) values ('VERIFY D','VERIFYD') returning id into p;
    insert into decks (project_id, seq, name, code, total_area_m2)
      values (p, 1, 'Deck', 'VD3', 100) returning id into d;
    w := _verify_seed_work(p, d);
    insert into deck_stages (work_id, deck_id, seq, name, color, weight)
      values (w, d, 1, 'Coat 1', '#fadb14', 0.5);
    insert into deck_stages (work_id, deck_id, seq, name, color, weight)
      values (w, d, 2, 'Coat 2', '#bfbfbf', 0.5);

    begin
      -- One statement, both rows: after the first row is rewritten two rows hold
      -- seq 2, which an immediate constraint rejects even though the statement
      -- leaves the seqs unique.
      update deck_stages set seq = 3 - seq where deck_id = d;
      swap_ok := true;
    exception when others then
      swap_err := sqlerrm;
    end;

    select string_agg(seq::text || '=' || name, ', ' order by seq) into seqs
    from deck_stages where deck_id = d;

    delete from projects where id = p;

    return next format(
      '%s stage seq uniqueness over (work_id, deck_id, seq) is deferred and a reorder is accepted: shape %s, swap %s (%s), after swap: %s',
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
  p uuid; d uuid; w uuid;
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
    w := _verify_seed_work(p, d);
    insert into deck_stages (work_id, deck_id, seq, name, color, weight)
      values (w, d, 1, 'Coat 1', '#fadb14', 0.2) returning id into s1;
    insert into deck_stages (work_id, deck_id, seq, name, color, weight)
      values (w, d, 2, 'Coat 2', '#bfbfbf', 0.2) returning id into s2;
    insert into deck_stages (work_id, deck_id, seq, name, color, weight)
      values (w, d, 3, 'Coat 3', '#52c41a', 0.2) returning id into s3;
    insert into deck_stages (work_id, deck_id, seq, name, color, weight)
      values (w, d, 4, 'Coat 4', '#1677ff', 0.2) returning id into s4;
    insert into deck_stages (work_id, deck_id, seq, name, color, weight)
      values (w, d, 5, 'Coat 5', '#722ed1', 0.2) returning id into s5;

    -- One bay recorded at a stage that survives, one at the stage being
    -- removed. Without both, the check could pass while doing the wrong thing to
    -- either.
    insert into cells (deck_id, code, x, y, w, h, area_m2)
      values (d, 'R1C1', 0, 0, 0.5, 1, 250) returning id into survivor_cell;
    insert into cells (deck_id, code, x, y, w, h, area_m2)
      values (d, 'R1C2', 0.5, 0, 0.5, 1, 250) returning id into orphan_cell;
    insert into cell_states (cell_id, work_id, deck_id, stage_id) values (survivor_cell, w, d, s4);
    insert into cell_states (cell_id, work_id, deck_id, stage_id) values (orphan_cell, w, d, s2);

    begin
      -- The delete goes first: it frees seq 2 so the renumbering below has
      -- somewhere to land.
      delete from deck_stages where id = s2;

      -- The survivors, renumbered 1..4, in the statement shape PostgREST builds
      -- for an upsert keyed on the primary key.
      insert into deck_stages (id, work_id, deck_id, seq, name, color, weight) values
        (s1, w, d, 1, 'Coat 1', '#fadb14', 0.25),
        (s3, w, d, 2, 'Coat 3', '#52c41a', 0.25),
        (s4, w, d, 3, 'Coat 4', '#1677ff', 0.25),
        (s5, w, d, 4, 'Coat 5', '#722ed1', 0.25)
      on conflict (id) do update set
        seq = excluded.seq, name = excluded.name,
        color = excluded.color, weight = excluded.weight;
      write_ok := true;
    exception when others then
      write_err := sqlerrm;
    end;

    select string_agg(seq::text || '=' || name, ', ' order by seq) into seqs
    from deck_stages where deck_id = d;
    select stage_id into survivor_stage from cell_states where cell_id = survivor_cell and work_id = w;
    select seq into survivor_seq from deck_stages where id = survivor_stage;
    select stage_id into orphan_stage from cell_states where cell_id = orphan_cell and work_id = w;

    delete from projects where id = p;

    return next format(
      '%s a middle stage can be removed and the survivors renumbered: write %s (%s), after: %s, bay at a surviving stage still on Coat 4 (now seq %s): %s, bay at the removed stage nulled: %s',
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
  p uuid; d uuid; w uuid; s1 uuid; s2 uuid; cid uuid;
  sentinel timestamptz := timestamptz '2000-01-01 00:00:00+00';
  guard_msg text := 'only stage_id and note may be changed by a non-admin';
  note_msg  text := 'a note may only be changed together with the stage';
  at_rejected boolean := false; at_err text := 'accepted';
  by_rejected boolean := false; by_err text := 'accepted';
  stage_ok boolean := false; stage_err text := 'none';
  note_ok boolean := false; note_err text := 'none'; note_val text := '';
  note_logged text := '(no event)';
  note_alone_rejected boolean := false; note_alone_err text := 'accepted';
  stamped timestamptz;
begin
  begin
    insert into projects (name, code) values ('VERIFY F','VERIFYF') returning id into p;
    insert into decks (project_id, seq, name, code, total_area_m2)
      values (p, 1, 'Deck', 'VF', 100) returning id into d;
    w := _verify_seed_work(p, d);
    insert into deck_stages (work_id, deck_id, seq, name, color, weight)
      values (w, d, 1, 'Coat 1', '#fadb14', 1) returning id into s1;
    insert into deck_stages (work_id, deck_id, seq, name, color, weight)
      values (w, d, 2, 'Coat 2', '#bfbfbf', 0) returning id into s2;
    insert into cells (deck_id, code, x, y, w, h, area_m2)
      values (d, 'R1C1', 0, 0, 1, 1, 100) returning id into cid;
    insert into cell_states (cell_id, work_id, deck_id, stage_id) values (cid, w, d, s1);
    -- The sentinel, planted with the guard held -- see check 25 for why.
    alter table cell_states disable trigger cell_states_assert_gs_write;
    update cell_states set updated_at = sentinel where cell_id = cid and work_id = w;
    alter table cell_states enable trigger cell_states_assert_gs_write;

    -- A forged date, carried alongside a legitimate stage change.
    begin
      update cell_states set stage_id = s2, updated_at = timestamptz '2030-06-01 00:00:00+00'
       where cell_id = cid and work_id = w;
    exception when others then
      at_rejected := sqlerrm like '%' || guard_msg || '%';
      at_err := sqlerrm;
    end;

    -- A forged author.
    begin
      update cell_states set stage_id = s2, updated_by = gen_random_uuid() where cell_id = cid and work_id = w;
    exception when others then
      by_rejected := sqlerrm like '%' || guard_msg || '%';
      by_err := sqlerrm;
    end;

    -- A forged author carried alongside a legitimate NOTE.
    begin
      update cell_states set stage_id = s2, note = 'x', updated_by = gen_random_uuid()
       where cell_id = cid and work_id = w;
    exception when others then
      by_rejected := by_rejected and sqlerrm like '%' || guard_msg || '%';
      by_err := by_err || ' / with note: ' || sqlerrm;
    end;

    -- What a GS is actually for, which must still work -- and be stamped.
    begin
      update cell_states set stage_id = s2 where cell_id = cid and work_id = w;
      stage_ok := true;
    exception when others then
      stage_err := sqlerrm;
    end;
    select updated_at into stamped from cell_states where cell_id = cid and work_id = w;

    -- 0019: a note travelling with its stage change is accepted, and lands.
    begin
      update cell_states set stage_id = s1, note = 'Bề mặt còn ẩm' where cell_id = cid and work_id = w;
      note_ok := true;
    exception when others then
      note_err := sqlerrm;
    end;
    select note into note_val from cell_states where cell_id = cid and work_id = w;
    select e.note into note_logged
      from cell_events e where e.cell_id = cid order by e.at desc, e.id desc limit 1;

    -- 0019: a note on its own is refused.
    begin
      update cell_states set note = 'không đi kèm công đoạn' where cell_id = cid and work_id = w;
    exception when others then
      note_alone_rejected := sqlerrm like '%' || note_msg || '%';
      note_alone_err := sqlerrm;
    end;

    delete from projects where id = p;

    return next format(
      '%s non-admin cannot forge the audit columns: updated_at rejected %s (%s), updated_by rejected %s (%s), plain stage change accepted %s (%s) and stamped off the sentinel %s',
      case when at_rejected and by_rejected and stage_ok and stamped <> sentinel
           then 'PASS' else 'FAIL' end,
      at_rejected, at_err, by_rejected, by_err, stage_ok, stage_err,
      stamped <> sentinel);

    return next format(
      '%s non-admin may write a note with a stage change (%s, %s), it reaches cell_events (%s), and it is refused on its own (rejected %s: %s)',
      case when note_ok and note_val = 'Bề mặt còn ẩm'
                and note_logged = 'Bề mặt còn ẩm' and note_alone_rejected
           then 'PASS' else 'FAIL' end,
      note_ok, note_err, note_logged, note_alone_rejected, note_alone_err);
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
  p uuid; d uuid; w uuid; s_doomed uuid; s_live uuid; c_doomed uuid; c_live uuid;
  fn_ok boolean;
  before_count int; del_count int; del_name text; del_from uuid;
  live_before int; live_count int; live_name text;
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
    w := _verify_seed_work(p, d);
    insert into deck_stages (work_id, deck_id, seq, name, color, weight)
      values (w, d, 1, 'Doomed Coat', '#ff4d4f', 0.5) returning id into s_doomed;
    insert into deck_stages (work_id, deck_id, seq, name, color, weight)
      values (w, d, 2, 'Living Coat', '#52c41a', 0.5) returning id into s_live;
    insert into cells (deck_id, code, x, y, w, h, area_m2)
      values (d, 'R1C1', 0, 0, 1, 0.5, 60) returning id into c_doomed;
    insert into cells (deck_id, code, x, y, w, h, area_m2)
      values (d, 'R2C1', 0, 0.5, 1, 0.5, 40) returning id into c_live;
    -- Since 0024 creating a state at a stage logs the move from "not started",
    -- so the counts below are deltas against what the setup wrote.
    insert into cell_states (cell_id, work_id, deck_id, stage_id) values (c_doomed, w, d, s_doomed);
    insert into cell_states (cell_id, work_id, deck_id, stage_id) values (c_live, w, d, s_live);
    select count(*) into before_count from cell_events where cell_id = c_doomed;
    select count(*) into live_before from cell_events where cell_id = c_live;

    -- 29. the removal itself
    delete from deck_stages where id = s_doomed;

    select count(*) into del_count from cell_events where cell_id = c_doomed;
    select from_stage_name, from_stage_id into del_name, del_from
      from cell_events where cell_id = c_doomed order by id desc limit 1;

    return next format(
      '%s stage deletion is logged once, with the name: %s new row(s) (expected 1), from_stage_name %L (expected %L), from_stage_id retained %s, log_stage_deletion_on_cells definer+search_path %s',
      case when del_count - before_count = 1
             and del_name = 'Doomed Coat'
             and del_from = s_doomed
             and coalesce(fn_ok, false)
           then 'PASS' else 'FAIL' end,
      del_count - before_count, del_name, 'Doomed Coat', del_from = s_doomed,
      coalesce(fn_ok::text, 'function not found'));

    -- 30. negative control: an ordinary return to "not started", stage alive
    update cell_states set stage_id = null where cell_id = c_live and work_id = w;
    select count(*) into live_count from cell_events where cell_id = c_live;
    select from_stage_name into live_name
      from cell_events where cell_id = c_live order by id desc limit 1;

    return next format(
      '%s clearing a bay whose stage is still alive is still logged with its name: %s new row(s) (expected 1), from_stage_name %L (expected %L)',
      case when live_count - live_before = 1 and live_name = 'Living Coat' then 'PASS' else 'FAIL' end,
      live_count - live_before, live_name, 'Living Coat');

    -- 31. the project delete, with the BEFORE DELETE trigger inside it
    begin
      delete from projects where id = p;
      project_deleted := true;
    exception when others then
      project_err := sqlerrm;
    end;

    return next format(
      '%s a project delete still succeeds with deck_stages_log_deletion in place: %s (%s)',
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

-- Check 33 (migration 0016): cells logs its whole old row, so DELETE is
-- deliverable. Read straight from pg_class rather than from a DELETE probe: a
-- probe would have to be delivered over a websocket to prove anything, which
-- this file cannot do, whereas relreplident IS the switch Realtime's decoder
-- reads. 'f' = FULL, 'd' = DEFAULT (primary key only), 'n' = NOTHING,
-- 'i' = a specific index. Only 'f' carries deck_id in the old record, and
-- without deck_id Realtime cannot evaluate cells_member_read for the subscriber
-- and drops the event.
create or replace function _verify_cells_replica_identity() returns setof text language plpgsql as $$
declare
  ident "char";
begin
  select relreplident into ident from pg_class where oid = 'public.cells'::regclass;

  return next format(
    '%s public.cells has REPLICA IDENTITY FULL so DELETE is deliverable: relreplident = %L, need %L',
    case when ident = 'f' then 'PASS' else 'FAIL' end, ident, 'f');
end $$;

create or replace function _verify_report_notes() returns setof text language plpgsql as $$
declare
  fn_ok      boolean;
  anon_ok    boolean;
  auth_ok    boolean;
  cols       int;
  fk_ok      boolean;
  setfn_ok   boolean;
  setanon_ok boolean;
  upd_held   boolean;
begin
  -- 34. coworker_names: definer, pinned search_path, authenticated-only.
  select prosecdef and coalesce(array_to_string(proconfig, ',') like '%search_path=%', false)
    into fn_ok
  from pg_proc where proname = 'coworker_names' and pronamespace = 'public'::regnamespace;
  anon_ok := not has_function_privilege('anon', 'public.coworker_names()', 'execute');
  auth_ok := has_function_privilege('authenticated', 'public.coworker_names()', 'execute');
  return next format(
    '%s coworker_names() is definer with pinned search_path (%s), anon refused (%s), authenticated granted (%s)',
    case when coalesce(fn_ok, false) and anon_ok and auth_ok then 'PASS' else 'FAIL' end,
    coalesce(fn_ok, false), anon_ok, auth_ok);

  -- 35. 0023's columns, its named FK, set_report_note, and 0008's revoke intact.
  select count(*) into cols
  from information_schema.columns
  where table_schema = 'public' and table_name = 'cell_events'
    and column_name in ('report_note', 'report_hidden', 'report_edited_by', 'report_edited_at');
  fk_ok := exists (select 1 from pg_constraint where conname = 'cell_events_report_edited_by_fkey');
  select prosecdef and coalesce(array_to_string(proconfig, ',') like '%search_path=%', false)
    into setfn_ok
  from pg_proc where proname = 'set_report_note' and pronamespace = 'public'::regnamespace;
  setanon_ok := not has_function_privilege('anon', 'public.set_report_note(bigint, text, boolean)', 'execute');
  upd_held := has_table_privilege('authenticated', 'public.cell_events', 'update');
  return next format(
    '%s cell_events report notes: %s/4 columns, fk %s, set_report_note definer+pinned %s, anon refused %s, authenticated UPDATE on cell_events %s (need false)',
    case when cols = 4 and fk_ok and coalesce(setfn_ok, false) and setanon_ok and not upd_held
         then 'PASS' else 'FAIL' end,
    cols, fk_ok, coalesce(setfn_ok, false), setanon_ok, upd_held);
end $$;

create or replace function _verify_work_items() returns setof text language plpgsql as $$
declare
  published int; ident "char"; leftover int; pol_works int; pol_decks int; pol_states int; pinned int;
begin
  select count(*) into published
  from pg_publication_tables
  where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'cell_states';
  select relreplident into ident from pg_class where oid = 'public.cell_states'::regclass;
  return next format(
    '%s cell_states is published for realtime with REPLICA IDENTITY FULL: %s membership row(s) (need 1), relreplident %L (need f)',
    case when published = 1 and ident = 'f' then 'PASS' else 'FAIL' end, published, ident);

  select count(*) into leftover
  from information_schema.columns
  where table_schema = 'public' and table_name = 'cells'
    and column_name in ('stage_id', 'note', 'updated_at', 'updated_by');
  return next format(
    '%s cells is geometry only: %s of the four progress columns remain (need 0)',
    case when leftover = 0 then 'PASS' else 'FAIL' end, leftover);

  select count(*) into pol_works from pg_policies where schemaname = 'public' and tablename = 'works';
  select count(*) into pol_decks from pg_policies where schemaname = 'public' and tablename = 'work_decks';
  select count(*) into pol_states from pg_policies where schemaname = 'public' and tablename = 'cell_states';
  return next format(
    '%s work item policies: works %s (need 2), work_decks %s (need 2), cell_states %s (need 4: admin all, member read/insert/update)',
    case when pol_works = 2 and pol_decks = 2 and pol_states = 4 then 'PASS' else 'FAIL' end,
    pol_works, pol_decks, pol_states);

  select count(*) into pinned from pg_proc
   where pronamespace = 'public'::regnamespace
     and proname in ('assert_cell_state_consistent', 'assert_gs_state_write',
                     'set_cell_state_audit_columns', 'log_cell_state_change')
     and proconfig @> array['search_path=public, pg_temp'];
  return next format('%s the four cell_states trigger functions pin search_path: %s of 4',
                     case when pinned = 4 then 'PASS' else 'FAIL' end, pinned);
end $$;

create or replace function _verify_roles_and_work_members() returns setof text language plpgsql as $$
declare
  viewer_ok boolean; pol_wm int; definers int; narrowed int; gs_gated int;
begin
  -- 41. 0028: the role check admits 'viewer', work_members has its two
  -- policies, both predicate functions are definer with a pinned search_path,
  -- the six member read policies go through my_works(), and both member write
  -- policies on cell_states are gated on is_gs().
  select pg_get_constraintdef(oid) like '%viewer%' into viewer_ok
  from pg_constraint where conname = 'profiles_role_check' and conrelid = 'public.profiles'::regclass;
  select count(*) into pol_wm from pg_policies where schemaname = 'public' and tablename = 'work_members';
  select count(*) into definers from pg_proc
   where pronamespace = 'public'::regnamespace and proname in ('is_gs', 'my_works')
     and prosecdef and proconfig @> array['search_path=public, pg_temp'];
  select count(*) into narrowed from pg_policies
   where schemaname = 'public'
     and policyname in ('works_member_read', 'work_decks_member_read', 'deck_stages_member_read',
                        'cell_states_member_read', 'zones_member_read', 'cell_events_member_read')
     and qual like '%my_works()%';
  select count(*) into gs_gated from pg_policies
   where schemaname = 'public' and tablename = 'cell_states'
     and policyname in ('cell_states_member_insert', 'cell_states_member_update')
     and with_check like '%is_gs()%';
  return next format(
    '%s 0028 roles and work members: viewer allowed %s, work_members policies %s (need 2), definer functions %s (need 2), member reads via my_works %s (need 6), gs-gated writes %s (need 2)',
    case when coalesce(viewer_ok, false) and pol_wm = 2 and definers = 2 and narrowed = 6 and gs_gated = 2
         then 'PASS' else 'FAIL' end,
    coalesce(viewer_ok, false), pol_wm, definers, narrowed, gs_gated);

  -- 42. 0029: duplicate_deck is a definer with a pinned search_path, and anon
  -- holds no execute on it (the function checks is_admin() itself; the grant
  -- is the second wall).
  select count(*) into definers from pg_proc
   where pronamespace = 'public'::regnamespace and proname = 'duplicate_deck'
     and prosecdef and proconfig @> array['search_path=public, pg_temp']
     and not has_function_privilege('anon', oid, 'execute');
  return next format('%s 0029 duplicate_deck is a pinned definer that anon cannot execute: %s (need 1)',
                     case when definers = 1 then 'PASS' else 'FAIL' end, definers);
end $$;

create or replace function _verify_effort() returns setof text language plpgsql as $$
declare
  ev_cols int; st_cols int; fk_ok boolean; fn_ok boolean; anon_ok boolean; upd_held boolean; guard_ok boolean;
begin
  -- 43. 0030: the effort columns on both tables, the named FK for the backfill
  -- stamp, set_cell_event_effort as a pinned definer anon cannot execute,
  -- 0008's revoke still intact, and the GS guard carrying the effort rule.
  select count(*) into ev_cols from information_schema.columns
   where table_schema = 'public' and table_name = 'cell_events'
     and column_name in ('lead_name', 'painter_name', 'work_hours', 'waste_hours', 'waste_reason',
                         'effort_edited_by', 'effort_edited_at');
  select count(*) into st_cols from information_schema.columns
   where table_schema = 'public' and table_name = 'cell_states'
     and column_name in ('lead_name', 'painter_name', 'work_hours', 'waste_hours', 'waste_reason');
  fk_ok := exists (select 1 from pg_constraint where conname = 'cell_events_effort_edited_by_fkey');
  select prosecdef and proconfig @> array['search_path=public, pg_temp'] into fn_ok
   from pg_proc where proname = 'set_cell_event_effort' and pronamespace = 'public'::regnamespace;
  anon_ok := not has_function_privilege('anon', 'public.set_cell_event_effort(bigint, text, text, numeric, numeric, text)', 'execute');
  upd_held := has_table_privilege('authenticated', 'cell_events', 'update');
  select prosrc like '%effort may only be changed together with the stage%' into guard_ok
   from pg_proc where proname = 'assert_gs_state_write' and pronamespace = 'public'::regnamespace;
  return next format(
    '%s 0030 effort: event columns %s (need 7), state columns %s (need 5), stamp FK %s, pinned definer %s, anon refused %s, authenticated UPDATE on cell_events %s (need false), guard carries the effort rule %s',
    case when ev_cols = 7 and st_cols = 5 and fk_ok and coalesce(fn_ok, false) and anon_ok and not upd_held and coalesce(guard_ok, false)
         then 'PASS' else 'FAIL' end,
    ev_cols, st_cols, fk_ok, coalesce(fn_ok, false), anon_ok, upd_held, coalesce(guard_ok, false));
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
select * from _verify_realtime_publication()
union all
select * from _verify_cells_replica_identity()
union all
select * from _verify_report_notes()
union all
select * from _verify_work_items()
union all
select * from _verify_roles_and_work_members()
union all
select * from _verify_effort();

drop function _verify_triggers();
drop function _verify_rls();
drop function _verify_audit_columns();
drop function _verify_stage_seq_deferrable();
drop function _verify_stage_removal();
drop function _verify_gs_audit_guard();
drop function _verify_stage_deletion_audit();
drop function _verify_realtime_publication();
drop function _verify_cells_replica_identity();
drop function _verify_report_notes();
drop function _verify_work_items();
drop function _verify_roles_and_work_members();
drop function _verify_seed_work(uuid, uuid);
