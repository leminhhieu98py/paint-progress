-- Schema verification for paint-progress.
--
-- What this checks:
--   1. A cell cannot be assigned a stage from a different project
--      (cells_assert_stage_project).
--   2. A cell can be assigned a stage from its own project, and doing so
--      logs exactly one cell_events row (cells_log_stage_change).
--   3. cells_set_audit_columns stamps updated_at on every update.
--   4. Re-setting the same stage is a no-op: it must not log a second event.
--   5. The cell_events name snapshot (from 0005) is durable: renaming or
--      deleting the stage afterwards must NOT change what a recorded event
--      says happened, because cell_events no longer holds a foreign key to
--      project_stages. This is the entire reason 0005 exists, so it is
--      tested directly rather than just checking the columns are populated.
--   6. A project (with its decks, stages, cells and cell_events) can be
--      deleted cleanly — this is the regression the fix chain in 0003/0004/
--      0005 exists to guarantee; earlier attempts aborted here twice.
--
-- How to run:
--   nvm use 22
--   npx supabase db query --linked -f supabase/verify_schema.sql
--
-- Every returned row must begin with PASS. A row beginning with FAIL means
-- a regression in the trigger/FK behaviour set up across migrations
-- 0001-0005; re-read those migrations' comments before changing this file.
--
-- WARNING: this script INSERTS and then DELETES test rows (projects named
-- 'VERIFY A' / 'VERIFY B' and everything cascading from them). It is meant
-- to run against a disposable or pre-production database only. Never run
-- it against a database holding real project data.

create or replace function _verify_triggers() returns setof text language plpgsql as $$
declare
  p1 uuid; p2 uuid; d1 uuid; s1 uuid; s2 uuid; c1 uuid;
  ev_count int; upd timestamptz; ev1_id bigint; nm text; tsid uuid;
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

  -- capture the event row check 2 created; the durability checks below read
  -- this exact row back after mutating/removing its stage.
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

  -- 6. durability, part one: renaming the stage must not rewrite history.
  -- The reason 0005 exists: history must not be rewritten when configuration
  -- changes. Rename the stage, then confirm the already-recorded event still
  -- carries the old name. A live join would fail this.
  update project_stages set name = 'Coat 3 RENAMED' where id = s1;
  select to_stage_name into nm from cell_events where id = ev1_id;
  return next format('%s snapshot survives a rename: recorded %L, stage is now %L',
                     case when nm = 'Coat 1' then 'PASS' else 'FAIL' end,
                     nm,
                     (select name from project_stages where id = s1));

  -- 7. durability, part two: deleting the stage outright must not delete or
  -- blank the recorded event. cell_events no longer holds a foreign key to
  -- project_stages (0005), so to_stage_id is left pointing at a row that no
  -- longer exists ("dangling") instead of being nulled or cascading away.
  delete from project_stages where id = s1;
  select to_stage_name, to_stage_id into nm, tsid from cell_events where id = ev1_id;
  return next format('%s snapshot survives stage deletion: recorded %L, to_stage_id %s',
                     case when nm = 'Coat 1'
                           and tsid = s1
                           and not exists (select 1 from project_stages where id = tsid)
                          then 'PASS' else 'FAIL' end,
                     nm,
                     case when exists (select 1 from project_stages where id = tsid)
                          then 'still exists (unexpected)' else 'dangling, as expected' end);

  -- 8. cleanup: deleting the projects (and everything cascading from them)
  -- must succeed. This is the regression the whole 0003/0004/0005 chain
  -- exists to fix; wrapped like checks 1-2 so a regression here reports a
  -- readable FAIL row instead of aborting the function with zero rows.
  begin
    delete from projects where id in (p1, p2);
    return next 'PASS cleanup: done';
  exception when others then
    return next 'FAIL cleanup: ' || sqlerrm;
  end;
end $$;

select * from _verify_triggers();
drop function _verify_triggers();
