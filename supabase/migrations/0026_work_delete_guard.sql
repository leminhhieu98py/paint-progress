-- Deleting a work that has bays recorded against it failed with
--   insert or update on table "cell_events" violates foreign key constraint
--   "cell_events_work_id_fkey"
-- found on dev the first time a work with states was removed.
--
-- The cascade runs works -> deck_stages -> (this trigger) while the work row is
-- already gone, and the trigger writes a "back to not started" event carrying
-- cs.work_id -- a key that no longer exists. 0024 already skips the log when
-- the DECK is going (its bays are going with it); the work going is the same
-- situation one level up: its states are being removed by the same cascade, and
-- a "back to not started" event for a work that no longer exists is not a
-- move anybody made -- it would only break the FK, or with work_id null read
-- as a reset the foreman never did. So: log a stage deletion only while both
-- the deck and the work still exist. The events the work DID accumulate stay,
-- work_id set null by 0024's FK and work_name still on them: history survives
-- the work, the way a deleted stage's name survives in from_stage_name.
-- Nothing else in the function changes.
create or replace function log_stage_deletion_on_cells()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into cell_events (cell_id, work_id, work_name,
                           from_stage_id, to_stage_id, from_stage_name, to_stage_name, by)
  select cs.cell_id, cs.work_id, (select name from works where id = cs.work_id),
         old.id, null, old.name, null, auth.uid()
  from cell_states cs
  where cs.stage_id = old.id
    and exists (select 1 from decks d where d.id = old.deck_id)
    and exists (select 1 from works w where w.id = old.work_id);
  return old;
end;
$$;
