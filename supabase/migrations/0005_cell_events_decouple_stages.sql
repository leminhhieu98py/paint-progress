alter table cell_events drop constraint cell_events_from_stage_id_fkey;
alter table cell_events drop constraint cell_events_to_stage_id_fkey;

-- The stage ids stay as plain uuids for correlation, but nothing enforces them
-- now. The names are the durable record, and the drawing's per-cell date labels
-- need the name anyway, so this also removes a join from the read path.
alter table cell_events
  add column from_stage_name text,
  add column to_stage_name   text;

update cell_events e set
  from_stage_name = (select name from project_stages where id = e.from_stage_id),
  to_stage_name   = (select name from project_stages where id = e.to_stage_id)
where e.from_stage_name is null and e.to_stage_name is null;

create or replace function log_cell_stage_change()
returns trigger
language plpgsql
as $$
begin
  -- The existence check stays. 0004 added it because this AFTER trigger can
  -- fire for a cell the same statement has already deleted.
  if new.stage_id is distinct from old.stage_id
     and exists (select 1 from cells where id = new.id) then
    insert into cell_events (cell_id, from_stage_id, to_stage_id,
                             from_stage_name, to_stage_name, by)
    values (new.id, old.stage_id, new.stage_id,
            (select name from project_stages where id = old.stage_id),
            (select name from project_stages where id = new.stage_id),
            auth.uid());
  end if;
  return null;
end;
$$;
