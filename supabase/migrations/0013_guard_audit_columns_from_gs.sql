-- A GS may change a cell's stage. It may not decide who recorded it, or when.
--
-- cells.updated_at / updated_by are the progress audit trail: spec §9 has the
-- per-deck report carry "last updated, updated by" per cell, and that is a fact
-- reported to the customer. 0006's non-admin guard lists every geometry column
-- but not these two, and before 0011 that did not matter -- set_cell_audit_columns
-- overwrote updated_at on EVERY update, so a supplied value could not survive.
--
-- 0011 gave that trigger a guard (`if new.stage_id is not distinct from
-- old.stage_id then return new`), which was the right fix for re-stamping every
-- cell on a geometry save. Its side effect is that a stage-unchanged update now
-- keeps whatever updated_at the client sent: verified in a container, `update
-- cells set area_m2 = ..., updated_at = '2000-01-01'` leaves the timestamp at
-- 2000-01-01, where pre-0011 it was always overwritten. syncCells' payload is
-- geometry-only so the app never does this, but nothing stops a GS from PATCHing
-- `updated_at` (or `updated_by`, naming somebody else) directly against
-- PostgREST -- and cells_member_update permits an update on their own project's
-- cells. A forged date or a forged author on a coat record is exactly the kind of
-- claim this trail exists to be trusted for.
--
-- Adding both columns to the rejected list closes it. `id` and the geometry
-- columns are carried over from 0008 unchanged, as are `security invoker` and the
-- pinned search_path -- see 0008 for why this guard is invoker (it reads no
-- tables, and its only call, is_admin(), is already definer) and verify_schema
-- check 15 for the assertion that pins it.
--
-- Rejecting a forged value cannot collide with the stamp the audit trigger
-- applies afterwards, because this guard runs FIRST. Both are row-level BEFORE
-- UPDATE triggers on cells, Postgres orders same-timing triggers by name, and
-- 'cells_assert_gs_stage_only' sorts ahead of 'cells_set_audit_columns'. So on a
-- genuine GS stage tick this guard passes (updated_at is unchanged at that
-- point -- the client did not send it) and set_cell_audit_columns then stamps
-- now() / auth.uid() into the same row. The stamp is the trigger's own write, not
-- the client's, so it is never a value this guard has already seen. verify_schema
-- checks 18 and 19 are what pin that ordering; do not reorder or rename these
-- triggers.
--
-- An admin is unaffected: is_admin() returns early, exactly as it does for the
-- geometry columns this guard has always listed.
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
    raise exception 'only stage_id may be changed by a non-admin';
  end if;

  return new;
end;
$$;
