-- Two corrections to 0024, found by running it against the dev project.
--
-- 1. `work_decks.weight` was numeric(6,5). The backfill writes each deck's m²
--    share there, and five decimals moved MADUAN_OTIS from 0.2508268761 to
--    0.2508264473 -- invisible at two decimals, but 0024 promised every
--    existing percentage would stay where it was, and "to the last digit" is
--    the standard this number is held to. Ten decimals leaves the rounding
--    below anything the app prints or the report stores.
--
-- 2. `assert_gs_state_write` refused, on INSERT, a row with no stage and a
--    note -- 0019's rule, moved over. But the foreman's write is an UPSERT,
--    and Postgres fires BEFORE INSERT triggers on the proposed row BEFORE it
--    discovers the conflict, so a legitimate "back to not started, with a
--    note" on an existing row was refused before the UPDATE half ever ran
--    (tests/rls.integration.test.ts caught it). The rule still holds -- a
--    note with nothing in cell_events naming who wrote it is the hole 0019
--    closed -- but it belongs in the AFTER INSERT trigger, which only fires
--    for a row that was actually inserted.

-- ---------------------------------------------------------------------------
-- 1. Deck weights to ten decimals, and the backfilled shares recomputed
-- ---------------------------------------------------------------------------
alter table work_decks alter column weight type numeric(12,10);

-- Only the rows 0024 wrote and nobody has touched since: the default work,
-- weight still equal to the 5-decimal share it was given. An admin's own
-- number is left alone.
update work_decks wd
set weight = round(d.total_area_m2 / t.total, 10)
from decks d
join works w on w.project_id = d.project_id and w.seq = 1 and w.name = 'Công việc chính'
join (select project_id, sum(total_area_m2) as total from decks group by project_id) t
  on t.project_id = d.project_id
where wd.deck_id = d.id
  and wd.work_id = w.id
  and t.total > 0
  and wd.weight = round(d.total_area_m2 / t.total, 5);

-- ---------------------------------------------------------------------------
-- 2. The note rule moves from BEFORE INSERT to AFTER INSERT
-- ---------------------------------------------------------------------------
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
  -- unconditionally, and the note rule is checked after the insert (see
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
  return new;
end;
$$;

create or replace function log_cell_state_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  old_stage uuid;
begin
  -- 0019's rule for a row that was genuinely inserted: a note on a bay that
  -- has no stage would be a note with no event naming who wrote it.
  if tg_op = 'INSERT' and new.stage_id is null and new.note <> '' and not is_admin() then
    raise exception 'a note may only be changed together with the stage';
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
                           note, by)
  values (new.cell_id, new.work_id, (select name from works where id = new.work_id),
          old_stage, new.stage_id,
          (select name from deck_stages where id = old_stage),
          (select name from deck_stages where id = new.stage_id),
          new.note, auth.uid());
  return null;
end;
$$;

do $$
declare
  scale int;
begin
  select numeric_scale into scale
  from information_schema.columns
  where table_schema = 'public' and table_name = 'work_decks' and column_name = 'weight';
  if scale <> 10 then
    raise exception 'work_decks.weight scale is %, expected 10', scale;
  end if;
end $$;
