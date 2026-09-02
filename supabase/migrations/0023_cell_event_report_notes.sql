-- Report-facing edit and hide for a GS note.
--
-- Feedback Rv1, item 4, as the owner decided it: the admin never alters what
-- the foreman wrote. She can write a version FOR THE REPORT, and she can keep
-- a note OUT of the report; the GS screen and the admin's own thread go on
-- showing the original, with a stamp saying who touched the report copy and
-- when. `report_note` null means "print the original"; `report_hidden` true
-- means "print nothing". Both are reversible through the same function.
alter table cell_events
  add column report_note      text,
  add column report_hidden    boolean not null default false,
  add column report_edited_by uuid,
  add column report_edited_at timestamptz;

-- Named, because progressApi embeds `profiles!cell_events_report_edited_by_fkey`
-- to tell this join apart from `by`'s onto the same table. On delete set null,
-- like every other actor reference here (0003): the stamp outlives the account.
alter table cell_events
  add constraint cell_events_report_edited_by_fkey
    foreign key (report_edited_by) references profiles on delete set null;

comment on column cell_events.report_note is
  'Admin''s version of `note` for the XLSX. Null means print `note` as written.';
comment on column cell_events.report_hidden is
  'True keeps this note out of the XLSX. The GS screen and the admin thread still show it.';

-- The only write path onto cell_events besides the audit trigger. 0008
-- revoked INSERT/UPDATE/DELETE from every client role and 0006 gave the table
-- read policies only; neither changes here. A definer function that checks
-- is_admin() itself keeps the table append-only-by-system and puts the whole
-- rule in one place, instead of an UPDATE policy plus a column-guard trigger
-- to stop an admin session rewriting `note` or `at`.
create or replace function set_report_note(
  p_event_id    bigint,
  p_report_note text,
  p_hidden      boolean
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not is_admin() then
    raise exception 'set_report_note: admin only' using errcode = '42501';
  end if;

  update cell_events
  set report_note      = nullif(btrim(p_report_note), ''),
      report_hidden    = coalesce(p_hidden, false),
      report_edited_by = auth.uid(),
      report_edited_at = now()
  where id = p_event_id;

  if not found then
    raise exception 'set_report_note: no cell_events row with id %', p_event_id;
  end if;
end;
$$;

revoke all on function set_report_note(bigint, text, boolean) from public, anon;
grant execute on function set_report_note(bigint, text, boolean) to authenticated;

do $$
declare
  n int;
begin
  select count(*) into n
  from information_schema.columns
  where table_schema = 'public' and table_name = 'cell_events'
    and column_name in ('report_note', 'report_hidden', 'report_edited_by', 'report_edited_at');
  if n <> 4 then
    raise exception 'cell_events report columns: % of 4 present', n;
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'cell_events_report_edited_by_fkey'
  ) then
    raise exception 'cell_events_report_edited_by_fkey is missing';
  end if;
  if not exists (
    select 1 from pg_proc where proname = 'set_report_note' and prosecdef
  ) then
    raise exception 'set_report_note is missing or is not security definer';
  end if;
  if has_function_privilege('anon', 'set_report_note(bigint, text, boolean)', 'execute') then
    raise exception 'anon can execute set_report_note';
  end if;
  -- 0008's revoke must still hold: this function is meant to be the ONLY
  -- client-reachable write onto the table.
  if has_table_privilege('authenticated', 'cell_events', 'update') then
    raise exception 'authenticated holds UPDATE on cell_events';
  end if;
end $$;
