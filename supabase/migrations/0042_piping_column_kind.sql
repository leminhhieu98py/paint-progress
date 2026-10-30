-- 0042: Piping Rv9 -- the kind of an extra spool column, 'text' or 'number'
-- (spec 2026-10-30-rv9-feedback RV9-1). Follows 0038-0041; their files are
-- not touched.
--
-- What changes:
--   1. piping_spool_columns.kind text not null default 'text', one of 'text'
--      or 'number' by CHECK (piping_spool_columns_kind_check). Existing
--      columns become 'text'. The values stay where they are, as text in
--      piping_spools.extra[label]; the kind only tells the app how to read
--      them (a number column is summed as a unit, its import cells are
--      validated as numbers).
--
-- What needs nothing:
--   - RLS: piping_spool_columns_admin_all (the admin writes the kind) and
--     piping_spool_columns_member_read (members read it with the row) cover a
--     new column. The table grants are table-wide.
--   - Functions: no definer function of 0038-0041 inserts into
--     piping_spool_columns (the app adds columns through the admin policy, and
--     the default covers an insert that does not name the kind). The 0039/0040
--     rename, delete and reorder functions update label / sort or delete rows
--     by id and select named columns only, so they are unaffected.
--
-- Deploy order: apply this migration first, then the app. The 2.2.0 app
-- selects piping_spool_columns.kind on every Piping page; against a database
-- without the column that read fails. The reverse order is safe: the 2.1.0
-- app never names the column and its inserts get the default.

-- ---------------------------------------------------------------------------
-- 1. Column kind (RV9-1)
-- ---------------------------------------------------------------------------
alter table piping_spool_columns
  add column kind text not null default 'text';
alter table piping_spool_columns
  add constraint piping_spool_columns_kind_check check (kind in ('text', 'number'));
comment on column piping_spool_columns.kind is
  'Loại cột thêm (RV9-1): text = chữ, number = số (giá trị vẫn lưu dạng chuỗi trong piping_spools.extra).';

-- ---------------------------------------------------------------------------
-- 2. Prove it
-- ---------------------------------------------------------------------------
do $$
begin
  -- The kind column: text, not null, default 'text'.
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'piping_spool_columns' and column_name = 'kind'
      and data_type = 'text' and is_nullable = 'NO' and column_default = '''text''::text'
  ) then
    raise exception '0042: piping_spool_columns.kind is missing, nullable, or not text default ''text''';
  end if;

  -- The check: exactly the two kinds.
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.piping_spool_columns'::regclass and conname = 'piping_spool_columns_kind_check'
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%''text''%'
      and pg_get_constraintdef(oid) like '%''number''%'
  ) then
    raise exception '0042: piping_spool_columns_kind_check is missing or lacks a kind';
  end if;

  -- Every existing row got the default.
  if exists (select 1 from piping_spool_columns where kind is distinct from 'text') then
    raise exception '0042: an existing piping_spool_columns row is not kind ''text''';
  end if;
end;
$$;
