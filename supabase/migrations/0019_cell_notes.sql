-- Ghi chú theo ô: the foreman records WHY, not only what.
--
-- "Bề mặt còn ẩm, hoãn sơn sang mai" is the sentence the admin currently gets
-- by phone, or not at all. It belongs on the bay it is about, next to the coat
-- it explains.
--
-- The note lives on `cells` and is copied onto `cell_events` by the existing
-- audit trigger, rather than being written by a second statement after the
-- stage change. Three reasons, heaviest first:
--
--   1. One statement. `update cells set stage_id = ?, note = ?` is atomic. A
--      separate insert into cell_events is a second write that can fail on its
--      own, and this repo already carries three non-transactional multi-step
--      writes -- it does not need a fourth on the one write a foreman makes.
--   2. Realtime already publishes `cells` (0015, with REPLICA IDENTITY FULL in
--      0016), so a note reaches every other tablet on the deck with no new
--      subscription and no new client code.
--   3. The admin's drawing wants the LATEST note per bay, which is a column on
--      a row it already has, not an aggregate over an event table.
--
-- So `cells.note` is the current note and `cell_events.note` is the history.
-- Empty string, not null, for "no note": the client sends a note on every
-- stage change -- empty when the foreman typed nothing -- so a bay can never
-- keep a note that belonged to a change two coats ago, and no reader has to
-- decide what a null means.
alter table cells       add column note text not null default '';
alter table cell_events add column note text;

comment on column cells.note is
  'The note attached to this bay''s most recent stage change. Empty means none.';
comment on column cell_events.note is
  'The note as it was at this event. Null on events recorded before 0019.';

-- The audit trigger carries the note into the history.
--
-- Unchanged otherwise, including the existence check 0004 added because this
-- AFTER trigger can fire for a cell the same statement has already deleted,
-- and the denormalised stage names 0005 added.
create or replace function log_cell_stage_change()
returns trigger
language plpgsql
as $$
begin
  if new.stage_id is distinct from old.stage_id
     and exists (select 1 from cells where id = new.id) then
    insert into cell_events (cell_id, from_stage_id, to_stage_id,
                             from_stage_name, to_stage_name, note, by)
    values (new.id, old.stage_id, new.stage_id,
            (select name from project_stages where id = old.stage_id),
            (select name from project_stages where id = new.stage_id),
            new.note,
            auth.uid());
  end if;
  return null;
end;
$$;

-- The guard learns about the new column, in both directions.
--
-- `note` is deliberately NOT added to the rejected list: a GS writing one is
-- the whole point of this migration, and that list is what a non-admin may not
-- touch. Every column rejected before still is -- id, the geometry, and (0013)
-- updated_at / updated_by, which are the audit trail the customer is shown.
--
-- What IS new is the second rule. The trigger above writes an event only when
-- the STAGE changes, so a note-only update would move `cells.note` with
-- nothing in `cell_events` to say who wrote it or when. Requiring the two to
-- move together is what makes cell_events a complete record of every note this
-- system has held. The app already writes them in one statement; this means
-- nothing else can do otherwise.
--
-- The exception message changes, because the old one ("only stage_id may be
-- changed") is now false, and a guard whose message misdescribes what it
-- enforces is worse than one with no message. verify_schema.sql matches on
-- this string; both were updated together.
--
-- `security invoker` and the pinned search_path are carried over from 0008 --
-- see it for why this guard is invoker (it reads no tables, and its only call,
-- is_admin(), is already definer). Do not rename this function or its trigger:
-- verify_schema checks 18 and 19 pin the name ordering that makes this guard
-- run before cells_set_audit_columns.
create or replace function assert_gs_updates_stage_only()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if is_admin() then
    return new;
  end if;

  if new.id         is distinct from old.id
     or new.deck_id    is distinct from old.deck_id
     or new.code       is distinct from old.code
     or new.x          is distinct from old.x
     or new.y          is distinct from old.y
     or new.w          is distinct from old.w
     or new.h          is distinct from old.h
     or new.area_m2    is distinct from old.area_m2
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
