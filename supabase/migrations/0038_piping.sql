-- 0038: Piping -- Reinstatement, Manpower and CAM Insulation per project
-- (spec 2026-10-07-piping §2, §4-§9; Linh's answers Q2-Q24; rulings R-1..R-15).
--
-- A new module beside the paint tracker, switched on per project by the
-- admin. Three hạng mục, each a plan the admin imports from Excel and an
-- actual the field records:
--
--   Reinstatement  test packs reinstated per day, capped by the project's
--                  total Test Pack (Q9A).
--   Manpower       head count per day per crew group (Q11-Q13). Separate from
--                  the app's Nhân lực/Mhr data (Q12A).
--   Insulation     one row per spool with three milestones -- PH (Painting
--                  Handover), IH (Insulation Handover), IW (Insulation Work) --
--                  each with a plan date and an actual date (Q14-Q21).
--
-- Every record is a calendar `date` in Vietnam time. Weeks are computed at
-- display time from `piping_settings.week_start_date` and never stored, so
-- changing the week start never rewrites a row (§3).
--
-- ---------------------------------------------------------------------------
-- Who may do what (§1), and where it is enforced
-- ---------------------------------------------------------------------------
-- Same predicates as every policy since 0028/0034: `is_admin()`, `is_gs()`,
-- and `my_projects()` -- which a GS passes for its assigned projects and a
-- viewer passes for every project (0034).
--
--   * Every table: `<table>_admin_all` (for all, is_admin()).
--   * Project data the field reads (settings, plans, actuals, groups, spools,
--     extra columns): `<table>_member_read` (select, my_projects()). So a GS
--     reads its projects, a viewer reads all, and nobody else reads anything.
--   * piping_notes and piping_import_log: NO member policy at all. Admin notes
--     are unreadable by a GS or a viewer at the database level, not merely
--     hidden by the screen (§0, §9).
--   * No member WRITE policy anywhere. A GS writes only through the three
--     security definer functions below, each of which checks
--     `is_admin() or (is_gs() and p_project in (select my_projects()))`
--     itself, raises 42501 otherwise, and then applies the field rules (day
--     not in the future, the Test Pack cap, fill-empty-only for Manpower,
--     PH <= IH <= IW and confirm-before-overwrite for spools). A viewer passes
--     my_projects() and fails is_gs(), so it writes nothing (0028's split).
--   * The admin's plan imports also go through definer functions, one per
--     hạng mục, so a replace is one transaction (no half import, §8) and
--     always writes its piping_import_log row.
--   * anon holds no privilege on any piping table: revoked below, so the
--     tables fail closed on the grant, not only on the policy.
--
-- Rules that must hold whoever writes -- the admin editing a row directly
-- through PostgREST included -- live in the table, not in a function:
--   * qty > 0, values >= 0, threshold 0..365 (CHECK constraints);
--   * PH_actual <= IH_actual <= IW_actual over the dates present (CHECK,
--     Q18A) -- plan dates may be out of order on purpose (Q15B);
--   * no actual dated after today, VN (BEFORE triggers; a CHECK may not read
--     the clock);
--   * the Test Pack cap, admin edits included (§4), in a BEFORE trigger that
--     takes a per-project advisory lock so two entries racing for the last
--     packs cannot both pass;
--   * a manpower group with data cannot be deleted, only hidden (R-6).
--
-- "Today" is `(now() at time zone 'Asia/Ho_Chi_Minh')::date`, in one function
-- (`piping_vn_today()`), the same calendar the client's effortDayKey uses.
--
-- ---------------------------------------------------------------------------
-- Stamps
-- ---------------------------------------------------------------------------
-- created_by/at on insert, edited_by/at (actual rows) or updated_by/at
-- (settings, notes) when a data column really changes, and
-- `<milestone>_actual_by/at` whenever that spool date changes -- a clear
-- included, so the stamp says who cleared it (the screen shows the stamp only
-- beside a date). Stamped in triggers, not by the client, for 0011's reason: a
-- client clock is not a fact. The triggers only ever SET a stamp on a real
-- change and never copy an old value back: a profile deleted later reaches
-- these rows as an ON DELETE SET NULL update, and a trigger that restored the
-- old id would turn that into a foreign key failure on the account delete.
-- Every actor column is a NAMED foreign key onto profiles, on delete set null
-- (0003's rule: the stamp outlives the account), so the API can embed
-- `profiles!<table>_<column>_fkey`.
--
-- ---------------------------------------------------------------------------
-- Not done here
-- ---------------------------------------------------------------------------
-- No existing table, policy, function or trigger is touched. No realtime
-- publication (the screen reads once per load). The plan/actual diff shown
-- to the admin before an import is computed client-side (T4); the functions
-- recompute the counts themselves for the log so the log never depends on the
-- client's arithmetic.
--
-- Purely additive: safe to apply to production ahead of the app that uses it.
-- The reverse order is not safe -- the Piping screen selects these tables.

-- ---------------------------------------------------------------------------
-- 1. Today, in Vietnam
-- ---------------------------------------------------------------------------
create or replace function piping_vn_today()
returns date
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select (now() at time zone 'Asia/Ho_Chi_Minh')::date;
$$;

revoke all on function piping_vn_today() from public, anon;
grant execute on function piping_vn_today() to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Tables
-- ---------------------------------------------------------------------------

-- One row per project that has ever had Piping enabled (§2). Disabling sets
-- enabled = false and keeps every row of data.
create table piping_settings (
  project_id          uuid primary key references projects on delete cascade,
  enabled             boolean not null default true,
  -- No default on purpose (Q7C): the admin picks it when enabling.
  week_start_date     date not null,
  -- Null: not entered yet, and Reinstatement entries are refused until it is (R-4).
  total_test_packs    int,
  late_threshold_days int not null default 7,
  created_by          uuid,
  created_at          timestamptz not null default now(),
  updated_by          uuid,
  updated_at          timestamptz not null default now(),
  constraint piping_settings_total_test_packs_check
    check (total_test_packs is null or total_test_packs >= 0),
  constraint piping_settings_late_threshold_days_check
    check (late_threshold_days between 0 and 365),
  constraint piping_settings_created_by_fkey
    foreign key (created_by) references profiles on delete set null,
  constraint piping_settings_updated_by_fkey
    foreign key (updated_by) references profiles on delete set null
);
comment on table piping_settings is
  'Piping per project (§2): bật/tắt, ngày bắt đầu tuần, tổng Test Pack, ngưỡng trễ (ngày). Tắt giữ nguyên dữ liệu.';

-- Reinstatement plan: one quantity per date, daily or weekly rows (Q4C).
create table piping_reinstatement_plan (
  project_id uuid not null references projects on delete cascade,
  day        date not null,
  plan_qty   numeric not null,
  primary key (project_id, day),
  constraint piping_reinstatement_plan_qty_check check (plan_qty >= 0)
);

-- Reinstatement actual: append-only entries; several on one day add up (R-3).
create table piping_reinstatement_actual (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects on delete cascade,
  day        date not null,
  qty        numeric not null,
  created_by uuid,
  created_at timestamptz not null default now(),
  edited_by  uuid,
  edited_at  timestamptz,
  constraint piping_reinstatement_actual_qty_check check (qty > 0),
  constraint piping_reinstatement_actual_created_by_fkey
    foreign key (created_by) references profiles on delete set null,
  constraint piping_reinstatement_actual_edited_by_fkey
    foreign key (edited_by) references profiles on delete set null
);
create index piping_reinstatement_actual_project_day_idx
  on piping_reinstatement_actual (project_id, day);

-- Manpower crew groups (§5). The name is unique per project case- and
-- space-insensitively, as employees_name_key (0032), because the Manpower
-- Plan import matches a column header to a group that way (R-14) -- two
-- groups differing only in case would make a header ambiguous.
create table piping_manpower_groups (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects on delete cascade,
  name       text not null,
  sort       int not null default 0,
  hidden     boolean not null default false,
  created_at timestamptz not null default now(),
  constraint piping_manpower_groups_name_check check (btrim(name) <> ''),
  -- Target of the composite foreign keys below: a plan or actual row can only
  -- name a group of its own project, so project_id (what RLS reads) cannot lie.
  constraint piping_manpower_groups_project_id_id_key unique (project_id, id)
);
create unique index piping_manpower_groups_name_key
  on piping_manpower_groups (project_id, lower(btrim(name)));

create table piping_manpower_plan (
  project_id uuid not null references projects on delete cascade,
  group_id   uuid not null,
  day        date not null,
  value      numeric not null,
  primary key (group_id, day),
  constraint piping_manpower_plan_value_check check (value >= 0),
  -- Cascade, not restrict: a project delete removes groups and plan rows in
  -- one cascade, and RESTRICT is checked mid-cascade. R-6 (no delete of a
  -- group with data) is the guard trigger's job instead.
  constraint piping_manpower_plan_group_fkey
    foreign key (project_id, group_id) references piping_manpower_groups (project_id, id)
    on delete cascade
);
create index piping_manpower_plan_project_day_idx on piping_manpower_plan (project_id, day);

create table piping_manpower_actual (
  project_id uuid not null references projects on delete cascade,
  group_id   uuid not null,
  day        date not null,
  value      numeric not null,
  created_by uuid,
  created_at timestamptz not null default now(),
  edited_by  uuid,
  edited_at  timestamptz,
  primary key (group_id, day),
  constraint piping_manpower_actual_value_check check (value >= 0),
  constraint piping_manpower_actual_group_fkey
    foreign key (project_id, group_id) references piping_manpower_groups (project_id, id)
    on delete cascade,
  constraint piping_manpower_actual_created_by_fkey
    foreign key (created_by) references profiles on delete set null,
  constraint piping_manpower_actual_edited_by_fkey
    foreign key (edited_by) references profiles on delete set null
);
create index piping_manpower_actual_project_day_idx on piping_manpower_actual (project_id, day);

-- CAM spools (§6.1). spool_no may repeat within a project (Q14C); seq is the
-- row's position in the imported file, which is also how duplicates are
-- paired across re-imports (R-10).
create table piping_spools (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references projects on delete cascade,
  seq             int not null,
  spool_no        text not null,
  line_no         text,
  insu_type       text,
  drawing_no      text,
  test_package_no text,
  painting_system text,
  -- Values of the admin-defined extra columns, keyed by piping_spool_columns.label (Q21A).
  extra           jsonb not null default '{}'::jsonb,
  ph_plan         date,
  ih_plan         date,
  iw_plan         date,
  ph_actual       date,
  ih_actual       date,
  iw_actual       date,
  ph_actual_by    uuid,
  ph_actual_at    timestamptz,
  ih_actual_by    uuid,
  ih_actual_at    timestamptz,
  iw_actual_by    uuid,
  iw_actual_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint piping_spools_spool_no_check check (btrim(spool_no) <> ''),
  constraint piping_spools_extra_check check (jsonb_typeof(extra) = 'object'),
  -- Q18A: the actual milestones happen in order, over the dates present.
  constraint piping_spools_actual_order check (
    (ph_actual is null or ih_actual is null or ph_actual <= ih_actual)
    and (ih_actual is null or iw_actual is null or ih_actual <= iw_actual)
    and (ph_actual is null or iw_actual is null or ph_actual <= iw_actual)
  ),
  constraint piping_spools_project_id_id_key unique (project_id, id),
  constraint piping_spools_ph_actual_by_fkey
    foreign key (ph_actual_by) references profiles on delete set null,
  constraint piping_spools_ih_actual_by_fkey
    foreign key (ih_actual_by) references profiles on delete set null,
  constraint piping_spools_iw_actual_by_fkey
    foreign key (iw_actual_by) references profiles on delete set null
);
create index piping_spools_project_spool_no_idx on piping_spools (project_id, spool_no);
create index piping_spools_project_seq_idx on piping_spools (project_id, seq);

-- Admin-defined extra text columns on spools (Q21A). Unique per project as the
-- group names are, because the Plan import matches headers the same way.
create table piping_spool_columns (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects on delete cascade,
  label      text not null,
  sort       int not null default 0,
  created_at timestamptz not null default now(),
  constraint piping_spool_columns_label_check check (btrim(label) <> '')
);
create unique index piping_spool_columns_label_key
  on piping_spool_columns (project_id, lower(btrim(label)));

-- Admin notes (§9, R-15): on a Reinstatement day, a Manpower day, or a spool.
-- Admin-only at the RLS level. A spool's notes go with the spool.
create table piping_notes (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects on delete cascade,
  target     text not null,
  day        date,
  spool_id   uuid,
  body       text not null,
  author     uuid,
  created_at timestamptz not null default now(),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  constraint piping_notes_target_check
    check (target in ('reinstatement_day', 'manpower_day', 'spool')),
  constraint piping_notes_target_shape check (
    (target = 'spool' and spool_id is not null and day is null)
    or (target <> 'spool' and day is not null and spool_id is null)
  ),
  constraint piping_notes_body_check check (btrim(body) <> ''),
  constraint piping_notes_spool_fkey
    foreign key (project_id, spool_id) references piping_spools (project_id, id)
    on delete cascade,
  constraint piping_notes_author_fkey
    foreign key (author) references profiles on delete set null,
  constraint piping_notes_updated_by_fkey
    foreign key (updated_by) references profiles on delete set null
);
create index piping_notes_project_target_day_idx on piping_notes (project_id, target, day);
create index piping_notes_spool_id_idx on piping_notes (spool_id);

-- One row per confirmed import (§8). Written by the definer functions below;
-- read by the admin only (Cấu hình).
create table piping_import_log (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects on delete cascade,
  kind        text not null,
  file_name   text not null default '',
  row_count   int not null,
  summary     jsonb not null default '{}'::jsonb,
  imported_by uuid,
  imported_at timestamptz not null default now(),
  constraint piping_import_log_kind_check
    check (kind in ('reinstatement_plan', 'manpower_plan', 'spool_plan', 'spool_actual')),
  constraint piping_import_log_row_count_check check (row_count >= 0),
  constraint piping_import_log_summary_check check (jsonb_typeof(summary) = 'object'),
  constraint piping_import_log_imported_by_fkey
    foreign key (imported_by) references profiles on delete set null
);
create index piping_import_log_project_idx on piping_import_log (project_id, imported_at desc);

-- ---------------------------------------------------------------------------
-- 3. RLS
-- ---------------------------------------------------------------------------
alter table piping_settings             enable row level security;
alter table piping_reinstatement_plan   enable row level security;
alter table piping_reinstatement_actual enable row level security;
alter table piping_manpower_groups      enable row level security;
alter table piping_manpower_plan        enable row level security;
alter table piping_manpower_actual      enable row level security;
alter table piping_spools               enable row level security;
alter table piping_spool_columns        enable row level security;
alter table piping_notes                enable row level security;
alter table piping_import_log           enable row level security;

create policy piping_settings_admin_all on piping_settings
  for all using (is_admin()) with check (is_admin());
create policy piping_settings_member_read on piping_settings
  for select using (project_id in (select my_projects()));

create policy piping_reinstatement_plan_admin_all on piping_reinstatement_plan
  for all using (is_admin()) with check (is_admin());
create policy piping_reinstatement_plan_member_read on piping_reinstatement_plan
  for select using (project_id in (select my_projects()));

create policy piping_reinstatement_actual_admin_all on piping_reinstatement_actual
  for all using (is_admin()) with check (is_admin());
create policy piping_reinstatement_actual_member_read on piping_reinstatement_actual
  for select using (project_id in (select my_projects()));

create policy piping_manpower_groups_admin_all on piping_manpower_groups
  for all using (is_admin()) with check (is_admin());
create policy piping_manpower_groups_member_read on piping_manpower_groups
  for select using (project_id in (select my_projects()));

create policy piping_manpower_plan_admin_all on piping_manpower_plan
  for all using (is_admin()) with check (is_admin());
create policy piping_manpower_plan_member_read on piping_manpower_plan
  for select using (project_id in (select my_projects()));

create policy piping_manpower_actual_admin_all on piping_manpower_actual
  for all using (is_admin()) with check (is_admin());
create policy piping_manpower_actual_member_read on piping_manpower_actual
  for select using (project_id in (select my_projects()));

create policy piping_spools_admin_all on piping_spools
  for all using (is_admin()) with check (is_admin());
create policy piping_spools_member_read on piping_spools
  for select using (project_id in (select my_projects()));

create policy piping_spool_columns_admin_all on piping_spool_columns
  for all using (is_admin()) with check (is_admin());
create policy piping_spool_columns_member_read on piping_spool_columns
  for select using (project_id in (select my_projects()));

-- Admin only: no member policy, by design (§0, §9).
create policy piping_notes_admin_all on piping_notes
  for all using (is_admin()) with check (is_admin());
create policy piping_import_log_admin_all on piping_import_log
  for all using (is_admin()) with check (is_admin());

-- Supabase's default privileges hand every new table to anon too. Nothing
-- signed out reads or writes Piping; fail closed on the grant.
revoke all on piping_settings, piping_reinstatement_plan, piping_reinstatement_actual,
              piping_manpower_groups, piping_manpower_plan, piping_manpower_actual,
              piping_spools, piping_spool_columns, piping_notes, piping_import_log
  from anon;

-- ---------------------------------------------------------------------------
-- 4. Triggers
-- ---------------------------------------------------------------------------
-- All security invoker with a pinned search_path, as every trigger function
-- since 0009. Inside a definer function they run as its owner; called
-- directly they see what the caller's RLS shows.

create or replace function piping_settings_stamp()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.created_at := now();
    new.updated_by := auth.uid();
    new.updated_at := now();
  elsif (to_jsonb(new) - array['created_by', 'created_at', 'updated_by', 'updated_at'])
        is distinct from
        (to_jsonb(old) - array['created_by', 'created_at', 'updated_by', 'updated_at']) then
    new.updated_by := auth.uid();
    new.updated_at := now();
  end if;
  return new;
end;
$$;

-- Shared by both actual tables, which carry the same four stamp columns.
create or replace function piping_actual_stamp()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.created_at := now();
    new.edited_by := null;
    new.edited_at := null;
  elsif (to_jsonb(new) - array['created_by', 'created_at', 'edited_by', 'edited_at'])
        is distinct from
        (to_jsonb(old) - array['created_by', 'created_at', 'edited_by', 'edited_at']) then
    new.edited_by := auth.uid();
    new.edited_at := now();
  end if;
  return new;
end;
$$;

-- Reinstatement entries: no future day, and the Test Pack cap (Q9A, R-4),
-- for every writer. The cap is checked on an insert and on an edit that
-- raises the quantity or moves the entry to another project; lowering a
-- quantity or changing the day never trips it, so an admin can always correct
-- downwards even after lowering the total.
--
-- A direct write by anyone but an admin is refused here with RLS's own 42501
-- before any lookup -- a BEFORE trigger runs ahead of the policy check, and
-- without this the refusal would read "Admin chưa nhập tổng Test Pack" for a
-- project the caller cannot see. `current_user` is `authenticated` for a
-- direct PostgREST write and the owner inside piping_add_reinstatement, so the
-- GS path through the function is unaffected.
create or replace function piping_reinstatement_actual_check()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  cap  int;
  have numeric;
begin
  if tg_op = 'INSERT'
     or new.day is distinct from old.day
     or new.qty > old.qty
     or new.project_id is distinct from old.project_id then
    if current_user in ('anon', 'authenticated') and not is_admin() then
      raise exception 'new row violates row-level security policy for table "piping_reinstatement_actual"'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  if (tg_op = 'INSERT' or new.day is distinct from old.day) and new.day > piping_vn_today() then
    raise exception 'Không nhập được ngày trong tương lai (%)', to_char(new.day, 'DD/MM/YYYY');
  end if;

  if tg_op = 'INSERT' or new.qty > old.qty or new.project_id is distinct from old.project_id then
    perform pg_advisory_xact_lock(hashtext('piping_reinstatement_cap'), hashtext(new.project_id::text));
    select s.total_test_packs into cap from piping_settings s where s.project_id = new.project_id;
    if cap is null then
      raise exception 'Admin chưa nhập tổng Test Pack';
    end if;
    select coalesce(sum(a.qty), 0) into have
    from piping_reinstatement_actual a
    where a.project_id = new.project_id and a.id <> new.id;
    if have + new.qty > cap then
      raise exception 'Vượt tổng Test Pack (đã có % / %)', replace(trim_scale(have)::text, '.', ','), cap;
    end if;
  end if;
  return new;
end;
$$;

-- Manpower actuals: no future day, for every writer.
create or replace function piping_manpower_actual_check()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if (tg_op = 'INSERT' or new.day is distinct from old.day) and new.day > piping_vn_today() then
    raise exception 'Không nhập được ngày trong tương lai (%)', to_char(new.day, 'DD/MM/YYYY');
  end if;
  return new;
end;
$$;

-- Spools: updated_at on a data change; per milestone, a changed actual is
-- checked against today and stamped (a clear included).
create or replace function piping_spools_stamp()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  today date := piping_vn_today();
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.updated_at := now();
  elsif (to_jsonb(new) - array['updated_at', 'ph_actual_by', 'ph_actual_at', 'ih_actual_by',
                               'ih_actual_at', 'iw_actual_by', 'iw_actual_at'])
        is distinct from
        (to_jsonb(old) - array['updated_at', 'ph_actual_by', 'ph_actual_at', 'ih_actual_by',
                               'ih_actual_at', 'iw_actual_by', 'iw_actual_at']) then
    new.updated_at := now();
  end if;

  if new.ph_actual is distinct from (case when tg_op = 'INSERT' then null else old.ph_actual end) then
    if new.ph_actual > today then
      raise exception 'Không nhập được ngày trong tương lai (%)', to_char(new.ph_actual, 'DD/MM/YYYY');
    end if;
    new.ph_actual_by := auth.uid();
    new.ph_actual_at := now();
  end if;
  if new.ih_actual is distinct from (case when tg_op = 'INSERT' then null else old.ih_actual end) then
    if new.ih_actual > today then
      raise exception 'Không nhập được ngày trong tương lai (%)', to_char(new.ih_actual, 'DD/MM/YYYY');
    end if;
    new.ih_actual_by := auth.uid();
    new.ih_actual_at := now();
  end if;
  if new.iw_actual is distinct from (case when tg_op = 'INSERT' then null else old.iw_actual end) then
    if new.iw_actual > today then
      raise exception 'Không nhập được ngày trong tương lai (%)', to_char(new.iw_actual, 'DD/MM/YYYY');
    end if;
    new.iw_actual_by := auth.uid();
    new.iw_actual_at := now();
  end if;
  return new;
end;
$$;

create or replace function piping_notes_stamp()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    new.author := auth.uid();
    new.created_at := now();
    new.updated_by := null;
    new.updated_at := now();
  elsif (to_jsonb(new) - array['author', 'created_at', 'updated_by', 'updated_at'])
        is distinct from
        (to_jsonb(old) - array['author', 'created_at', 'updated_by', 'updated_at']) then
    new.updated_by := auth.uid();
    new.updated_at := now();
  end if;
  return new;
end;
$$;

-- R-6: a group that any plan or actual row names is hidden, never deleted.
-- Skipped when the project itself is going: by the time the cascade reaches
-- the groups the project row is gone (0026 relies on the same ordering), and
-- the group's rows are going with it.
create or replace function piping_manpower_groups_guard_delete()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if exists (select 1 from projects p where p.id = old.project_id)
     and (exists (select 1 from piping_manpower_plan m where m.group_id = old.id)
          or exists (select 1 from piping_manpower_actual m where m.group_id = old.id)) then
    raise exception 'Nhóm "%" đã có dữ liệu, không xoá được -- hãy ẩn nhóm', old.name;
  end if;
  return old;
end;
$$;

create trigger piping_settings_stamp
  before insert or update on piping_settings
  for each row execute function piping_settings_stamp();

-- Postgres fires same-timing triggers in name order: `_check` sorts before
-- `_stamp`, so a refused write never reaches the stamper.
create trigger piping_reinstatement_actual_check
  before insert or update on piping_reinstatement_actual
  for each row execute function piping_reinstatement_actual_check();
create trigger piping_reinstatement_actual_stamp
  before insert or update on piping_reinstatement_actual
  for each row execute function piping_actual_stamp();

create trigger piping_manpower_actual_check
  before insert or update on piping_manpower_actual
  for each row execute function piping_manpower_actual_check();
create trigger piping_manpower_actual_stamp
  before insert or update on piping_manpower_actual
  for each row execute function piping_actual_stamp();

create trigger piping_spools_stamp
  before insert or update on piping_spools
  for each row execute function piping_spools_stamp();

create trigger piping_notes_stamp
  before insert or update on piping_notes
  for each row execute function piping_notes_stamp();

create trigger piping_manpower_groups_guard_delete
  before delete on piping_manpower_groups
  for each row execute function piping_manpower_groups_guard_delete();

-- ---------------------------------------------------------------------------
-- 5. Functions the client calls
-- ---------------------------------------------------------------------------
-- Common to all seven:
--   * security definer, search_path = public, pg_temp; revoked from public
--     and anon, executable by authenticated.
--   * The caller check comes first and raises SQLSTATE 42501 with a
--     Vietnamese message. Field functions admit `is_admin()` or
--     `is_gs() and p_project in (select my_projects())`; import/enable
--     functions admit `is_admin()` only.
--   * Then Piping must be enabled for the project (except piping_enable).
--   * A rule violation raises SQLSTATE P0001 with a Vietnamese message meant
--     to be shown to the user as is. Nothing is written when anything raises:
--     each call is one transaction.
--   * Dates in jsonb are 'YYYY-MM-DD' strings; numbers are JSON numbers.

-- piping_enable(p_project uuid, p_week_start date, p_total_test_packs int,
--               p_late_threshold_days int) returns void
--   Admin only. Creates or re-enables the project's piping_settings row with
--   the given values (p_late_threshold_days null -> 7) and, when the project
--   has no manpower group at all, the defaults Reinstatement, Insulation,
--   Marking (sort 1..3). Re-enabling never re-adds groups the admin renamed
--   or removed. Disabling is a direct update of piping_settings.enabled.
--   Errors: 42501 not admin; P0001 project not found, week start missing,
--   total < 0, threshold outside 0..365.
create or replace function piping_enable(
  p_project             uuid,
  p_week_start          date,
  p_total_test_packs    int,
  p_late_threshold_days int
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  threshold int := coalesce(p_late_threshold_days, 7);
begin
  if not is_admin() then
    raise exception 'Chỉ admin được bật Piping' using errcode = '42501';
  end if;
  if not exists (select 1 from projects where id = p_project) then
    raise exception 'Không tìm thấy dự án';
  end if;
  if p_week_start is null then
    raise exception 'Cần chọn ngày bắt đầu tuần';
  end if;
  if p_total_test_packs is not null and p_total_test_packs < 0 then
    raise exception 'Tổng Test Pack phải lớn hơn hoặc bằng 0';
  end if;
  if threshold < 0 or threshold > 365 then
    raise exception 'Ngưỡng trễ phải từ 0 đến 365 ngày';
  end if;

  insert into piping_settings (project_id, enabled, week_start_date, total_test_packs, late_threshold_days)
  values (p_project, true, p_week_start, p_total_test_packs, threshold)
  on conflict (project_id) do update
    set enabled             = true,
        week_start_date     = excluded.week_start_date,
        total_test_packs    = excluded.total_test_packs,
        late_threshold_days = excluded.late_threshold_days;

  if not exists (select 1 from piping_manpower_groups where project_id = p_project) then
    insert into piping_manpower_groups (project_id, name, sort)
    values (p_project, 'Reinstatement', 1),
           (p_project, 'Insulation', 2),
           (p_project, 'Marking', 3);
  end if;
end;
$$;

-- piping_add_reinstatement(p_project uuid, p_day date, p_qty numeric) returns uuid
--   GS of the project or admin. Appends one Reinstatement entry and returns
--   its id. Rules: p_day not null and <= today (VN); p_qty > 0; the project's
--   total Test Pack is set and the cumulative actual including this entry
--   does not exceed it.
--   Errors: 42501 not allowed; P0001 'Piping chưa được bật cho dự án này',
--   'Thiếu ngày', 'Không nhập được ngày trong tương lai (DD/MM/YYYY)',
--   'Số lượng phải lớn hơn 0', 'Admin chưa nhập tổng Test Pack',
--   'Vượt tổng Test Pack (đã có X / Y)' (X = cumulative before this entry,
--   vi decimal comma; Y = total).
create or replace function piping_add_reinstatement(
  p_project uuid,
  p_day     date,
  p_qty     numeric
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  new_id uuid;
begin
  if not (is_admin() or (is_gs() and p_project in (select my_projects()))) then
    raise exception 'Bạn không có quyền ghi dữ liệu Piping của dự án này' using errcode = '42501';
  end if;
  if not exists (select 1 from piping_settings where project_id = p_project and enabled) then
    raise exception 'Piping chưa được bật cho dự án này';
  end if;
  if p_day is null then
    raise exception 'Thiếu ngày';
  end if;
  if p_day > piping_vn_today() then
    raise exception 'Không nhập được ngày trong tương lai (%)', to_char(p_day, 'DD/MM/YYYY');
  end if;
  if p_qty is null or p_qty <= 0 then
    raise exception 'Số lượng phải lớn hơn 0';
  end if;

  -- The cap and the lock are piping_reinstatement_actual_check's.
  insert into piping_reinstatement_actual (project_id, day, qty)
  values (p_project, p_day, p_qty)
  returning id into new_id;
  return new_id;
end;
$$;

-- piping_set_manpower_actual(p_project uuid, p_day date, p_values jsonb) returns int
--   GS of the project or admin. p_values: [{ "group_id": uuid, "value": number | null }]
--   for one day, each group at most once. Returns the number of rows
--   inserted, changed or deleted.
--   GS (R-7, R-8): a null value is skipped (left empty); a value fills an
--   empty (group, day); re-sending the stored value is a no-op; a different
--   value where one exists raises; a hidden group raises.
--   Admin: a value inserts or overwrites (stamped edited_by/at); null deletes.
--   Rules for both: p_day not null and <= today (VN); every group belongs to
--   the project; value >= 0.
--   Errors: 42501 not allowed; P0001 not enabled, 'Thiếu ngày', future day,
--   'Dữ liệu nhân lực không hợp lệ', 'Một nhóm xuất hiện hai lần',
--   'Nhóm nhân lực không thuộc dự án này', 'Giá trị của nhóm "N" phải lớn hơn
--   hoặc bằng 0', 'Nhóm "N" đã ẩn, không nhập được', 'Nhóm "N" ngày D đã có
--   giá trị (V); chỉ admin được sửa'.
create or replace function piping_set_manpower_actual(
  p_project uuid,
  p_day     date,
  p_values  jsonb
)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  caller_is_admin boolean := is_admin();
  r               record;
  group_name      text;
  group_hidden    boolean;
  existing        numeric;
  touched         int := 0;
  k               int;
begin
  if not (caller_is_admin or (is_gs() and p_project in (select my_projects()))) then
    raise exception 'Bạn không có quyền ghi dữ liệu Piping của dự án này' using errcode = '42501';
  end if;
  if not exists (select 1 from piping_settings where project_id = p_project and enabled) then
    raise exception 'Piping chưa được bật cho dự án này';
  end if;
  if p_day is null then
    raise exception 'Thiếu ngày';
  end if;
  if p_day > piping_vn_today() then
    raise exception 'Không nhập được ngày trong tương lai (%)', to_char(p_day, 'DD/MM/YYYY');
  end if;
  if p_values is null or jsonb_typeof(p_values) <> 'array'
     or exists (
       select 1 from jsonb_array_elements(p_values) e
       where jsonb_typeof(e) <> 'object'
          or coalesce(e->>'group_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          or coalesce(jsonb_typeof(e->'value'), 'null') not in ('number', 'null')
     ) then
    raise exception 'Dữ liệu nhân lực không hợp lệ';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_values) e
    group by lower(e->>'group_id') having count(*) > 1
  ) then
    raise exception 'Một nhóm xuất hiện hai lần';
  end if;

  for r in
    select (e->>'group_id')::uuid as group_id, (e->>'value')::numeric as new_value
    from jsonb_array_elements(p_values) e
  loop
    select g.name, g.hidden into group_name, group_hidden
    from piping_manpower_groups g
    where g.id = r.group_id and g.project_id = p_project;
    if not found then
      raise exception 'Nhóm nhân lực không thuộc dự án này';
    end if;
    if r.new_value is not null and r.new_value < 0 then
      raise exception 'Giá trị của nhóm "%" phải lớn hơn hoặc bằng 0', group_name;
    end if;

    if caller_is_admin then
      if r.new_value is null then
        delete from piping_manpower_actual where group_id = r.group_id and day = p_day;
      else
        insert into piping_manpower_actual (project_id, group_id, day, value)
        values (p_project, r.group_id, p_day, r.new_value)
        on conflict (group_id, day) do update
          set value = excluded.value
          where piping_manpower_actual.value is distinct from excluded.value;
      end if;
      get diagnostics k = row_count;
      touched := touched + k;
    else
      if r.new_value is null then
        continue;
      end if;
      if group_hidden then
        raise exception 'Nhóm "%" đã ẩn, không nhập được', group_name;
      end if;
      insert into piping_manpower_actual (project_id, group_id, day, value)
      values (p_project, r.group_id, p_day, r.new_value)
      on conflict (group_id, day) do nothing;
      get diagnostics k = row_count;
      if k = 0 then
        select m.value into existing
        from piping_manpower_actual m
        where m.group_id = r.group_id and m.day = p_day;
        if existing is distinct from r.new_value then
          raise exception 'Nhóm "%" ngày % đã có giá trị (%); chỉ admin được sửa',
            group_name, to_char(p_day, 'DD/MM/YYYY'), replace(trim_scale(existing)::text, '.', ',');
        end if;
      end if;
      touched := touched + k;
    end if;
  end loop;
  return touched;
end;
$$;

-- piping_set_spool_actuals(p_project uuid, p_changes jsonb,
--                          p_overwrite boolean default false,
--                          p_import_file text default null) returns jsonb
--   GS of the project or admin. p_changes:
--     [{ "spool_id": uuid, "milestone": "ph" | "ih" | "iw", "date": "YYYY-MM-DD" | null }]
--   each (spool_id, milestone) at most once; changes to one spool are judged
--   together. Every date <= today (VN). A null date clears that actual and is
--   admin-only (R-12).
--   Per spool, in this order: not in this project -> 'not_found'; the result
--   would break PH <= IH <= IW over the dates present -> 'order' (Q18A);
--   nothing would change -> 'unchanged'; it would replace an existing,
--   different date and p_overwrite is not true -> 'overwrite_needed' (the
--   confirm-before-overwrite rule, for GS and admin alike); otherwise saved
--   -> 'saved'. Spools not saved are left untouched; the rest are written.
--   Returns [{ "spool_id": uuid, "spool_no": text | null, "status": text }],
--   one element per distinct spool_id, ordered by spool_id.
--   p_import_file not null = an Actual import (§6.3, §8): all or nothing --
--   any 'not_found' / 'order' / 'overwrite_needed' raises and nothing is
--   written; on success one piping_import_log row (kind 'spool_actual',
--   file_name = p_import_file, row_count = number of changes) is written.
--   Errors: 42501 not allowed, or a GS clearing a date; P0001 not enabled,
--   'Dữ liệu ngày thực tế không hợp lệ', 'Một spool và mốc xuất hiện hai lần',
--   future day, 'File vượt quá 20 000 dòng', and in import mode
--   'Spool S: ...' naming the first failing spool.
create or replace function piping_set_spool_actuals(
  p_project     uuid,
  p_changes     jsonb,
  p_overwrite   boolean default false,
  p_import_file text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  caller_is_admin boolean := is_admin();
  results         jsonb := '[]'::jsonb;
  r               record;
  sp              piping_spools%rowtype;
  nph             date;
  nih             date;
  niw             date;
  outcome         text;
  bad             jsonb;
  future_day      date;
begin
  if not (caller_is_admin or (is_gs() and p_project in (select my_projects()))) then
    raise exception 'Bạn không có quyền ghi dữ liệu Piping của dự án này' using errcode = '42501';
  end if;
  if not exists (select 1 from piping_settings where project_id = p_project and enabled) then
    raise exception 'Piping chưa được bật cho dự án này';
  end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'array'
     or exists (
       select 1 from jsonb_array_elements(p_changes) c
       where jsonb_typeof(c) <> 'object'
          or coalesce(c->>'spool_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          or coalesce(c->>'milestone', '') not in ('ph', 'ih', 'iw')
          or not (c ? 'date')
          or (jsonb_typeof(c->'date') <> 'null'
              and (jsonb_typeof(c->'date') <> 'string' or (c->>'date') !~ '^\d{4}-\d{2}-\d{2}$'))
     ) then
    raise exception 'Dữ liệu ngày thực tế không hợp lệ';
  end if;
  if jsonb_array_length(p_changes) > 20000 then
    raise exception 'File vượt quá 20 000 dòng';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_changes) c
    group by lower(c->>'spool_id'), c->>'milestone' having count(*) > 1
  ) then
    raise exception 'Một spool và mốc xuất hiện hai lần';
  end if;
  select max((c->>'date')::date) into future_day
  from jsonb_array_elements(p_changes) c
  where jsonb_typeof(c->'date') = 'string';
  if future_day > piping_vn_today() then
    raise exception 'Không nhập được ngày trong tương lai (%)', to_char(future_day, 'DD/MM/YYYY');
  end if;
  if not caller_is_admin
     and exists (select 1 from jsonb_array_elements(p_changes) c where jsonb_typeof(c->'date') = 'null') then
    raise exception 'Chỉ admin được xoá ngày thực tế' using errcode = '42501';
  end if;

  for r in
    select (c->>'spool_id')::uuid as spool_id, jsonb_object_agg(c->>'milestone', c->'date') as m
    from jsonb_array_elements(p_changes) c
    group by 1
    order by 1
  loop
    select * into sp from piping_spools where id = r.spool_id and project_id = p_project for update;
    if not found then
      results := results || jsonb_build_array(
        jsonb_build_object('spool_id', r.spool_id, 'spool_no', null, 'status', 'not_found'));
      continue;
    end if;

    nph := case when r.m ? 'ph' then (r.m->>'ph')::date else sp.ph_actual end;
    nih := case when r.m ? 'ih' then (r.m->>'ih')::date else sp.ih_actual end;
    niw := case when r.m ? 'iw' then (r.m->>'iw')::date else sp.iw_actual end;

    if nph > nih or nih > niw or nph > niw then
      outcome := 'order';
    elsif nph is not distinct from sp.ph_actual
          and nih is not distinct from sp.ih_actual
          and niw is not distinct from sp.iw_actual then
      outcome := 'unchanged';
    elsif not coalesce(p_overwrite, false)
          and ((nph is not null and sp.ph_actual is not null and nph <> sp.ph_actual)
               or (nih is not null and sp.ih_actual is not null and nih <> sp.ih_actual)
               or (niw is not null and sp.iw_actual is not null and niw <> sp.iw_actual)) then
      outcome := 'overwrite_needed';
    else
      update piping_spools
      set ph_actual = nph, ih_actual = nih, iw_actual = niw
      where id = sp.id;
      outcome := 'saved';
    end if;

    results := results || jsonb_build_array(
      jsonb_build_object('spool_id', sp.id, 'spool_no', sp.spool_no, 'status', outcome));
  end loop;

  if p_import_file is not null then
    select x into bad
    from jsonb_array_elements(results) x
    where x->>'status' in ('not_found', 'order', 'overwrite_needed')
    limit 1;
    if bad is not null then
      raise exception 'Spool %: %. Không có dữ liệu nào được ghi.',
        coalesce(bad->>'spool_no', bad->>'spool_id'),
        case bad->>'status'
          when 'not_found' then 'không còn trong dự án (kế hoạch vừa được nhập lại?)'
          when 'order' then 'ngày thực tế phải theo thứ tự Painting Handover ≤ Insulation Handover ≤ Insulation Work'
          else 'đã có ngày thực tế khác, cần xác nhận ghi đè'
        end;
    end if;
    insert into piping_import_log (project_id, kind, file_name, row_count, summary, imported_by)
    values (
      p_project, 'spool_actual', btrim(p_import_file), jsonb_array_length(p_changes),
      jsonb_build_object(
        'spools',    jsonb_array_length(results),
        'saved',     (select count(*) from jsonb_array_elements(results) x where x->>'status' = 'saved'),
        'unchanged', (select count(*) from jsonb_array_elements(results) x where x->>'status' = 'unchanged'),
        'overwrite', coalesce(p_overwrite, false)
      ),
      auth.uid()
    );
  end if;

  return results;
end;
$$;

-- piping_replace_reinstatement_plan(p_project uuid, p_rows jsonb, p_file_name text,
--                                   p_summary jsonb default '{}') returns jsonb
--   Admin only. Replaces the project's whole Reinstatement plan with p_rows:
--     [{ "day": "YYYY-MM-DD", "plan_qty": number >= 0 }]  (each day once, <= 20 000 rows)
--   and writes one piping_import_log row (kind 'reinstatement_plan'). Its
--   summary is p_summary (the client's own notes, an object) merged with the
--   counts computed here: rows, added, changed, removed (by day).
--   Returns that summary plus "log_id".
--   Errors: 42501 not admin; P0001 not enabled, 'Dữ liệu kế hoạch không hợp
--   lệ' (with the 1-based element number), 'Ngày D lặp lại trong file',
--   'File vượt quá 20 000 dòng'.
create or replace function piping_replace_reinstatement_plan(
  p_project   uuid,
  p_rows      jsonb,
  p_file_name text,
  p_summary   jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  n_rows    int;
  n_added   int;
  n_changed int;
  n_removed int;
  bad_row   bigint;
  dup_day   text;
  summ      jsonb;
  log_id    uuid;
begin
  if not is_admin() then
    raise exception 'Chỉ admin được nhập kế hoạch' using errcode = '42501';
  end if;
  -- FOR UPDATE: two imports into one project queue rather than interleave.
  perform 1 from piping_settings where project_id = p_project and enabled for update;
  if not found then
    raise exception 'Piping chưa được bật cho dự án này';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array'
     or (p_summary is not null and jsonb_typeof(p_summary) <> 'object') then
    raise exception 'Dữ liệu kế hoạch không hợp lệ';
  end if;
  n_rows := jsonb_array_length(p_rows);
  if n_rows > 20000 then
    raise exception 'File vượt quá 20 000 dòng';
  end if;
  select min(e.ord) into bad_row
  from jsonb_array_elements(p_rows) with ordinality as e(j, ord)
  where jsonb_typeof(e.j) <> 'object'
     or coalesce(e.j->>'day', '') !~ '^\d{4}-\d{2}-\d{2}$'
     or case when jsonb_typeof(e.j->'plan_qty') = 'number'
             then (e.j->>'plan_qty')::numeric < 0 else true end;
  if bad_row is not null then
    raise exception 'Dữ liệu kế hoạch không hợp lệ (phần tử %)', bad_row;
  end if;
  select e->>'day' into dup_day
  from jsonb_array_elements(p_rows) e
  group by e->>'day' having count(*) > 1
  order by 1 limit 1;
  if dup_day is not null then
    raise exception 'Ngày % lặp lại trong file', to_char(dup_day::date, 'DD/MM/YYYY');
  end if;

  with new_rows as (
    select (e->>'day')::date as day, (e->>'plan_qty')::numeric as plan_qty
    from jsonb_array_elements(p_rows) e
  ), old_rows as (
    select p.day, p.plan_qty from piping_reinstatement_plan p where p.project_id = p_project
  )
  select count(*) filter (where o.day is null),
         count(*) filter (where n.day is not null and o.day is not null and n.plan_qty <> o.plan_qty),
         count(*) filter (where n.day is null)
    into n_added, n_changed, n_removed
  from new_rows n full join old_rows o on o.day = n.day;

  delete from piping_reinstatement_plan where project_id = p_project;
  insert into piping_reinstatement_plan (project_id, day, plan_qty)
  select p_project, (e->>'day')::date, (e->>'plan_qty')::numeric
  from jsonb_array_elements(p_rows) e;

  summ := coalesce(p_summary, '{}'::jsonb) || jsonb_build_object(
    'rows', n_rows, 'added', n_added, 'changed', n_changed, 'removed', n_removed);
  insert into piping_import_log (project_id, kind, file_name, row_count, summary, imported_by)
  values (p_project, 'reinstatement_plan', coalesce(btrim(p_file_name), ''), n_rows, summ, auth.uid())
  returning id into log_id;
  return summ || jsonb_build_object('log_id', log_id);
end;
$$;

-- piping_replace_manpower_plan(p_project uuid, p_rows jsonb, p_file_name text,
--                              p_summary jsonb default '{}') returns jsonb
--   Admin only. Replaces the project's whole Manpower plan with p_rows:
--     [{ "group_id": uuid, "day": "YYYY-MM-DD", "value": number >= 0 }]
--   each (group_id, day) once, every group of this project (hidden groups
--   included), <= 20 000 rows. An empty cell in the file is simply no row.
--   Writes one piping_import_log row (kind 'manpower_plan'); summary =
--   p_summary merged with rows, added, changed, removed (by group and day).
--   Returns that summary plus "log_id".
--   Errors: 42501 not admin; P0001 not enabled, 'Dữ liệu kế hoạch không hợp
--   lệ (phần tử N)', 'Nhóm nhân lực không thuộc dự án này', 'Ngày D của một
--   nhóm lặp lại trong file', 'File vượt quá 20 000 dòng'.
create or replace function piping_replace_manpower_plan(
  p_project   uuid,
  p_rows      jsonb,
  p_file_name text,
  p_summary   jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  n_rows    int;
  n_added   int;
  n_changed int;
  n_removed int;
  bad_row   bigint;
  dup_day   text;
  summ      jsonb;
  log_id    uuid;
begin
  if not is_admin() then
    raise exception 'Chỉ admin được nhập kế hoạch' using errcode = '42501';
  end if;
  perform 1 from piping_settings where project_id = p_project and enabled for update;
  if not found then
    raise exception 'Piping chưa được bật cho dự án này';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array'
     or (p_summary is not null and jsonb_typeof(p_summary) <> 'object') then
    raise exception 'Dữ liệu kế hoạch không hợp lệ';
  end if;
  n_rows := jsonb_array_length(p_rows);
  if n_rows > 20000 then
    raise exception 'File vượt quá 20 000 dòng';
  end if;
  select min(e.ord) into bad_row
  from jsonb_array_elements(p_rows) with ordinality as e(j, ord)
  where jsonb_typeof(e.j) <> 'object'
     or coalesce(e.j->>'group_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or coalesce(e.j->>'day', '') !~ '^\d{4}-\d{2}-\d{2}$'
     or case when jsonb_typeof(e.j->'value') = 'number'
             then (e.j->>'value')::numeric < 0 else true end;
  if bad_row is not null then
    raise exception 'Dữ liệu kế hoạch không hợp lệ (phần tử %)', bad_row;
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_rows) e
    where not exists (
      select 1 from piping_manpower_groups g
      where g.project_id = p_project and g.id = (e->>'group_id')::uuid
    )
  ) then
    raise exception 'Nhóm nhân lực không thuộc dự án này';
  end if;
  select e->>'day' into dup_day
  from jsonb_array_elements(p_rows) e
  group by lower(e->>'group_id'), e->>'day' having count(*) > 1
  order by 1 limit 1;
  if dup_day is not null then
    raise exception 'Ngày % của một nhóm lặp lại trong file', to_char(dup_day::date, 'DD/MM/YYYY');
  end if;

  with new_rows as (
    select (e->>'group_id')::uuid as group_id, (e->>'day')::date as day, (e->>'value')::numeric as value
    from jsonb_array_elements(p_rows) e
  ), old_rows as (
    select m.group_id, m.day, m.value from piping_manpower_plan m where m.project_id = p_project
  )
  select count(*) filter (where o.day is null),
         count(*) filter (where n.day is not null and o.day is not null and n.value <> o.value),
         count(*) filter (where n.day is null)
    into n_added, n_changed, n_removed
  from new_rows n full join old_rows o on o.group_id = n.group_id and o.day = n.day;

  delete from piping_manpower_plan where project_id = p_project;
  insert into piping_manpower_plan (project_id, group_id, day, value)
  select p_project, (e->>'group_id')::uuid, (e->>'day')::date, (e->>'value')::numeric
  from jsonb_array_elements(p_rows) e;

  summ := coalesce(p_summary, '{}'::jsonb) || jsonb_build_object(
    'rows', n_rows, 'added', n_added, 'changed', n_changed, 'removed', n_removed);
  insert into piping_import_log (project_id, kind, file_name, row_count, summary, imported_by)
  values (p_project, 'manpower_plan', coalesce(btrim(p_file_name), ''), n_rows, summ, auth.uid())
  returning id into log_id;
  return summ || jsonb_build_object('log_id', log_id);
end;
$$;

-- piping_replace_spools(p_project uuid, p_rows jsonb, p_file_name text,
--                       p_summary jsonb default '{}') returns jsonb
--   Admin only. Replaces the project's spools with p_rows, in file order:
--     [{ "spool_no": text (required), "line_no", "insu_type", "drawing_no",
--        "test_package_no", "painting_system": text | null,
--        "ph_plan", "ih_plan", "iw_plan": "YYYY-MM-DD" | null,
--        "extra": { "<extra column label>": text } | null }]
--   (<= 20 000 rows). Texts are trimmed, blank -> null; seq = 1-based position.
--   Matching (R-10): old and new rows pair on spool_no (trimmed, case-
--   sensitive) and, within one spool_no, by order -- old by seq, new by file
--   position. A matched spool keeps its id, actuals, stamps and notes and
--   takes the new master fields, plan dates, extra and seq. An unmatched new
--   row is inserted. An old spool left unmatched is DELETED with its actuals
--   and notes (Q19A). Plan-date order and duplicate spool_no are not errors
--   (Q14C, Q15B). Writes one piping_import_log row (kind 'spool_plan');
--   summary = p_summary merged with rows, added, matched, changed (matched
--   with any field different), removed, removed_with_actuals.
--   Returns that summary plus "log_id".
--   Errors: 42501 not admin; P0001 not enabled, 'Dữ liệu kế hoạch Insulation
--   không hợp lệ (dòng N)' (missing SpoolNo, bad date, extra not an object),
--   'File vượt quá 20 000 dòng'.
create or replace function piping_replace_spools(
  p_project   uuid,
  p_rows      jsonb,
  p_file_name text,
  p_summary   jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  n_rows           int;
  n_added          int;
  n_matched        int;
  n_changed        int;
  n_removed        int;
  n_removed_actual int;
  bad_row          bigint;
  summ             jsonb;
  log_id           uuid;
begin
  if not is_admin() then
    raise exception 'Chỉ admin được nhập kế hoạch' using errcode = '42501';
  end if;
  perform 1 from piping_settings where project_id = p_project and enabled for update;
  if not found then
    raise exception 'Piping chưa được bật cho dự án này';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array'
     or (p_summary is not null and jsonb_typeof(p_summary) <> 'object') then
    raise exception 'Dữ liệu kế hoạch Insulation không hợp lệ';
  end if;
  n_rows := jsonb_array_length(p_rows);
  if n_rows > 20000 then
    raise exception 'File vượt quá 20 000 dòng';
  end if;
  select min(e.ord) into bad_row
  from jsonb_array_elements(p_rows) with ordinality as e(j, ord)
  where jsonb_typeof(e.j) <> 'object'
     or coalesce(btrim(e.j->>'spool_no'), '') = ''
     or coalesce(e.j->>'ph_plan', '') !~ '^(\d{4}-\d{2}-\d{2})?$'
     or coalesce(e.j->>'ih_plan', '') !~ '^(\d{4}-\d{2}-\d{2})?$'
     or coalesce(e.j->>'iw_plan', '') !~ '^(\d{4}-\d{2}-\d{2})?$'
     or coalesce(jsonb_typeof(e.j->'extra'), 'null') not in ('object', 'null');
  if bad_row is not null then
    raise exception 'Dữ liệu kế hoạch Insulation không hợp lệ (dòng %)', bad_row;
  end if;

  with src as (
    select e.ord::int as ord,
           btrim(e.j->>'spool_no') as spool_no,
           nullif(btrim(e.j->>'line_no'), '') as line_no,
           nullif(btrim(e.j->>'insu_type'), '') as insu_type,
           nullif(btrim(e.j->>'drawing_no'), '') as drawing_no,
           nullif(btrim(e.j->>'test_package_no'), '') as test_package_no,
           nullif(btrim(e.j->>'painting_system'), '') as painting_system,
           nullif(e.j->>'ph_plan', '')::date as ph_plan,
           nullif(e.j->>'ih_plan', '')::date as ih_plan,
           nullif(e.j->>'iw_plan', '')::date as iw_plan,
           case when jsonb_typeof(e.j->'extra') = 'object'
                then jsonb_strip_nulls(e.j->'extra') else '{}'::jsonb end as extra
    from jsonb_array_elements(p_rows) with ordinality as e(j, ord)
  ), new_ranked as (
    select s.*, row_number() over (partition by s.spool_no order by s.ord) as rk
    from src s
  ), old_ranked as (
    select p.id, p.spool_no, p.line_no, p.insu_type, p.drawing_no, p.test_package_no,
           p.painting_system, p.extra, p.ph_plan, p.ih_plan, p.iw_plan,
           row_number() over (partition by p.spool_no order by p.seq, p.id) as rk
    from piping_spools p
    where p.project_id = p_project
  ), pairs as (
    select n.*, o.id as old_id,
           (o.id is not null
            and (o.line_no, o.insu_type, o.drawing_no, o.test_package_no, o.painting_system,
                 o.extra, o.ph_plan, o.ih_plan, o.iw_plan)
                is distinct from
                (n.line_no, n.insu_type, n.drawing_no, n.test_package_no, n.painting_system,
                 n.extra, n.ph_plan, n.ih_plan, n.iw_plan)) as changed
    from new_ranked n
    left join old_ranked o on o.spool_no = n.spool_no and o.rk = n.rk
  ), removed as (
    delete from piping_spools p
    where p.project_id = p_project
      and not exists (select 1 from pairs x where x.old_id = p.id)
    returning (p.ph_actual is not null or p.ih_actual is not null or p.iw_actual is not null) as had_actual
  ), matched as (
    update piping_spools p
    set seq             = x.ord,
        line_no         = x.line_no,
        insu_type       = x.insu_type,
        drawing_no      = x.drawing_no,
        test_package_no = x.test_package_no,
        painting_system = x.painting_system,
        extra           = x.extra,
        ph_plan         = x.ph_plan,
        ih_plan         = x.ih_plan,
        iw_plan         = x.iw_plan
    from pairs x
    where x.old_id = p.id
    returning x.changed
  ), added as (
    insert into piping_spools (project_id, seq, spool_no, line_no, insu_type, drawing_no,
                               test_package_no, painting_system, extra, ph_plan, ih_plan, iw_plan)
    select p_project, x.ord, x.spool_no, x.line_no, x.insu_type, x.drawing_no,
           x.test_package_no, x.painting_system, x.extra, x.ph_plan, x.ih_plan, x.iw_plan
    from pairs x
    where x.old_id is null
    returning 1
  )
  select (select count(*) from added),
         (select count(*) from matched),
         (select count(*) from matched where changed),
         (select count(*) from removed),
         (select count(*) from removed where had_actual)
    into n_added, n_matched, n_changed, n_removed, n_removed_actual;

  summ := coalesce(p_summary, '{}'::jsonb) || jsonb_build_object(
    'rows', n_rows, 'added', n_added, 'matched', n_matched, 'changed', n_changed,
    'removed', n_removed, 'removed_with_actuals', n_removed_actual);
  insert into piping_import_log (project_id, kind, file_name, row_count, summary, imported_by)
  values (p_project, 'spool_plan', coalesce(btrim(p_file_name), ''), n_rows, summ, auth.uid())
  returning id into log_id;
  return summ || jsonb_build_object('log_id', log_id);
end;
$$;

revoke all on function piping_enable(uuid, date, int, int) from public, anon;
grant execute on function piping_enable(uuid, date, int, int) to authenticated;
revoke all on function piping_add_reinstatement(uuid, date, numeric) from public, anon;
grant execute on function piping_add_reinstatement(uuid, date, numeric) to authenticated;
revoke all on function piping_set_manpower_actual(uuid, date, jsonb) from public, anon;
grant execute on function piping_set_manpower_actual(uuid, date, jsonb) to authenticated;
revoke all on function piping_set_spool_actuals(uuid, jsonb, boolean, text) from public, anon;
grant execute on function piping_set_spool_actuals(uuid, jsonb, boolean, text) to authenticated;
revoke all on function piping_replace_reinstatement_plan(uuid, jsonb, text, jsonb) from public, anon;
grant execute on function piping_replace_reinstatement_plan(uuid, jsonb, text, jsonb) to authenticated;
revoke all on function piping_replace_manpower_plan(uuid, jsonb, text, jsonb) from public, anon;
grant execute on function piping_replace_manpower_plan(uuid, jsonb, text, jsonb) to authenticated;
revoke all on function piping_replace_spools(uuid, jsonb, text, jsonb) from public, anon;
grant execute on function piping_replace_spools(uuid, jsonb, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Prove it
-- ---------------------------------------------------------------------------
do $$
declare
  n          int;
  t          text;
  f          text;
  member_tables text[] := array[
    'piping_settings', 'piping_reinstatement_plan', 'piping_reinstatement_actual',
    'piping_manpower_groups', 'piping_manpower_plan', 'piping_manpower_actual',
    'piping_spools', 'piping_spool_columns'];
  admin_tables  text[] := array['piping_notes', 'piping_import_log'];
  field_rpcs    text[] := array['piping_add_reinstatement', 'piping_set_manpower_actual',
                                'piping_set_spool_actuals'];
  admin_rpcs    text[] := array['piping_enable', 'piping_replace_reinstatement_plan',
                                'piping_replace_manpower_plan', 'piping_replace_spools'];
  rpc_sigs      text[] := array[
    'public.piping_enable(uuid, date, integer, integer)',
    'public.piping_add_reinstatement(uuid, date, numeric)',
    'public.piping_set_manpower_actual(uuid, date, jsonb)',
    'public.piping_set_spool_actuals(uuid, jsonb, boolean, text)',
    'public.piping_replace_reinstatement_plan(uuid, jsonb, text, jsonb)',
    'public.piping_replace_manpower_plan(uuid, jsonb, text, jsonb)',
    'public.piping_replace_spools(uuid, jsonb, text, jsonb)'];
begin
  -- Ten tables, RLS on every one.
  select count(*) into n from pg_class
  where relnamespace = 'public'::regnamespace and relkind = 'r' and relrowsecurity
    and relname = any (member_tables || admin_tables);
  if n <> 10 then
    raise exception '0038: % of the 10 piping tables exist with row level security enabled', n;
  end if;

  -- Member-readable tables: exactly admin_all (ALL, is_admin) + member_read
  -- (SELECT, my_projects). A third policy is the failure this is here for.
  foreach t in array member_tables loop
    select count(*) into n from pg_policies where schemaname = 'public' and tablename = t;
    if n <> 2 then
      raise exception '0038: % carries % policies, expected 2', t, n;
    end if;
    if not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = t and policyname = t || '_admin_all'
        and cmd = 'ALL' and qual like '%is_admin()%' and with_check like '%is_admin()%'
    ) then
      raise exception '0038: %_admin_all is missing, not FOR ALL, or not is_admin()', t;
    end if;
    if not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = t and policyname = t || '_member_read'
        and cmd = 'SELECT' and qual like '%my_projects()%'
    ) then
      raise exception '0038: %_member_read is missing, not SELECT-only, or not through my_projects()', t;
    end if;
  end loop;

  -- Notes and the import log: admin_all and nothing else (§0, §9).
  foreach t in array admin_tables loop
    select count(*) into n from pg_policies where schemaname = 'public' and tablename = t;
    if n <> 1 or not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = t and policyname = t || '_admin_all'
        and cmd = 'ALL' and qual like '%is_admin()%'
    ) then
      raise exception '0038: % must carry exactly its admin_all policy (found % policies)', t, n;
    end if;
  end loop;

  -- anon holds nothing on any piping table.
  foreach t in array member_tables || admin_tables loop
    if has_table_privilege('anon', 'public.' || t, 'select')
       or has_table_privilege('anon', 'public.' || t, 'insert')
       or has_table_privilege('anon', 'public.' || t, 'update')
       or has_table_privilege('anon', 'public.' || t, 'delete') then
      raise exception '0038: anon still holds a privilege on %', t;
    end if;
  end loop;

  -- The seven client functions: one overload each, definer, pinned, not
  -- executable by anon, executable by authenticated.
  select count(*) into n from pg_proc
  where pronamespace = 'public'::regnamespace
    and proname = any (field_rpcs || admin_rpcs)
    and prosecdef and proconfig @> array['search_path=public, pg_temp'];
  if n <> 7 then
    raise exception '0038: % of the 7 piping functions are a single pinned security definer overload', n;
  end if;
  select count(*) into n from pg_proc
  where pronamespace = 'public'::regnamespace and proname = any (field_rpcs || admin_rpcs);
  if n <> 7 then
    raise exception '0038: expected exactly 7 piping function overloads, found %', n;
  end if;
  foreach f in array rpc_sigs loop
    if has_function_privilege('anon', f, 'execute') then
      raise exception '0038: anon can execute %', f;
    end if;
    if not has_function_privilege('authenticated', f, 'execute') then
      raise exception '0038: authenticated cannot execute %', f;
    end if;
  end loop;
  if has_function_privilege('anon', 'public.piping_vn_today()', 'execute') then
    raise exception '0038: anon can execute piping_vn_today()';
  end if;

  -- Each function checks its caller itself, with 42501.
  select count(*) into n from pg_proc
  where pronamespace = 'public'::regnamespace and proname = any (field_rpcs)
    and prosrc like '%is_admin()%'
    and prosrc like '%or (is_gs() and p_project in (select my_projects()))%'
    and prosrc like '%errcode = ''42501''%';
  if n <> 3 then
    raise exception '0038: % of the 3 field functions check is_admin() or (is_gs() and my_projects()) with 42501', n;
  end if;
  select count(*) into n from pg_proc
  where pronamespace = 'public'::regnamespace and proname = any (admin_rpcs)
    and prosrc like '%if not is_admin() then%'
    and prosrc like '%errcode = ''42501''%'
    and prosrc not like '%is_gs()%';
  if n <> 4 then
    raise exception '0038: % of the 4 admin functions are admin-only with 42501', n;
  end if;

  -- And really refuses: a migration session has no caller, so every one of
  -- them must raise 42501 before touching anything.
  begin
    perform piping_enable(gen_random_uuid(), current_date, null, 7);
    raise exception '0038: piping_enable ran with no caller';
  exception when insufficient_privilege then null;
  end;
  begin
    perform piping_add_reinstatement(gen_random_uuid(), current_date, 1);
    raise exception '0038: piping_add_reinstatement ran with no caller';
  exception when insufficient_privilege then null;
  end;
  begin
    perform piping_set_manpower_actual(gen_random_uuid(), current_date, '[]'::jsonb);
    raise exception '0038: piping_set_manpower_actual ran with no caller';
  exception when insufficient_privilege then null;
  end;
  begin
    perform piping_set_spool_actuals(gen_random_uuid(), '[]'::jsonb, false, null);
    raise exception '0038: piping_set_spool_actuals ran with no caller';
  exception when insufficient_privilege then null;
  end;
  begin
    perform piping_replace_reinstatement_plan(gen_random_uuid(), '[]'::jsonb, 'x.xlsx', '{}'::jsonb);
    raise exception '0038: piping_replace_reinstatement_plan ran with no caller';
  exception when insufficient_privilege then null;
  end;
  begin
    perform piping_replace_manpower_plan(gen_random_uuid(), '[]'::jsonb, 'x.xlsx', '{}'::jsonb);
    raise exception '0038: piping_replace_manpower_plan ran with no caller';
  exception when insufficient_privilege then null;
  end;
  begin
    perform piping_replace_spools(gen_random_uuid(), '[]'::jsonb, 'x.xlsx', '{}'::jsonb);
    raise exception '0038: piping_replace_spools ran with no caller';
  exception when insufficient_privilege then null;
  end;

  -- Today means Vietnam's calendar day.
  if piping_vn_today() is distinct from (now() at time zone 'Asia/Ho_Chi_Minh')::date then
    raise exception '0038: piping_vn_today() is not the Asia/Ho_Chi_Minh calendar day';
  end if;

  -- Every trigger function pins its search_path.
  select count(*) into n from pg_proc
  where pronamespace = 'public'::regnamespace
    and proname in ('piping_vn_today', 'piping_settings_stamp', 'piping_actual_stamp',
                    'piping_reinstatement_actual_check', 'piping_manpower_actual_check',
                    'piping_spools_stamp', 'piping_notes_stamp', 'piping_manpower_groups_guard_delete')
    and not prosecdef and proconfig @> array['search_path=public, pg_temp'];
  if n <> 8 then
    raise exception '0038: % of the 8 piping helper/trigger functions are pinned security invoker', n;
  end if;

  -- The eight triggers, enabled, on the right tables.
  select count(*) into n from pg_trigger
  where not tgisinternal and tgenabled = 'O'
    and (tgrelid, tgname) in (
      ('public.piping_settings'::regclass, 'piping_settings_stamp'),
      ('public.piping_reinstatement_actual'::regclass, 'piping_reinstatement_actual_check'),
      ('public.piping_reinstatement_actual'::regclass, 'piping_reinstatement_actual_stamp'),
      ('public.piping_manpower_actual'::regclass, 'piping_manpower_actual_check'),
      ('public.piping_manpower_actual'::regclass, 'piping_manpower_actual_stamp'),
      ('public.piping_spools'::regclass, 'piping_spools_stamp'),
      ('public.piping_notes'::regclass, 'piping_notes_stamp'),
      ('public.piping_manpower_groups'::regclass, 'piping_manpower_groups_guard_delete'));
  if n <> 8 then
    raise exception '0038: % of the 8 piping triggers are present and enabled', n;
  end if;
  -- The cap is in the trigger, refuses direct non-admin writes first, and locks.
  if not exists (
    select 1 from pg_proc
    where pronamespace = 'public'::regnamespace and proname = 'piping_reinstatement_actual_check'
      and prosrc like '%current_user in (''anon'', ''authenticated'') and not is_admin()%'
      and prosrc like '%pg_advisory_xact_lock%'
      and prosrc like '%Vượt tổng Test Pack (đã có % / %)%'
      and prosrc like '%Admin chưa nhập tổng Test Pack%'
  ) then
    raise exception '0038: piping_reinstatement_actual_check lost its guard, its lock or its messages';
  end if;

  -- The named actor foreign keys the API embeds, all on delete set null.
  select count(*) into n from pg_constraint
  where contype = 'f' and confdeltype = 'n'
    and conname in (
      'piping_settings_created_by_fkey', 'piping_settings_updated_by_fkey',
      'piping_reinstatement_actual_created_by_fkey', 'piping_reinstatement_actual_edited_by_fkey',
      'piping_manpower_actual_created_by_fkey', 'piping_manpower_actual_edited_by_fkey',
      'piping_spools_ph_actual_by_fkey', 'piping_spools_ih_actual_by_fkey',
      'piping_spools_iw_actual_by_fkey', 'piping_notes_author_fkey',
      'piping_notes_updated_by_fkey', 'piping_import_log_imported_by_fkey');
  if n <> 12 then
    raise exception '0038: % of the 12 named actor foreign keys exist with on delete set null', n;
  end if;
  -- verify_schema.sql check 21: no bare ON DELETE (no action) anywhere.
  select count(*) into n from pg_constraint c join pg_class r on r.oid = c.conrelid
  where c.contype = 'f' and c.confdeltype = 'a' and r.relname like 'piping\_%';
  if n <> 0 then
    raise exception '0038: % piping foreign key(s) have a bare ON DELETE', n;
  end if;

  -- The actual-order rule (Q18A) is a table constraint over all three pairs.
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.piping_spools'::regclass and conname = 'piping_spools_actual_order'
      and pg_get_constraintdef(oid) like '%ph_actual <= ih_actual%'
      and pg_get_constraintdef(oid) like '%ih_actual <= iw_actual%'
      and pg_get_constraintdef(oid) like '%ph_actual <= iw_actual%'
  ) then
    raise exception '0038: piping_spools_actual_order is missing or incomplete';
  end if;
  -- The lookups the screens and the import need.
  select count(*) into n from pg_indexes
  where schemaname = 'public' and indexname in (
    'piping_reinstatement_actual_project_day_idx', 'piping_manpower_plan_project_day_idx',
    'piping_manpower_actual_project_day_idx', 'piping_spools_project_spool_no_idx',
    'piping_spools_project_seq_idx', 'piping_manpower_groups_name_key',
    'piping_spool_columns_label_key');
  if n <> 7 then
    raise exception '0038: % of the 7 piping indexes exist', n;
  end if;
end $$;
