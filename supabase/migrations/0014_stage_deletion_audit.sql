-- The one audit row that documents a stage's own removal was the one row that
-- lost the stage's name.
--
-- cells.stage_id references project_stages ON DELETE SET NULL (0001). That
-- referential action fires AFTER the project_stages row is gone, so
-- log_cell_stage_change's `(select name from project_stages where id =
-- old.stage_id)` resolves to NULL -- and 0005 deliberately dropped the foreign
-- key on cell_events.from_stage_id, so nothing can recover the name later. The
-- id survives for correlation and points at nothing. Verified against the live
-- database inside begin/rollback before this migration was written.
--
-- Every event recorded WHILE the stage existed keeps its name; only the removal
-- event lost it, which is precisely the case the durable snapshot was added for
-- (0005). verify_schema's existing delete-durability check reads back the event
-- created when the cell was SET to that stage, which is a different row, so it
-- stayed green throughout.
--
-- The fix has to write the name before the row disappears, which means a BEFORE
-- DELETE trigger on project_stages -- the last moment `old.name` exists.
create or replace function log_stage_deletion_on_cells()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- security definer for the same reason log_cell_stage_change is (0007): RLS is
  -- enabled on cell_events with no INSERT policy, and 0008 revoked INSERT on it
  -- from anon and authenticated, so an invoker function here would make every
  -- stage deletion fail with 42501.
  --
  -- The `exists (select 1 from projects ...)` guard is the 0004 lesson, arriving
  -- through a new door. Deleting a PROJECT fans out into projects ->
  -- project_stages (which fires this trigger) racing projects -> decks -> cells
  -- CASCADE at a different depth. Without the guard this trigger would insert
  -- cell_events rows referencing cells another branch of the same statement is
  -- deleting -- the exact shape that aborted the project delete twice in Phase
  -- 1. When the project row is already gone, the cells are going with it and an
  -- audit row for a deleted cell has no readers, so the correct answer is to
  -- write nothing. (0004's own guard observes the same thing from the other
  -- side: a cascade-deleted parent IS visible to a trigger running inside the
  -- same statement.)
  --
  -- INSERT ... SELECT rather than a loop: the select only ever sees cells that
  -- exist right now, so a cell already removed by a deeper cascade contributes
  -- no row and cannot violate cell_events_cell_id_fkey.
  insert into cell_events (cell_id, from_stage_id, to_stage_id,
                           from_stage_name, to_stage_name, by)
  select c.id, old.id, null, old.name, null, auth.uid()
  from cells c
  where c.stage_id = old.id
    and exists (select 1 from projects p where p.id = old.project_id);

  return old;
end;
$$;

-- BEFORE DELETE, row level. It must be BEFORE: in an AFTER DELETE trigger the
-- referential action has already run and `old.name` is the only thing left --
-- which is enough here, but the row's cells have already been nulled by then, so
-- `where c.stage_id = old.id` would match nothing and the trigger would write
-- no rows at all. Do not "tidy" this to AFTER.
create trigger project_stages_log_deletion
  before delete on project_stages
  for each row
  execute function log_stage_deletion_on_cells();

-- And the other half: the cascade must not log the same event a second time.
--
-- After the trigger above, deleting a stage produces its audit row, and THEN the
-- ON DELETE SET NULL fires an UPDATE on the same cell, which reaches
-- log_cell_stage_change and would append a second, nameless row for the same
-- physical change. Two rows for one event is worse than one nameless row: the
-- per-cell date labels on the drawing (spec 3.5 / 9) read the latest event, and
-- the latest would be the empty one.
--
-- The skip is precise rather than a blanket "ignore nulls". A cell CAN be
-- legitimately returned to "not started" -- the GS modal offers it -- and that
-- must still be logged with the stage's name. The only way old.stage_id can be
-- absent from project_stages at this point is the SET NULL referential action
-- from that stage's own deletion: cells_assert_stage_project (0002/0009) rejects
-- any update that puts a nonexistent stage on a cell, so a dangling
-- cells.stage_id cannot be reached any other way.
--
-- Everything else in this function is carried over unchanged and is load
-- bearing: security definer + pinned search_path (0007, asserted by
-- verify_schema check 16), the `exists (select 1 from cells ...)` guard (0004),
-- `is distinct from` rather than `<>` because stage_id is nullable, and the two
-- name snapshots (0005).
create or replace function log_cell_stage_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.stage_id is not distinct from old.stage_id then
    return null;
  end if;

  -- 0004: this AFTER trigger can fire for a cell the same statement has already
  -- deleted, and cell_events_cell_id_fkey would reject the row.
  if not exists (select 1 from cells where id = new.id) then
    return null;
  end if;

  -- 0014: the SET NULL cascade from the stage's own deletion.
  -- project_stages_log_deletion has already logged it, with the name.
  if new.stage_id is null
     and old.stage_id is not null
     and not exists (select 1 from project_stages where id = old.stage_id) then
    return null;
  end if;

  insert into cell_events (cell_id, from_stage_id, to_stage_id,
                           from_stage_name, to_stage_name, by)
  values (new.id, old.stage_id, new.stage_id,
          (select name from project_stages where id = old.stage_id),
          (select name from project_stages where id = new.stage_id),
          auth.uid());
  return null;
end;
$$;
