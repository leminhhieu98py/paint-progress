-- Schema verification for paint-progress.
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
--
-- How to run:
--   nvm use 22
--   npx supabase db query --linked -f supabase/verify_schema.sql
--
-- Every returned row must begin with PASS (9 rows in total, one per
-- numbered check above). A row beginning with FAIL means a regression in
-- the trigger/FK behaviour set up across migrations 0001-0005; re-read
-- those migrations' comments before changing this file.
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

select * from _verify_triggers();
drop function _verify_triggers();
