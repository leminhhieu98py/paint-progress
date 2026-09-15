-- Quantity label and unit per work — Feedback Rv6, item 3 (spec §C1, rules RV6-32…RV6-38).
--
-- Everything in this schema is square metres: `decks.total_area_m2`,
-- `cells.area_m2`, `stage_plans.planned_area_m2`, and every label the app
-- prints beside them says `m²`. Linh's item 3: not every work is painted area
-- -- scaffolding is tonnes, cable tray is metres -- and the screens and the
-- workbook should say what they are counting. Her answers, relayed by the
-- owner on 2026-09-15: the unit belongs to the WORK (every deck in one work
-- shares it, and a deck measured in something else belongs to a different
-- work); the quantity name and the unit are free text the admin types; and
-- the progress arithmetic does not change. The owner's ruling the same day:
-- "cứ làm hết như bạn đề xuất".
--
-- ---------------------------------------------------------------------------
-- What changes, and what deliberately does not
-- ---------------------------------------------------------------------------
-- Two NOT NULL text columns on `works`, each with a default, so every existing
-- row reads `Diện tích` / `m²` and nothing on any screen or in any workbook
-- reads differently until an admin edits a work (RV6-32). Both are bounded to
-- 1–30 characters after trimming: long enough for `Khối lượng tháo dỡ`, short
-- enough to sit in a table heading, and never blank -- a blank unit is not
-- "no unit", it is a heading with an empty bracket.
--
-- The numeric columns are NOT renamed. `total_area_m2`, `area_m2`,
-- `planned_area_m2` keep their names and now mean "the quantity in the work's
-- unit" -- the comments below say so on each. Renaming would touch every
-- loader, the RPCs of 0018/0032, the report and a hundred tests to change no
-- number anywhere, and a rename is the one thing in this schema that cannot be
-- applied ahead of the app. Weights, shares and percentages are ratios within
-- one deck or one work, so no arithmetic ever adds two units (RV6-38); this is
-- a labelling change, and the labels live in the app (`src/domain/unit.ts`).
--
-- RLS: nothing to add. `works` reads go through `my_works()` (0028/0034) and
-- writes are `is_admin()`; both already cover every column of the row.
--
-- Purely additive: two defaulted columns, no row rewritten beyond taking the
-- default, no policy, function or trigger touched. Safe to apply ahead of the
-- app that needs it -- the deployed app selects its work columns by name and
-- never sees these.
alter table works
  add column quantity_label text not null default 'Diện tích'
    constraint works_quantity_label_len check (length(btrim(quantity_label)) between 1 and 30),
  add column unit text not null default 'm²'
    constraint works_unit_len check (length(btrim(unit)) between 1 and 30);

comment on column works.quantity_label is
  'Tên đại lượng công việc này đo (Diện tích, Khối lượng, Chiều dài…). Mọi sàn trong công việc dùng chung; 1–30 ký tự (RV6-32).';
comment on column works.unit is
  'Đơn vị của đại lượng (m², tấn, m…). Các cột *_m2 của sàn, ô và kế hoạch trong công việc này giữ số lượng theo ĐƠN VỊ NÀY, dù tên cột nói m2 (RV6-32, RV6-38). 1–30 ký tự.';

comment on column decks.total_area_m2 is
  'Số lượng khai báo của sàn, theo đơn vị của công việc chứa sàn (works.unit, 0036) — không nhất thiết là m². Mẫu số của mọi phần trăm trên sàn.';
comment on column cells.area_m2 is
  'Số lượng của ô, theo đơn vị của công việc chứa sàn (works.unit, 0036) — không nhất thiết là m².';
comment on column stage_plans.planned_area_m2 is
  'Số lượng kế hoạch của công đoạn, theo đơn vị của công việc (works.unit, 0036) — không nhất thiết là m². Null: hệ thống tự tính phần còn lại (RV5-23).';

-- ---------------------------------------------------------------------------
-- Prove it
-- ---------------------------------------------------------------------------
do $$
declare
  n int;
begin
  -- Both columns present, text, NOT NULL and defaulted -- the default is what
  -- makes this safe for every row that exists today.
  select count(*) into n from information_schema.columns
  where table_schema = 'public' and table_name = 'works'
    and column_name in ('quantity_label', 'unit')
    and data_type = 'text' and is_nullable = 'NO' and column_default is not null;
  if n <> 2 then
    raise exception '0036: works.quantity_label / works.unit are not both NOT NULL text with a default (found %)', n;
  end if;

  -- The defaults are the exact strings the app hard-coded until now.
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'works' and column_name = 'quantity_label'
      and column_default like '%Diện tích%'
  ) then
    raise exception '0036: works.quantity_label does not default to Diện tích';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'works' and column_name = 'unit'
      and column_default like '%m²%'
  ) then
    raise exception '0036: works.unit does not default to m²';
  end if;

  -- Every existing work took the defaults: no row reads differently yet.
  select count(*) into n from works
  where quantity_label <> 'Diện tích' or unit <> 'm²';
  if n <> 0 then
    raise exception '0036: % works row(s) did not take the defaults', n;
  end if;

  -- The two check constraints, by name and by what they say.
  select count(*) into n from pg_constraint c join pg_class t on t.oid = c.conrelid
  where t.relname = 'works' and c.contype = 'c'
    and c.conname in ('works_quantity_label_len', 'works_unit_len')
    and pg_get_constraintdef(c.oid) like '%btrim(%'
    and pg_get_constraintdef(c.oid) like '%1%' and pg_get_constraintdef(c.oid) like '%30%';
  if n <> 2 then
    raise exception '0036: the two length check constraints are missing or do not say "btrim … between 1 and 30" (found %)', n;
  end if;

  -- The bound really refuses what the app refuses and admits what it writes.
  if length(btrim('   ')) between 1 and 30 or length(btrim(repeat('x', 31))) between 1 and 30 then
    raise exception '0036: the length rule admits a value the app would refuse';
  end if;
  if not (length(btrim(' tấn ')) between 1 and 30 and length(btrim(repeat('x', 30))) between 1 and 30) then
    raise exception '0036: the length rule refuses a value the app would write';
  end if;

  -- The three numeric columns keep their names: nothing was renamed.
  select count(*) into n from information_schema.columns
  where table_schema = 'public'
    and ((table_name = 'decks' and column_name = 'total_area_m2')
      or (table_name = 'cells' and column_name = 'area_m2')
      or (table_name = 'stage_plans' and column_name = 'planned_area_m2'));
  if n <> 3 then
    raise exception '0036: a *_m2 column is missing -- this migration renames nothing (found %)', n;
  end if;

  -- No policy was added or dropped on works.
  select count(*) into n from pg_policies
  where schemaname = 'public' and tablename = 'works';
  if n <> 2 then
    raise exception '0036: works carries % policies, expected the two it had', n;
  end if;
end $$;
