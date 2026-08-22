-- Re-defined from 0002 to add the existence guard. See the migration comment
-- for why the naive version cannot survive a project delete.
create or replace function log_cell_stage_change()
returns trigger
language plpgsql
as $$
begin
  -- The existence check is load-bearing, not defensive noise. Deleting a
  -- project sets cells.stage_id null via one cascade while another cascade
  -- deletes the same cells; this AFTER trigger then fires for a row that is
  -- already gone, and logging it would violate cell_events_cell_id_fkey.
  -- An audit row for a deleted cell has no readers anyway.
  if new.stage_id is distinct from old.stage_id
     and exists (select 1 from cells where id = new.id) then
    insert into cell_events (cell_id, from_stage_id, to_stage_id, by)
    values (new.id, old.stage_id, new.stage_id, auth.uid());
  end if;
  return null;
end;
$$;
