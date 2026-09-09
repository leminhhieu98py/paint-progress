-- KPI Plan vs Actual — Feedback Rv5, item 9 (spec §B3, rules RV5-22…RV5-29).
--
-- Linh's `KPI.xlsx` puts one row per coat, with a start date and an end date
-- the admin types, and spreads a planned area flat over the days between them:
--
--   Tên sàn      Công đoạn   Ngày bắt đầu  Ngày kết thúc  Số ngày  Diện tích
--   Cellar Deck  Công đoạn 1  2026-09-01    2026-09-12     =D-C+1   3300
--                                                          (12)     -> 275/day
--
-- This table is those four typed columns. Everything else on the chart — the
-- daily rate, the actual m², the two S-curves — is computed from data the
-- schema already holds, in `src/domain/kpi.ts`. Nothing is stored twice.
--
-- Modelled on `cell_states` (0024), the table in this schema most like it: a
-- narrow row hanging off a `deck_stages` row, denormalising the work and the
-- deck so RLS reads them without a join, with a trigger that refuses a row
-- whose denormalised columns lie.
--
-- ---------------------------------------------------------------------------
-- Why the key is the coat alone
-- ---------------------------------------------------------------------------
-- A `deck_stages` row has belonged to exactly one (work_id, deck_id) since
-- 0028 (`deck_stages_work_id_deck_id_seq_key`), so `stage_id` already
-- determines the whole triple. A composite primary key over
-- (work_id, deck_id, stage_id) would add no uniqueness and would let two rows
-- disagree about which work a coat is in; the trigger below closes that door
-- instead. It also means the plan dies with the coat, via the cascade, which
-- is the behaviour a plan for a deleted coat wants.
--
-- ---------------------------------------------------------------------------
-- Why `work_decks.deadline` (0031) could not hold this
-- ---------------------------------------------------------------------------
-- That column is ONE date for a whole (work, deck) — "hạn hoàn thành" — and a
-- KPI window is a start AND an end per coat. Four coats on one deck have four
-- windows that overlap (in the workbook above, Công đoạn 4 starts on 09-05
-- while Công đoạn 1 still runs to 09-12). 0031 is left exactly as it is.
create table stage_plans (
  -- One plan window per coat. A deck_stages row already belongs to exactly
  -- one (work, deck), so the coat alone is the key.
  stage_id uuid primary key references deck_stages on delete cascade,
  -- Denormalised so RLS reads the work without a join, exactly as
  -- cell_states denormalises deck_id (0024). A trigger asserts they agree.
  work_id  uuid not null references works on delete cascade,
  deck_id  uuid not null references decks on delete cascade,
  -- `date`, not timestamptz, for the same reason work_decks.deadline is one:
  -- nobody plans a coat to the minute, and Số ngày counts whole calendar days
  -- in Vietnam time. RV5-22 / Linh Q6: "Chia đúng đều không quan tâm chủ nhật
  -- hay lễ" — Sundays and holidays are ordinary working days here, so there is
  -- no calendar to store and no working-day column to keep.
  start_date date not null,
  end_date   date not null,
  -- Null means "use the figure the system computes for start_date"
  -- (RV5-23). A number is the admin's override, and is never recomputed.
  --
  -- Nullable and unconstrained in scale on purpose: null is a real value here
  -- (defer to the computed remaining area) and is NOT the same as 0, which is
  -- a deliberate override saying this coat plans no area at all. The API and
  -- the entry screen keep that distinction; see `clearStagePlanArea`.
  planned_area_m2 numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint stage_plans_window check (end_date >= start_date),
  constraint stage_plans_area_positive check (planned_area_m2 is null or planned_area_m2 >= 0)
);
create index stage_plans_work_id_idx on stage_plans (work_id);
create index stage_plans_deck_id_idx on stage_plans (deck_id);

comment on table stage_plans is
  'KPI plan window for one coat: ngày bắt đầu, ngày kết thúc, and the planned area to spread flat across them. planned_area_m2 null: use the area the system computes as remaining on start_date.';
comment on column stage_plans.planned_area_m2 is
  'Diện tích kế hoạch. Null: hệ thống tự tính từ ngày bắt đầu. A number is the admin''s override and is never recomputed (RV5-23).';

-- ---------------------------------------------------------------------------
-- RLS: the admin writes, and admin/gs/viewer all read (RV5-28, RV5-29)
-- ---------------------------------------------------------------------------
-- No new predicate is needed. 0028 established that `my_works()` is passed by
-- both `gs` and `viewer` while `is_gs()` is what separates them (see the
-- comment above `cell_states_member_insert` there). So "admin writes; admin,
-- gs and viewer read" is exactly the shape `deck_stages` already has: an
-- `is_admin()` for-all policy plus a member read through `my_works()`, and no
-- member write policy at all.
alter table stage_plans enable row level security;
create policy stage_plans_admin_all on stage_plans
  for all using (is_admin()) with check (is_admin());
create policy stage_plans_member_read on stage_plans
  for select using (work_id in (select my_works()));

-- ---------------------------------------------------------------------------
-- The denormalised columns may not lie
-- ---------------------------------------------------------------------------
-- Same job and same shape as `assert_cell_state_consistent` (0024): the
-- denormalised (work_id, deck_id) exist so RLS can decide without a join, and
-- a row whose pair disagrees with the coat it points at would be readable by
-- the wrong work's members. `security invoker` and a pinned `search_path`, as
-- every trigger function in this schema has since 0009.
create or replace function assert_stage_plan_consistent()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  stage_work uuid;
  stage_deck uuid;
begin
  select s.work_id, s.deck_id into stage_work, stage_deck
  from deck_stages s where s.id = new.stage_id;
  if stage_work is null then
    raise exception 'stage_plans.stage_id % is not a deck_stages row', new.stage_id;
  end if;
  if stage_work is distinct from new.work_id or stage_deck is distinct from new.deck_id then
    raise exception 'stage_plans (work %, deck %) does not match stage %''s (work %, deck %)',
      new.work_id, new.deck_id, new.stage_id, stage_work, stage_deck;
  end if;
  return new;
end;
$$;

-- `updated_at` is the admin's own edit stamp, not an audit trail: only the
-- admin can write this table, so there is nobody to attribute a change to.
-- Stamped in a trigger rather than left to the client for the reason 0011
-- moved the cell stamps into one: a client clock is not a fact.
create or replace function set_stage_plan_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger stage_plans_assert_consistent
  before insert or update on stage_plans
  for each row execute function assert_stage_plan_consistent();
create trigger stage_plans_set_updated_at
  before insert or update on stage_plans
  for each row execute function set_stage_plan_updated_at();

-- No realtime publication: nothing subscribes to plans. The KPI screen reads
-- them once per load, and the admin who edits them is the only writer.

-- ---------------------------------------------------------------------------
-- Prove it
-- ---------------------------------------------------------------------------
do $$
declare
  n int;
begin
  -- The four typed columns, with the nullability each one's meaning depends on.
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'stage_plans' and column_name = 'start_date'
      and data_type = 'date' and is_nullable = 'NO'
  ) then
    raise exception 'stage_plans.start_date is missing, is not a date, or is nullable';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'stage_plans' and column_name = 'end_date'
      and data_type = 'date' and is_nullable = 'NO'
  ) then
    raise exception 'stage_plans.end_date is missing, is not a date, or is nullable';
  end if;
  -- Nullable is the whole point of this one (RV5-23): a NOT NULL here would
  -- make "defer to the computed figure" unrepresentable.
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'stage_plans' and column_name = 'planned_area_m2'
      and data_type = 'numeric' and is_nullable = 'YES'
  ) then
    raise exception 'stage_plans.planned_area_m2 is missing, is not numeric, or is NOT NULL';
  end if;

  -- The key really is the coat alone, so a second window on one coat is
  -- impossible rather than merely unlikely.
  if not exists (
    select 1 from pg_constraint c join pg_class t on t.oid = c.conrelid
    where t.relname = 'stage_plans' and c.contype = 'p'
      and pg_get_constraintdef(c.oid) = 'PRIMARY KEY (stage_id)'
  ) then
    raise exception 'stage_plans primary key is not (stage_id) alone';
  end if;

  if not exists (
    select 1 from pg_class where relname = 'stage_plans' and relrowsecurity
  ) then
    raise exception 'row level security is not enabled on stage_plans';
  end if;

  -- Exactly the two policies RV5-28/RV5-29 describe, and no third: a member
  -- write policy added by accident is the failure this check is here for.
  select count(*) into n from pg_policies
  where schemaname = 'public' and tablename = 'stage_plans';
  if n <> 2 then
    raise exception 'stage_plans carries % policies, expected 2', n;
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'stage_plans'
      and policyname = 'stage_plans_admin_all' and cmd = 'ALL'
  ) then
    raise exception 'stage_plans_admin_all is missing or is not FOR ALL';
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'stage_plans'
      and policyname = 'stage_plans_member_read' and cmd = 'SELECT'
      and qual like '%my_works%'
  ) then
    raise exception 'stage_plans_member_read is missing, is not SELECT-only, or does not go through my_works()';
  end if;

  -- Both triggers armed, and both functions with a pinned search_path.
  if (select count(*) from pg_trigger
      where tgrelid = 'stage_plans'::regclass and not tgisinternal) <> 2 then
    raise exception 'stage_plans does not carry exactly its two triggers';
  end if;
  if (select count(*) from pg_proc
      where proname in ('assert_stage_plan_consistent', 'set_stage_plan_updated_at')
        and proconfig @> array['search_path=public, pg_temp']) <> 2 then
    raise exception 'the stage_plans trigger functions do not both pin search_path';
  end if;

  -- The two check constraints, by name and by what they actually say.
  --
  -- Structural rather than exercised, deliberately: an insert probe here would
  -- need a real (stage, work, deck) triple, which a migration must not invent,
  -- and `stage_plans_assert_consistent` is a BEFORE trigger — it fires ahead
  -- of any CHECK, so a probe with fabricated uuids raises P0001 from the
  -- trigger and never reaches the constraint it meant to test. Behavioural
  -- assertions on this table live in `tests/rls.integration.test.ts`, which
  -- runs against real fixtures as a real session.
  if not exists (
    select 1 from pg_constraint c join pg_class t on t.oid = c.conrelid
    where t.relname = 'stage_plans' and c.conname = 'stage_plans_window'
      and pg_get_constraintdef(c.oid) like '%end_date >= start_date%'
  ) then
    raise exception 'stage_plans_window is missing or does not compare end_date to start_date';
  end if;
  if not exists (
    select 1 from pg_constraint c join pg_class t on t.oid = c.conrelid
    where t.relname = 'stage_plans' and c.conname = 'stage_plans_area_positive'
      and pg_get_constraintdef(c.oid) like '%planned_area_m2 IS NULL%'
  ) then
    raise exception 'stage_plans_area_positive is missing or no longer admits a null area';
  end if;
end $$;
