-- Purge one GS / viewer account and everything it wrote.
--
-- WHEN TO USE THIS. Almost never. The product rule is USR-R5: accounts are
-- locked or hidden, never deleted, because cell_events.by and
-- cell_states.updated_by are how a note or a history line names its author.
-- This script exists for exactly one case: a TEST account that ticked bays on
-- a real project, whose ticks must disappear so the project percentage drops
-- by exactly what it clicked (owner decision, 2026-09-04). Do not run it on
-- anyone who ever recorded real progress.
--
-- HOW TO RUN (the owner, against the project of their choice):
--   1. Edit v_username below. Leave v_confirm = false.
--   2. npx supabase db query --linked -f supabase/scripts/purge_user.sql
--      -> the run ENDS IN AN ERROR on purpose: "DRY RUN (nothing changed)"
--         followed by one line per table with the row count it would delete.
--         Read them. If a count surprises you, stop here.
--   3. Set v_confirm := true and run the same command again. The last result
--      set lists what was deleted.
--   4. Run it a third time if you like: it reports "nothing to purge".
--
-- TOLERANT OF HALF-DELETED ACCOUNTS. The owner removed some rows by hand
-- before this script existed. So the account is looked up by profile username
-- AND by auth email, every statement is a filtered DELETE that is happy to hit
-- zero rows, and a missing profile or auth row is reported, not raised.
--
-- WHY A HAND DELETE FAILED. `delete from profiles where ...` is refused by the
-- database while the account still has cell_states rows: the FK's ON DELETE
-- SET NULL runs an UPDATE of updated_by, and assert_gs_state_write (0024)
-- refuses any non-admin change to a column other than stage_id/note -- and a
-- `db query` session has no auth.uid(), so it counts as non-admin. Rehearsed
-- on dev 2026-09-04: the error is "only stage_id and note may be changed by a
-- non-admin". This script deletes the cell_states rows first, so the profile
-- delete has nothing left to null and goes through. If a profile was somehow
-- removed anyway, the auth-email lookup below still finds the account.
--
-- ORDER IS LOAD-BEARING. cell_events.by, cell_states.updated_by,
-- credential_access_log.target_user_id / admin_id are all ON DELETE SET NULL
-- (0003): deleting the profile FIRST would null those columns and the rows
-- would become unattributable instead of gone. So the dependents go first, the
-- profile second, the auth user last (auth.users -> profiles is ON DELETE
-- CASCADE, which also covers gs_credentials, project_members, work_members).
--
-- cell_states rows are DELETED, not reset to stage null. A deleted row is
-- exactly "chưa bắt đầu" in the domain (summariseDeck treats a missing state
-- as stage 0), and an UPDATE would fire cell_states_log_stage_change, which
-- writes a new cell_events row authored by whoever runs this -- history about
-- a purge, on a bay whose history is being removed. No trigger fires on the
-- DELETE (0024 declares insert/update triggers only).
--
-- Everything runs in ONE DO block, so a failure anywhere leaves nothing
-- half-done; `supabase db query -f` only shows the last statement's result
-- set, which is why the dry run reports through the exception message.

create temp table if not exists _purge_report (step text, affected int);
truncate _purge_report;

do $$
declare
  v_username text    := 'test';        -- <<< EDIT: profiles.username of the account to purge
  v_confirm  boolean := false;         -- <<< EDIT: true to actually delete
  v_suffix   text    := '@app.local';  -- AUTH_EMAIL_SUFFIX in the Edge Function
  uid  uuid;
  n    int;
  report text := '';
  r record;
begin
  select id into uid from profiles where username = v_username;
  if uid is null then
    select id into uid from auth.users where email = v_username || v_suffix;
    if uid is not null then
      insert into _purge_report values ('profile already gone; matched auth.users by email', 0);
    end if;
  end if;
  if uid is null then
    insert into _purge_report values (format('nothing to purge: no profile and no auth user named %L', v_username), 0);
    return;
  end if;
  insert into _purge_report values (format('account id %s', uid), 0);

  -- 1. The account's own history and ticks. These are what move the
  --    percentage: after this, every bay it touched reads not started for
  --    that work, unless someone else has since written the row (in which
  --    case updated_by is that someone and the row is untouched).
  delete from cell_events where "by" = uid;
  get diagnostics n = row_count;
  insert into _purge_report values ('cell_events written by the account', n);

  delete from cell_states where updated_by = uid;
  get diagnostics n = row_count;
  insert into _purge_report values ('cell_states last written by the account (bays back to not started)', n);

  -- 2. Other columns that would otherwise be nulled by the FK and left behind.
  update cell_events set report_edited_by = null where report_edited_by = uid;
  get diagnostics n = row_count;
  insert into _purge_report values ('cell_events report edits by the account (author cleared)', n);

  delete from credential_access_log where target_user_id = uid or admin_id = uid;
  get diagnostics n = row_count;
  insert into _purge_report values ('credential_access_log rows about the account', n);

  -- 3. Rows the auth cascade would remove anyway; deleted explicitly so the
  --    report shows them and so an orphaned profile (no auth row) is cleaned.
  delete from gs_credentials where user_id = uid;
  get diagnostics n = row_count;
  insert into _purge_report values ('gs_credentials', n);

  delete from work_members where user_id = uid;
  get diagnostics n = row_count;
  insert into _purge_report values ('work_members', n);

  delete from project_members where user_id = uid;
  get diagnostics n = row_count;
  insert into _purge_report values ('project_members', n);

  -- 4. The account itself.
  delete from profiles where id = uid;
  get diagnostics n = row_count;
  insert into _purge_report values ('profiles', n);

  delete from auth.users where id = uid;
  get diagnostics n = row_count;
  insert into _purge_report values ('auth.users', n);

  if not v_confirm then
    for r in select * from _purge_report loop
      report := report || E'\n  ' || r.step || ': ' || r.affected;
    end loop;
    raise exception 'DRY RUN (nothing changed). Set v_confirm := true to delete:%', report;
  end if;
end $$;

select * from _purge_report;
