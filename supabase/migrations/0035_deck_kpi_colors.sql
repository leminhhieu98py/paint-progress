-- KPI chart colours per deck — Feedback Rv6, item 5c (spec §C2, rules RV6-27…RV6-31).
--
-- Linh asked to tell one deck's KPI chart from another's at a glance. The KPI
-- combo chart (RV5-27) paints its PLAN series in the grey family and its
-- ACTUAL series in the accent family, the same two families on every deck.
-- These two columns let the admin choose a colour for each family per deck:
-- the chart uses them when its Sàn filter names that one deck, and falls back
-- to the defaults under `Tất cả sàn` or when a column is null (RV6-29).
--
-- Null is the system default, not "no colour": a deck nobody has styled reads
-- exactly as it does today (RV6-30), and the `Mặc định` link in the admin's
-- table writes both columns back to null.
--
-- The check is the same six-digit hash form `stages.color` accepts through
-- the StageConfigPanel hex field (`HEX_COLOR` in the app): the native colour
-- swatch emits exactly that, and the app's own validation refuses anything
-- else before it is written (RV6-31), so this constraint is the backstop for
-- a client that is not this app, not the first line.
--
-- RLS: nothing to add. `decks_admin_all` (0006) covers the write, and
-- `decks_member_read` (through `my_projects()`, 0006/0007/0034) already reads
-- every column of a deck row for the GS and the viewer, so the colours ride
-- along on the same select the KPI screen makes today.
--
-- Purely additive: two nullable columns, no row rewritten, no policy touched.
-- Safe to apply ahead of the app that needs it — the deployed app selects its
-- columns by name and never sees these.
alter table decks
  add column kpi_plan_color text null
    constraint decks_kpi_plan_color_hex check (kpi_plan_color is null or kpi_plan_color ~ '^#[0-9a-fA-F]{6}$'),
  add column kpi_actual_color text null
    constraint decks_kpi_actual_color_hex check (kpi_actual_color is null or kpi_actual_color ~ '^#[0-9a-fA-F]{6}$');

comment on column decks.kpi_plan_color is
  'Màu biểu đồ KPI cho kế hoạch (cột và đường luỹ kế) khi lọc theo sàn này. #RRGGBB. Null: màu mặc định của hệ thống (RV6-29, RV6-30).';
comment on column decks.kpi_actual_color is
  'Màu biểu đồ KPI cho thực hiện (cột và đường luỹ kế) khi lọc theo sàn này. #RRGGBB. Null: màu mặc định của hệ thống (RV6-29, RV6-30).';

-- ---------------------------------------------------------------------------
-- Prove it
-- ---------------------------------------------------------------------------
do $$
declare
  n int;
begin
  -- Both columns present, text, and nullable -- null is the default the chart
  -- falls back to, so a NOT NULL here would make "system default"
  -- unrepresentable.
  select count(*) into n from information_schema.columns
  where table_schema = 'public' and table_name = 'decks'
    and column_name in ('kpi_plan_color', 'kpi_actual_color')
    and data_type = 'text' and is_nullable = 'YES' and column_default is null;
  if n <> 2 then
    raise exception '0035: decks.kpi_plan_color / kpi_actual_color are not both nullable text with no default (found %)', n;
  end if;

  -- The two check constraints, by name and by what they say: each admits null
  -- and otherwise demands the six-digit hash form the app writes.
  select count(*) into n from pg_constraint c join pg_class t on t.oid = c.conrelid
  where t.relname = 'decks' and c.contype = 'c'
    and c.conname in ('decks_kpi_plan_color_hex', 'decks_kpi_actual_color_hex')
    and pg_get_constraintdef(c.oid) like '%IS NULL%'
    and pg_get_constraintdef(c.oid) like '%^#[0-9a-fA-F]{6}$%';
  if n <> 2 then
    raise exception '0035: the two kpi colour check constraints are missing or do not say "null or #RRGGBB" (found %)', n;
  end if;

  -- The regex really rejects what the app rejects and admits what it writes.
  if '#12345' ~ '^#[0-9a-fA-F]{6}$' or '#1234567' ~ '^#[0-9a-fA-F]{6}$'
     or '123456' ~ '^#[0-9a-fA-F]{6}$' or '#12345g' ~ '^#[0-9a-fA-F]{6}$' then
    raise exception '0035: the hex pattern admits a value the app would refuse';
  end if;
  if not ('#0A8175' ~ '^#[0-9a-fA-F]{6}$' and '#8698aa' ~ '^#[0-9a-fA-F]{6}$') then
    raise exception '0035: the hex pattern refuses a six-digit colour';
  end if;

  -- No policy was added or dropped: the two the table has carried since 0006
  -- are the whole access story for these columns too.
  select count(*) into n from pg_policies
  where schemaname = 'public' and tablename = 'decks';
  if n <> 2 then
    raise exception '0035: decks carries % policies, expected the two from 0006', n;
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'decks'
      and policyname = 'decks_admin_all' and cmd = 'ALL'
  ) then
    raise exception '0035: decks_admin_all is missing or is not FOR ALL';
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'decks'
      and policyname = 'decks_member_read' and cmd = 'SELECT'
      and qual like '%my_projects()%'
  ) then
    raise exception '0035: decks_member_read is missing, is not SELECT-only, or does not go through my_projects()';
  end if;
end $$;
