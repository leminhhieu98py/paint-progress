-- Paint stages belong to a deck, not to a project.
--
-- They were declared once per project, on the reading that a project is painted
-- to one spec. It is not: a main deck, a cellar deck and a helideck on the same
-- job carry different coat systems, and the admin has to be able to say so per
-- deck. Declaring them per project meant every deck of a job shared one set, and
-- a deck that needed a different one had nowhere to put it.
--
-- The table is renamed with the scope. `project_stages` holding deck stages is
-- the kind of name that costs an afternoon a year from now. Postgres carries the
-- foreign keys, indexes, policies and triggers across a rename by itself; what
-- it cannot carry is a function body that names the table in SQL text, so those
-- are redefined below -- and redefined BEFORE the data moves, because two of
-- them fire on the very statements that move it.
--
-- Statement order in this file is load-bearing throughout, and each ordering
-- constraint is stated at the statement it binds. Do not reflow it.
alter table project_stages rename to deck_stages;

alter table deck_stages add column deck_id uuid references decks on delete cascade;

-- The old policies come down here, not at the end beside their replacements:
-- `project_stages_member_read` is `project_id in (select my_projects())`, so it
-- depends on the column, and Postgres refuses to drop a column a policy reads.
drop policy project_stages_admin_all on deck_stages;
drop policy project_stages_member_read on deck_stages;

-- Both of these have to go BEFORE the copy below. Each one on its own rejects
-- it outright:
--
--   - `unique (project_id, seq)` counts across a whole project, and the copy
--     writes one row per DECK -- so the second deck's seq 1 collides with the
--     first deck's, and the insert fails with 23505.
--   - `project_id` is NOT NULL, and a copy belongs to a deck, not to a project:
--     it has nothing to put there. This is what 23502 was.
--
-- The column is dropped a dozen statements below either way, so relaxing it
-- here costs nothing.
alter table deck_stages drop constraint project_stages_project_id_seq_key;
alter table deck_stages alter column project_id drop not null;

-- ---------------------------------------------------------------------------
-- The functions, redefined before anything they watch is touched.
--
-- `assert_stage_belongs_to_project` and `log_cell_stage_change` both name the
-- stage table in SQL text, and both fire on the cell remap further down. Left
-- until the end of the file they would fail that statement with `42P01 relation
-- "project_stages" does not exist`.
-- ---------------------------------------------------------------------------

-- The guard is about decks now. Same shape as 0009: a cell may only be moved to
-- a stage that belongs where the cell does, and the resolution is pinned to the
-- search_path rather than to whatever PostgREST sets per request.
create or replace function assert_stage_belongs_to_project()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  stage_deck uuid;
begin
  if new.stage_id is null then
    return new;
  end if;

  select s.deck_id into stage_deck from deck_stages s where s.id = new.stage_id;

  if stage_deck is distinct from new.deck_id then
    raise exception 'stage % does not belong to deck %', new.stage_id, new.deck_id;
  end if;

  return new;
end;
$$;

comment on function assert_stage_belongs_to_project() is
  'Name kept so its trigger keeps working; it asserts the stage belongs to the cell''s DECK.';

-- 0014's two, redefined only because they name the table in SQL text. The
-- reasoning in their comments there still holds and is not repeated here.
create or replace function log_stage_deletion_on_cells()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- 0004's lesson through the new door: deleting a project fans out into
  -- decks -> deck_stages (firing this) racing decks -> cells CASCADE at another
  -- depth. When the deck is already gone its cells are going with it and an
  -- audit row for a deleted cell has no readers.
  insert into cell_events (cell_id, from_stage_id, to_stage_id,
                           from_stage_name, to_stage_name, by)
  select c.id, old.id, null, old.name, null, auth.uid()
  from cells c
  where c.stage_id = old.id
    and exists (select 1 from decks d where d.id = old.deck_id);

  return old;
end;
$$;

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

  if not exists (select 1 from cells where id = new.id) then
    return null;
  end if;

  if new.stage_id is null
     and old.stage_id is not null
     and not exists (select 1 from deck_stages where id = old.stage_id) then
    return null;
  end if;

  insert into cell_events (cell_id, from_stage_id, to_stage_id,
                           from_stage_name, to_stage_name, by)
  values (new.id, old.stage_id, new.stage_id,
          (select name from deck_stages where id = old.stage_id),
          (select name from deck_stages where id = new.stage_id),
          auth.uid());
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- The data.
-- ---------------------------------------------------------------------------

-- Every deck of a project gets its own copy of that project's stages, so no deck
-- loses the spec it was being painted to. `s.deck_id is null` is what tells an
-- original from a copy; INSERT ... SELECT reads the snapshot taken when the
-- statement began, so the rows being written are invisible to the join writing
-- them.
insert into deck_stages (deck_id, seq, name, color, weight)
select d.id, s.seq, s.name, s.color, s.weight
from decks d
join deck_stages s on s.project_id = d.project_id and s.deck_id is null;

-- The remap below re-points every recorded cell from an original stage row to
-- its own deck's copy. That is a change of ROW IDENTITY, not a change of paint:
-- the cell means exactly what it meant a second ago. Left armed, the triggers on
-- cells would disagree --
--
--   - cells_log_stage_change writes one cell_events row per cell, reading
--     'Coat 3' -> 'Coat 3'. On a deck of two hundred bays that is two hundred
--     audit rows recording work nobody did.
--   - cells_set_audit_columns rewrites updated_at/updated_by on every one of
--     them, so every painted bay on the platform looks freshly touched, by
--     whoever ran this file.
--
-- Both are read by people deciding what to pay for. `disable trigger user`
-- leaves the FK triggers armed (those are internal), so referential integrity
-- still holds across the window, and it is re-enabled four statements later.
alter table cells disable trigger user;

-- Matched on seq: the copies are identical within a project, so seq names the
-- same stage in each.
-- Both stage rows sit in the FROM-list and every condition sits in WHERE. Not a
-- style choice: in UPDATE ... FROM, the target table is not part of the
-- FROM-list join tree, so an `os join ns on ns.deck_id = c.deck_id` is rejected
-- outright with `42P10 invalid reference to FROM-clause entry for table "c"`.
update cells c
set stage_id = ns.id
from deck_stages os, deck_stages ns
where c.stage_id = os.id
  and os.deck_id is null
  and ns.deck_id = c.deck_id
  and ns.seq = os.seq;

alter table cells enable trigger user;

-- Zones name a stage too, and theirs is NOT NULL ON DELETE CASCADE: leaving them
-- pointed at a row the next statement deletes would delete the zones. No trigger
-- on this table, so nothing to disarm.
update zones z
set stage_id = ns.id
from deck_stages os, deck_stages ns
where z.stage_id = os.id
  and os.deck_id is null
  and ns.deck_id = z.deck_id
  and ns.seq = os.seq;

-- The originals, now that nothing points at them. deck_stages_log_deletion
-- fires per row and writes nothing: its `where c.stage_id = old.id` matches no
-- cell after the remap, and an original's deck_id is null so the guard fails
-- anyway.
--
-- cell_events keep their from_stage_name/to_stage_name snapshots (0005), and
-- their stage ids are ON DELETE SET NULL, so the history survives this with
-- nothing readable lost.
delete from deck_stages where deck_id is null;

alter table deck_stages alter column deck_id set not null;
alter table deck_stages drop column project_id;

-- Deferrable for the reason 0012 gave: saveStages renumbers survivors before it
-- deletes, which passes through a moment where two rows share a seq.
alter table deck_stages
  add constraint deck_stages_deck_id_seq_key
  unique (deck_id, seq) deferrable initially deferred;

comment on table deck_stages is
  'Paint stages of one deck, innermost first by seq. Weights sum to 1 per deck.';

-- The trigger kept its old name across the table rename, as the policies did.
-- Renamed for the same reason: a reader grepping deck_stages must find
-- everything attached to it.
alter trigger project_stages_log_deletion on deck_stages
  rename to deck_stages_log_deletion;

-- Both policies back, under names that grep will find. They came down near the
-- top, before the column they read went away.
create policy deck_stages_admin_all on deck_stages
  for all using (is_admin()) with check (is_admin());
create policy deck_stages_member_read on deck_stages
  for select using (
    deck_id in (select id from decks where project_id in (select my_projects()))
  );
