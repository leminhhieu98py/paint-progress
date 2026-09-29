-- Nhân lực: one person, one row (owner, 2026-09-29/30; rules NL-03, NL-06).
--
-- The admin's "Người dùng" and "Nhân viên" screens become one list, Nhân lực:
-- GS/Visitor accounts (`profiles`, role gs or viewer) and employees
-- (`employees`, 0032) side by side. The owner's rule for that list: a name
-- appears once. Until now nothing said so across the two tables --
-- `employees_name_key` (0032) keeps employees apart from each other, and
-- `profiles.full_name` was not unique at all -- so the same foreman could be a
-- GS account and an employee, and two accounts could carry one name.
--
-- ---------------------------------------------------------------------------
-- The rule, as enforced here
-- ---------------------------------------------------------------------------
-- Names compare as `lower(btrim(full_name))`, exactly as `employees_name_key`.
-- Admin accounts are outside the rule: they are not on the list.
--
--   * Two GS/Visitor accounts never share a name -- a HIDDEN account included.
--     Controller ruling A1: converting an account into an employee locks and
--     hides the account instead of deleting it (a delete would null
--     `cell_events.by`, `cell_states.updated_by` and the credential log for
--     good), and the parked account keeps its name so a second account of the
--     same person cannot be created beside it.
--   * An employee never shares a name with a VISIBLE account. It may share it
--     with a hidden one: that is the converted person of A1, and converting
--     them back re-opens that account rather than creating a new one (NL-04).
--   * Employees among themselves: `employees_name_key`, unchanged.
--
-- Enforced by two BEFORE row triggers, one per table, because a unique index
-- cannot span two tables. `profiles` is checked on insert and on any update of
-- `full_name`, `role` or `hidden` -- the last because "Hiện lại" on a hidden
-- account whose name an employee now carries would put the person on the list
-- twice. Each trigger takes a transaction-scoped advisory lock on the name, so
-- two sessions writing the same name into the two tables cannot both pass:
-- the second waits, and its check then reads the first one's committed row.
--
-- A refusal is `SQLSTATE PPDUP`, message `duplicate_person_name: …`, DETAIL
-- who already holds the name: `account`, `hidden_account`, `employee` or
-- `retired_employee` -- the last two are out of the list's default view, and
-- the admin is told how to find them. The app and the admin-users Edge
-- Function turn that into Vietnamese; no text here is shown to anyone.
--
-- ---------------------------------------------------------------------------
-- Data
-- ---------------------------------------------------------------------------
-- NOT ONE ROW IS CHANGED. If the data already breaks the rule, the first
-- block below raises before any object is created and names how many names
-- clash; `supabase/queries/nhan_luc_duplicates.sql` (read-only) lists them.
-- The admin renames or merges those rows by hand, then the push is repeated.
--
-- RLS: no policy changes. Both functions are security definer with a pinned
-- search_path so the check sees every row whoever writes -- the admin through
-- PostgREST, or the Edge Function's service_role. Because a BEFORE trigger
-- runs before RLS checks the new row, the lookup is done only for those
-- callers (and SQL sessions); anon and non-admin sessions skip it and are
-- refused by RLS as before, so no name is ever confirmed to them (review
-- I-1). The same reason revokes INSERT on profiles from anon and
-- authenticated (only the Edge Function creates accounts) and on employees
-- from anon.
--
-- Deploy order: this migration, then the Edge Function, then the app. The
-- deployed app keeps working against it: its writes that the rule refuses come
-- back as an error it shows verbatim until the new app maps it.

-- ---------------------------------------------------------------------------
-- 1. Fail fast on data that already breaks the rule. Runs before any DDL.
-- ---------------------------------------------------------------------------
do $$
declare
  account_clashes int;
  cross_clashes int;
begin
  select count(*) into account_clashes from (
    select 1 from public.profiles
    where role in ('gs', 'viewer')
    group by lower(btrim(full_name))
    having count(*) > 1
  ) d;
  select count(distinct lower(btrim(e.full_name))) into cross_clashes
  from public.employees e
  join public.profiles p
    on lower(btrim(p.full_name)) = lower(btrim(e.full_name))
   and p.role in ('gs', 'viewer')
   and not p.hidden;
  if account_clashes > 0 or cross_clashes > 0 then
    raise exception '0037: % name(s) shared by several GS/Visitor accounts and % name(s) shared by an employee and a visible account. Nothing was changed. Run supabase/queries/nhan_luc_duplicates.sql, rename or merge the rows it lists (blocks_migration = true), then push again.',
      account_clashes, cross_clashes;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. The two checks.
-- ---------------------------------------------------------------------------
create or replace function employees_assert_unique_name()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  name_key text := lower(btrim(new.full_name));
begin
  -- Only an admin, the service role (the admin-users Edge Function) or a SQL
  -- session is told a name is taken. anon and every other signed-in session
  -- return here untouched and meet RLS, which refuses them without a name
  -- ever being looked up: a PPDUP answer to them would say whether a person
  -- exists (review I-1). `role` is the role PostgREST set for the request;
  -- security definer changes the user, not that setting.
  if current_setting('role', true) in ('anon', 'authenticated') and not is_admin() then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtext('nhan_luc_person_name'), hashtext(name_key));
  if exists (
    select 1 from profiles p
    where p.role in ('gs', 'viewer')
      and not p.hidden
      and lower(btrim(p.full_name)) = name_key
  ) then
    raise exception 'duplicate_person_name: % is already the name of an account', new.full_name
      using errcode = 'PPDUP', detail = 'account';
  end if;
  return new;
end;
$$;

create or replace function profiles_assert_unique_name()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  name_key text := lower(btrim(new.full_name));
  holder_hidden boolean;
  holder_active boolean;
begin
  if new.role not in ('gs', 'viewer') then
    return new;
  end if;
  -- Only an admin, the service role (the admin-users Edge Function) or a SQL
  -- session is told a name is taken. anon and every other signed-in session
  -- return here untouched and meet RLS, which refuses them without a name
  -- ever being looked up: a PPDUP answer to them would say whether a person
  -- exists (review I-1). `role` is the role PostgREST set for the request;
  -- security definer changes the user, not that setting.
  if current_setting('role', true) in ('anon', 'authenticated') and not is_admin() then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtext('nhan_luc_person_name'), hashtext(name_key));
  select p.hidden into holder_hidden from profiles p
  where p.id <> new.id
    and p.role in ('gs', 'viewer')
    and lower(btrim(p.full_name)) = name_key
  order by p.hidden
  limit 1;
  if found then
    raise exception 'duplicate_person_name: % is already the name of an account', new.full_name
      using errcode = 'PPDUP', detail = case when holder_hidden then 'hidden_account' else 'account' end;
  end if;
  if not new.hidden then
    select e.active into holder_active from employees e
    where lower(btrim(e.full_name)) = name_key
    limit 1;
    if found then
      raise exception 'duplicate_person_name: % is already the name of an employee', new.full_name
        using errcode = 'PPDUP', detail = case when holder_active then 'employee' else 'retired_employee' end;
    end if;
  end if;
  return new;
end;
$$;

create trigger employees_assert_unique_name
  before insert or update of full_name on employees
  for each row execute function employees_assert_unique_name();

create trigger profiles_assert_unique_name
  before insert or update of full_name, role, hidden on profiles
  for each row execute function profiles_assert_unique_name();

-- Nobody but the Edge Function (service_role) creates an account: the app
-- never inserts into profiles, and create_admin.sql runs as postgres. An
-- employee is added by an admin session (authenticated), never by anon. The
-- grants say so too, so an insert from those roles fails on the privilege,
-- before any trigger runs (review I-1).
revoke insert on public.profiles from anon, authenticated;
revoke insert on public.employees from anon;

comment on function employees_assert_unique_name() is
  'Nhân lực (0037): tên nhân viên không trùng tên tài khoản GS/Visitor đang hiện. So sánh lower(btrim()).';
comment on function profiles_assert_unique_name() is
  'Nhân lực (0037): tên tài khoản GS/Visitor không trùng tài khoản GS/Visitor khác (kể cả đã ẩn), và khi đang hiện thì không trùng tên nhân viên.';

-- ---------------------------------------------------------------------------
-- 3. Prove it
-- ---------------------------------------------------------------------------
do $$
declare
  n int;
begin
  -- Both functions: definer, pinned search_path, one overload each.
  select count(*) into n from pg_proc
  where pronamespace = 'public'::regnamespace
    and proname in ('employees_assert_unique_name', 'profiles_assert_unique_name')
    and prosecdef and proconfig @> array['search_path=public, pg_temp']
    and pronargs = 0;
  if n <> 2 then
    raise exception '0037: the two name checks are not both pinned security definer functions (found %)', n;
  end if;

  -- Both triggers: BEFORE, per row, on the events the rule needs, enabled.
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.employees'::regclass and tgname = 'employees_assert_unique_name'
      and not tgisinternal and tgenabled = 'O'
      and pg_get_triggerdef(oid) like '%BEFORE INSERT OR UPDATE OF full_name ON %employees FOR EACH ROW%'
  ) then
    raise exception '0037: employees_assert_unique_name is missing, disabled, or not BEFORE INSERT OR UPDATE OF full_name FOR EACH ROW';
  end if;
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.profiles'::regclass and tgname = 'profiles_assert_unique_name'
      and not tgisinternal and tgenabled = 'O'
      and pg_get_triggerdef(oid) like '%BEFORE INSERT OR UPDATE OF full_name, role, hidden ON %profiles FOR EACH ROW%'
  ) then
    raise exception '0037: profiles_assert_unique_name is missing, disabled, or not BEFORE INSERT OR UPDATE OF full_name, role, hidden FOR EACH ROW';
  end if;

  -- Only admins, the service role and SQL sessions reach the lookup (I-1).
  select count(*) into n from pg_proc
  where pronamespace = 'public'::regnamespace
    and proname in ('employees_assert_unique_name', 'profiles_assert_unique_name')
    and prosrc like '%current_setting(''role'', true) in (''anon'', ''authenticated'') and not is_admin()%';
  if n <> 2 then
    raise exception '0037: a name check looks names up for callers other than admins and the service role (found % of 2 guarded)', n;
  end if;
  if has_table_privilege('anon', 'public.profiles', 'insert')
     or has_table_privilege('authenticated', 'public.profiles', 'insert')
     or has_table_privilege('anon', 'public.employees', 'insert') then
    raise exception '0037: anon or authenticated still holds INSERT on profiles, or anon on employees';
  end if;
  -- The writers that remain: the Edge Function on both tables, admins on employees.
  if not (has_table_privilege('service_role', 'public.profiles', 'insert')
          and has_table_privilege('service_role', 'public.employees', 'insert')
          and has_table_privilege('service_role', 'public.employees', 'delete')
          and has_table_privilege('authenticated', 'public.employees', 'insert')) then
    raise exception '0037: service_role lost INSERT on profiles/employees or DELETE on employees, or authenticated lost INSERT on employees';
  end if;

  -- The refusal carries the code the app and the Edge Function look for.
  select count(*) into n from pg_proc
  where pronamespace = 'public'::regnamespace
    and proname in ('employees_assert_unique_name', 'profiles_assert_unique_name')
    and prosrc like '%PPDUP%' and prosrc like '%duplicate_person_name%';
  if n <> 2 then
    raise exception '0037: a name check does not raise PPDUP / duplicate_person_name (found % of 2)', n;
  end if;

  -- 0032's own rule is still there, untouched.
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'employees_name_key') then
    raise exception '0037: employees_name_key is missing';
  end if;

  -- The data still satisfies the rule (nothing slipped in during the push).
  select count(*) into n from (
    select 1 from public.profiles
    where role in ('gs', 'viewer')
    group by lower(btrim(full_name))
    having count(*) > 1
  ) d;
  if n <> 0 then
    raise exception '0037: % name(s) are shared by several GS/Visitor accounts', n;
  end if;
  select count(*) into n from public.employees e
  join public.profiles p
    on lower(btrim(p.full_name)) = lower(btrim(e.full_name))
   and p.role in ('gs', 'viewer') and not p.hidden;
  if n <> 0 then
    raise exception '0037: % employee(s) share a name with a visible account', n;
  end if;
end $$;
