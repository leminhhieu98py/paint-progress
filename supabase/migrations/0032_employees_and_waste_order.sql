-- Feedback Rv4: a shared staff list, and the production order a lost hour is
-- booked against.
--
-- Linh, 2026-09-07: "Tạo trường dữ liệu để Admin thiết lập danh sách nhân
-- viên. Tránh nhập thủ công gây không đồng nhất và khó quản lý." Rv2 let the
-- foreman type the two names by hand; two months of that gives "Tổ 1",
-- "To 1", "tổ1" and no way to add up a crew's hours. The names on the EVENT
-- stay text -- a snapshot, like work_name and to_stage_name -- so renaming or
-- retiring somebody never rewrites what was recorded. This table is only what
-- the picker offers.
create table employees (
  id         uuid primary key default gen_random_uuid(),
  full_name  text not null check (btrim(full_name) <> ''),
  -- Retired rather than deleted: the picker stops offering them, the history
  -- keeps naming them.
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

-- One person, one row. Case- and space-insensitive, so "Nguyễn Văn A" cannot
-- be added again as "nguyễn văn a " -- which is the inconsistency this table
-- exists to remove.
create unique index employees_name_key on employees (lower(btrim(full_name)));

comment on table employees is
  'Danh sách nhân viên dùng chung cho mọi dự án, sàn và công đoạn (Rv4). Admin quản lý; GS chỉ tìm và chọn.';

alter table employees enable row level security;
create policy employees_admin_all on employees
  for all using (is_admin()) with check (is_admin());
-- Every signed-in session reads it: a foreman cannot record a bay without
-- finding his own crew in here, and the table holds names and nothing else.
create policy employees_read on employees
  for select using (auth.uid() is not null);

-- The production order a lost hour is booked against (Rv4): required of the
-- foreman when waste_hours > 0, and printed beside the reason in the report.
-- Free text -- it is a reference into a system this one does not talk to.
alter table cell_states add column waste_order text not null default '';
alter table cell_events add column waste_order text;

comment on column cell_events.waste_order is
  'Lệnh sản xuất ghi nhận hao phí. Empty when no hours were lost; null on rows before 0032.';

-- 0030's guard, with waste_order in the set that may only move with the stage.
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
  if (new.lead_name       is distinct from old.lead_name
      or new.painter_name is distinct from old.painter_name
      or new.work_hours   is distinct from old.work_hours
      or new.waste_hours  is distinct from old.waste_hours
      or new.waste_reason is distinct from old.waste_reason
      or new.waste_order  is distinct from old.waste_order)
     and new.stage_id is not distinct from old.stage_id
  then
    raise exception 'effort may only be changed together with the stage';
  end if;
  return new;
end;
$$;

-- 0030's audit writer, carrying waste_order onto the event.
create or replace function log_cell_state_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  old_stage  uuid;
  has_effort boolean;
begin
  has_effort := new.lead_name <> '' or new.painter_name <> ''
             or new.work_hours is not null or new.waste_hours is not null
             or new.waste_reason <> '' or new.waste_order <> '';
  if tg_op = 'INSERT' and new.stage_id is null and (new.note <> '' or has_effort) and not is_admin() then
    raise exception 'a note or effort may only be recorded together with the stage';
  end if;
  old_stage := case when tg_op = 'INSERT' then null else old.stage_id end;
  if new.stage_id is not distinct from old_stage then
    return null;
  end if;
  if not exists (select 1 from cells where id = new.cell_id) then
    return null;
  end if;
  if new.stage_id is null
     and old_stage is not null
     and not exists (select 1 from deck_stages where id = old_stage) then
    return null;
  end if;
  insert into cell_events (cell_id, work_id, work_name,
                           from_stage_id, to_stage_id, from_stage_name, to_stage_name,
                           note, by,
                           lead_name, painter_name, work_hours, waste_hours, waste_reason, waste_order)
  values (new.cell_id, new.work_id, (select name from works where id = new.work_id),
          old_stage, new.stage_id,
          (select name from deck_stages where id = old_stage),
          (select name from deck_stages where id = new.stage_id),
          new.note, auth.uid(),
          new.lead_name, new.painter_name, new.work_hours, new.waste_hours,
          new.waste_reason, new.waste_order);
  return null;
end;
$$;

-- The admin backfill gains the same column. A new signature, so the old one is
-- dropped rather than left behind for a stale client to call with five
-- arguments and silently blank the order.
drop function if exists set_cell_event_effort(bigint, text, text, numeric, numeric, text);

create or replace function set_cell_event_effort(
  p_event_id     bigint,
  p_lead_name    text,
  p_painter_name text,
  p_work_hours   numeric,
  p_waste_hours  numeric,
  p_waste_reason text,
  p_waste_order  text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not is_admin() then
    raise exception 'set_cell_event_effort: admin only' using errcode = '42501';
  end if;

  update cell_events
  set lead_name        = coalesce(btrim(p_lead_name), ''),
      painter_name     = coalesce(btrim(p_painter_name), ''),
      work_hours       = p_work_hours,
      waste_hours      = p_waste_hours,
      waste_reason     = coalesce(btrim(p_waste_reason), ''),
      waste_order      = coalesce(btrim(p_waste_order), ''),
      effort_edited_by = auth.uid(),
      effort_edited_at = now()
  where id = p_event_id;

  if not found then
    raise exception 'set_cell_event_effort: no cell_events row with id %', p_event_id;
  end if;
end;
$$;

revoke all on function set_cell_event_effort(bigint, text, text, numeric, numeric, text, text) from public, anon;
grant execute on function set_cell_event_effort(bigint, text, text, numeric, numeric, text, text) to authenticated;

do $$
declare
  n int;
begin
  if not exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'employees') then
    raise exception 'employees table is missing';
  end if;
  select count(*) into n from pg_policies
  where schemaname = 'public' and tablename = 'employees'
    and policyname in ('employees_admin_all', 'employees_read');
  if n <> 2 then
    raise exception 'employees policies: % of 2 present', n;
  end if;
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'employees_name_key') then
    raise exception 'employees_name_key is missing';
  end if;
  select count(*) into n from information_schema.columns
  where table_schema = 'public' and column_name = 'waste_order'
    and table_name in ('cell_states', 'cell_events');
  if n <> 2 then
    raise exception 'waste_order columns: % of 2 present', n;
  end if;
  if not exists (
    select 1 from pg_proc
    where proname = 'set_cell_event_effort' and prosecdef
      and pronargs = 7
  ) then
    raise exception 'set_cell_event_effort is missing, is not definer, or kept its old arity';
  end if;
  if has_function_privilege('anon', 'set_cell_event_effort(bigint, text, text, numeric, numeric, text, text)', 'execute') then
    raise exception 'anon can execute set_cell_event_effort';
  end if;
  if has_table_privilege('authenticated', 'cell_events', 'update') then
    raise exception 'authenticated holds UPDATE on cell_events';
  end if;
end $$;
