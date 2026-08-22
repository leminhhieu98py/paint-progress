-- A geometry edit is not progress, so it must not re-stamp the progress audit
-- columns.
--
-- cells.updated_at / updated_by exist to record WHO recorded WHICH coat and
-- WHEN: spec §9 has the per-deck report carry "last updated, updated by" per
-- cell, and that is a progress fact reported to the customer. But
-- set_cell_audit_columns (0002) fired on every UPDATE, and syncCells' geometry
-- upsert is an UPDATE for every cell whose code already exists -- so nudging one
-- guide and re-saving re-stamped every cell on the deck with today's date and
-- the admin's id. A GS records Coat 3 on 40 bays on 3 March, the admin adjusts
-- the mesh on 20 March, and all 40 rows now say 20 March / Linh.
--
-- The fix is the guard log_cell_stage_change (0002) already uses, so the two
-- triggers on this table now agree on what counts as a change worth recording:
-- `is distinct from` rather than `<>`, because stage_id is nullable and
-- `null <> null` is null, not false -- which would leave the whole guard
-- evaluating to null and skipping the stamp on a genuine null -> stage tick,
-- the first coat of every cell's life.
--
-- Deliberately kept BEFORE UPDATE, row-level, with no column list and no WHEN
-- clause: verify_schema.sql check 19 asserts exactly that shape, because a
-- `BEFORE UPDATE OF stage_id` variant would stop firing on other columns and a
-- WHEN clause would move this decision somewhere the function's own body cannot
-- explain. security invoker and the pinned search_path are carried over from
-- 0009 unchanged (verify_schema check 24 asserts them).
--
-- Nothing here touches INSERT: the trigger is UPDATE-only, and a new cell takes
-- updated_at from the column default.
create or replace function set_cell_audit_columns()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if new.stage_id is not distinct from old.stage_id then
    return new;
  end if;

  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;
