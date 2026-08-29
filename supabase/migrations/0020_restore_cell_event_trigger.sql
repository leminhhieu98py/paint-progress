-- Repairs log_cell_stage_change, which 0019 broke.
--
-- 0019 needed one line added to this function -- carry `new.note` into the
-- event -- and wrote the whole body out to get it. It took that body from
-- 0005, the migration that first denormalised the stage names onto the event.
-- Everything the function had gained SINCE 0005 was silently reverted with it:
--
--   * 0007 made it `security definer` with a pinned search_path, because the
--     audit writer has to run as the system: with RLS on cell_events, a GS
--     session inserting its own audit row is refused.
--   * 0014 taught it to stay silent when a cell's stage_id goes null only
--     because the stage row it pointed at was deleted. Without that guard a
--     stage deletion writes one bogus "moved to not started" event per cell,
--     attributed to whoever happened to be signed in.
--   * 0018 renamed project_stages to deck_stages and updated the two lookups
--     here to match.
--
-- The third one is what surfaced it: every stage change on the hosted project
-- failed with `relation "project_stages" does not exist` from the moment 0019
-- landed. That is the foreman's only write, so the field app was down.
--
-- This restores 0018's definition exactly, with 0019's `note` added to the
-- INSERT and nothing else changed. Compare it against 0018 line by line rather
-- than trusting this comment.
--
-- The lesson is in the shape of the bug, not in this one function: a
-- `create or replace function` REPLACES, so it must start from the CURRENT
-- definition -- `\sf log_cell_stage_change`, or the newest migration that
-- names it -- never from whichever older migration is easiest to find.
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

  -- 0004: this AFTER trigger can fire for a cell the same statement has
  -- already deleted.
  if not exists (select 1 from cells where id = new.id) then
    return null;
  end if;

  -- 0014: the cell went to null because its stage row was deleted, not because
  -- anybody moved it back.
  if new.stage_id is null
     and old.stage_id is not null
     and not exists (select 1 from deck_stages where id = old.stage_id) then
    return null;
  end if;

  insert into cell_events (cell_id, from_stage_id, to_stage_id,
                           from_stage_name, to_stage_name, note, by)
  values (new.id, old.stage_id, new.stage_id,
          (select name from deck_stages where id = old.stage_id),
          (select name from deck_stages where id = new.stage_id),
          new.note,
          auth.uid());
  return null;
end;
$$;
