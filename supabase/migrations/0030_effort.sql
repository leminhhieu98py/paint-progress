-- Effort per bay update (Feedback Rv2, item 11): who led, who painted, how
-- many man-hours went in and how many were lost, recorded with each stage
-- change. The Mhr/m² figures on the report and the dashboard are derived from
-- these rows and from nothing else.
--
-- Same shape as 0019's note: the tablet writes the effort on cell_states in the
-- ONE statement that moves the stage, the audit trigger copies it onto the
-- event, and the history is cell_events. cell_states keeps only the transport
-- copy -- nothing reads it back, and the admin's backfill below does not write
-- it. Optional throughout (Linh, 2026-09-05: "nếu có"): null hours mean "not
-- recorded", which is also what every row written before this migration says.
alter table cell_states
  add column lead_name     text not null default '',
  add column painter_name  text not null default '',
  add column work_hours    numeric(8,2) check (work_hours >= 0),
  add column waste_hours   numeric(8,2) check (waste_hours >= 0),
  add column waste_reason  text not null default '';

alter table cell_events
  add column lead_name        text,
  add column painter_name     text,
  add column work_hours       numeric(8,2) check (work_hours >= 0),
  add column waste_hours      numeric(8,2) check (waste_hours >= 0),
  add column waste_reason     text,
  add column effort_edited_by uuid,
  add column effort_edited_at timestamptz;

-- Named, because progressApi embeds `profiles!cell_events_effort_edited_by_fkey`
-- beside the two joins 0001 and 0023 already put on this table. On delete set
-- null, like every other actor reference here (0003).
alter table cell_events
  add constraint cell_events_effort_edited_by_fkey
    foreign key (effort_edited_by) references profiles on delete set null;

comment on column cell_events.lead_name is
  'Nhóm trưởng as the GS typed it for this update. Null on rows before 0030; empty when not given.';
comment on column cell_events.painter_name is
  'Thợ chính as the GS typed it for this update. Null on rows before 0030; empty when not given.';
comment on column cell_events.work_hours is
  'Man-hours spent on this bay in this update (Mhr). Null: not recorded (every row before 0030).';
comment on column cell_events.waste_hours is
  'Man-hours lost on this bay in this update. Never enters Mhr/m².';
comment on column cell_events.waste_reason is
  'Why the hours were lost. Empty when waste_hours is null or zero.';
comment on column cell_events.effort_edited_by is
  'Admin who last backfilled the effort columns through set_cell_event_effort. Null: as the GS wrote it.';

-- 0025's guard, with one rule added after the note rule: effort moves only
-- together with the stage, for the same reason the note does -- the trigger
-- below writes an event only on a stage change, so an effort-only update would
-- change cell_states with nothing in cell_events to say who recorded it.
-- Every message that was raised before is raised unchanged;
-- verify_schema.sql matches on them.
create or replace function assert_gs_state_write()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if is_admin() then
    return new;
  end if;
  -- INSERT: nothing to guard here. The stamper overwrites the audit columns
  -- unconditionally, and the note/effort rule is checked after the insert (see
  -- log_cell_state_change) because an upsert reaches this branch even when it
  -- is about to become an update.
  if tg_op = 'INSERT' then
    return new;
  end if;
  if new.cell_id    is distinct from old.cell_id
     or new.work_id    is distinct from old.work_id
     or new.deck_id    is distinct from old.deck_id
     or new.updated_at is distinct from old.updated_at
     or new.updated_by is distinct from old.updated_by
  then
    raise exception 'only stage_id and note may be changed by a non-admin';
  end if;
  if new.note is distinct from old.note
     and new.stage_id is not distinct from old.stage_id
  then
    raise exception 'a note may only be changed together with the stage';
  end if;
  if (new.lead_name       is distinct from old.lead_name
      or new.painter_name is distinct from old.painter_name
      or new.work_hours   is distinct from old.work_hours
      or new.waste_hours  is distinct from old.waste_hours
      or new.waste_reason is distinct from old.waste_reason)
     and new.stage_id is not distinct from old.stage_id
  then
    raise exception 'effort may only be changed together with the stage';
  end if;
  return new;
end;
$$;

-- 0025's audit writer, carrying the effort onto the event. Body unchanged
-- apart from `has_effort` and the five extra columns in the insert.
create or replace function log_cell_state_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  old_stage  uuid;
  has_effort boolean;
begin
  has_effort := new.lead_name <> '' or new.painter_name <> ''
             or new.work_hours is not null or new.waste_hours is not null
             or new.waste_reason <> '';
  -- 0019's rule for a row that was genuinely inserted, extended to effort: a
  -- note or hours on a bay that has no stage would be a record with no event
  -- naming who wrote it.
  if tg_op = 'INSERT' and new.stage_id is null and (new.note <> '' or has_effort) and not is_admin() then
    raise exception 'a note or effort may only be recorded together with the stage';
  end if;
  old_stage := case when tg_op = 'INSERT' then null else old.stage_id end;
  if new.stage_id is not distinct from old_stage then
    return null;
  end if;
  -- 0004: this AFTER trigger can fire for a cell the same statement deleted.
  if not exists (select 1 from cells where id = new.cell_id) then
    return null;
  end if;
  -- 0014: the stage went to null because its row was deleted, not because
  -- anybody moved the bay back.
  if new.stage_id is null
     and old_stage is not null
     and not exists (select 1 from deck_stages where id = old_stage) then
    return null;
  end if;
  insert into cell_events (cell_id, work_id, work_name,
                           from_stage_id, to_stage_id, from_stage_name, to_stage_name,
                           note, by,
                           lead_name, painter_name, work_hours, waste_hours, waste_reason)
  values (new.cell_id, new.work_id, (select name from works where id = new.work_id),
          old_stage, new.stage_id,
          (select name from deck_stages where id = old_stage),
          (select name from deck_stages where id = new.stage_id),
          new.note, auth.uid(),
          new.lead_name, new.painter_name, new.work_hours, new.waste_hours, new.waste_reason);
  return null;
end;
$$;

-- Admin backfill (Linh, 2026-09-05: "Các bản ghi cũ không có giờ công. Admin
-- có thể nhập bổ sung hoặc bỏ trống"). The second client-reachable write onto
-- cell_events after 0023's set_report_note, built the same way: a definer that
-- checks is_admin() itself, so the table stays append-only-by-system and
-- 0008's revoke holds. It touches the effort columns and its own stamp only --
-- never note, at, by or the report columns.
create or replace function set_cell_event_effort(
  p_event_id     bigint,
  p_lead_name    text,
  p_painter_name text,
  p_work_hours   numeric,
  p_waste_hours  numeric,
  p_waste_reason text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not is_admin() then
    raise exception 'set_cell_event_effort: admin only' using errcode = '42501';
  end if;

  update cell_events
  set lead_name        = coalesce(btrim(p_lead_name), ''),
      painter_name     = coalesce(btrim(p_painter_name), ''),
      work_hours       = p_work_hours,
      waste_hours      = p_waste_hours,
      waste_reason     = coalesce(btrim(p_waste_reason), ''),
      effort_edited_by = auth.uid(),
      effort_edited_at = now()
  where id = p_event_id;

  if not found then
    raise exception 'set_cell_event_effort: no cell_events row with id %', p_event_id;
  end if;
end;
$$;

revoke all on function set_cell_event_effort(bigint, text, text, numeric, numeric, text) from public, anon;
grant execute on function set_cell_event_effort(bigint, text, text, numeric, numeric, text) to authenticated;

do $$
declare
  n int;
begin
  select count(*) into n
  from information_schema.columns
  where table_schema = 'public' and table_name = 'cell_events'
    and column_name in ('lead_name', 'painter_name', 'work_hours', 'waste_hours', 'waste_reason',
                        'effort_edited_by', 'effort_edited_at');
  if n <> 7 then
    raise exception 'cell_events effort columns: % of 7 present', n;
  end if;
  select count(*) into n
  from information_schema.columns
  where table_schema = 'public' and table_name = 'cell_states'
    and column_name in ('lead_name', 'painter_name', 'work_hours', 'waste_hours', 'waste_reason');
  if n <> 5 then
    raise exception 'cell_states effort columns: % of 5 present', n;
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'cell_events_effort_edited_by_fkey'
  ) then
    raise exception 'cell_events_effort_edited_by_fkey is missing';
  end if;
  if not exists (
    select 1 from pg_proc where proname = 'set_cell_event_effort' and prosecdef
  ) then
    raise exception 'set_cell_event_effort is missing or is not security definer';
  end if;
  if has_function_privilege('anon', 'set_cell_event_effort(bigint, text, text, numeric, numeric, text)', 'execute') then
    raise exception 'anon can execute set_cell_event_effort';
  end if;
  -- 0008's revoke must still hold: this function and set_report_note are the
  -- only client-reachable writes onto the table.
  if has_table_privilege('authenticated', 'cell_events', 'update') then
    raise exception 'authenticated holds UPDATE on cell_events';
  end if;
end $$;
