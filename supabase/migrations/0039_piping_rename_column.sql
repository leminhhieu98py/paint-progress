-- 0039: Piping -- rename an extra spool column atomically, and reorder crew
-- groups / extra columns atomically (spec 2026-10-07-piping §5, §6.1, Q21A,
-- ORD-01). Follows 0038; changes nothing 0038 created.
--
-- Why functions and not client writes:
--   * An extra column's values live in `piping_spools.extra[label]` (0038).
--     Renaming the column must move that key in every spool of the project
--     in the same transaction as the label change -- otherwise a failure
--     part-way leaves values under a label no column has, invisible on the
--     screen. PostgREST cannot rename a jsonb key across rows in one request;
--     a client loop would be up to 20 000 requests.
--   * A drag reorder writes `sort` on every row of the list. One UPDATE per
--     row from the client is not one transaction: a failure part-way leaves a
--     mixed order. The function writes 1..n in one statement and refuses a
--     list that is not exactly the project's current rows, so a stale screen
--     cannot drop a row out of the numbering.
--
-- Both are admin-only security definer functions with the 0038 conventions:
-- search_path pinned, revoked from public and anon, executable by
-- authenticated, the caller check first (42501, Vietnamese), then Piping must
-- be enabled, then the project's piping_settings row is locked FIRST (FOR
-- UPDATE: both rewrite rows the plan imports read, so they queue behind an
-- import and behind each other), then the rows they change in id order.
-- Rule violations raise P0001 in Vietnamese, shown as is.
--
-- Not checked here: a label equal to a built-in spool header (SpoolNo,
-- LineNo, ... and their aliases, compared case/space/dash-blind). That list
-- and its comparison live in the client's import code (domain/piping/imports)
-- and the client refuses such a label on add and rename; duplicating the
-- alias list in SQL would let the two drift.
--
-- Purely additive: safe to apply to production ahead of the app that calls it.

-- piping_rename_spool_column(p_project uuid, p_column uuid, p_label text) returns int
--   Admin only. Renames the extra column p_column of p_project to
--   btrim(p_label) and, in the same transaction, moves the key in every
--   spool of the project whose extra has the old label: the value moves to
--   the new label, replacing any value already under the new label (one left
--   behind by a deleted column). Returns the number of spools changed; 0 when
--   the label is unchanged (exactly equal after trimming) -- a case-only
--   rename is a rename.
--   Errors: 42501 'Chỉ admin được đổi tên cột'; P0001 'Piping chưa được bật
--   cho dự án này', 'Tên cột không được để trống', 'Không tìm thấy cột này
--   trong dự án', 'Cột "L" đã có trong dự án' (another column of the project
--   with the same lower(btrim(label)), as the unique index compares).
create or replace function piping_rename_spool_column(
  p_project uuid,
  p_column  uuid,
  p_label   text
)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  new_label text := btrim(coalesce(p_label, ''));
  old_label text;
  n         int;
begin
  if not is_admin() then
    raise exception 'Chỉ admin được đổi tên cột' using errcode = '42501';
  end if;
  -- Lock order (0038 header): the settings row first.
  perform 1 from piping_settings where project_id = p_project and enabled for update;
  if not found then
    raise exception 'Piping chưa được bật cho dự án này';
  end if;
  if new_label = '' then
    raise exception 'Tên cột không được để trống';
  end if;
  select c.label into old_label
  from piping_spool_columns c
  where c.id = p_column and c.project_id = p_project
  for update;
  if not found then
    raise exception 'Không tìm thấy cột này trong dự án';
  end if;
  if new_label = old_label then
    return 0;
  end if;
  if exists (
    select 1 from piping_spool_columns c
    where c.project_id = p_project and c.id <> p_column
      and lower(btrim(c.label)) = lower(new_label)
  ) then
    raise exception 'Cột "%" đã có trong dự án', new_label;
  end if;

  update piping_spool_columns set label = new_label where id = p_column;

  -- Then the spools, in id order, before the set-based UPDATE below.
  perform 1 from piping_spools s
  where s.project_id = p_project and s.extra ? old_label
  order by s.id
  for update;
  update piping_spools s
  set extra = (s.extra - old_label - new_label) || jsonb_build_object(new_label, s.extra -> old_label)
  where s.project_id = p_project and s.extra ? old_label;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- piping_reorder(p_project uuid, p_kind text, p_ids uuid[]) returns int
--   Admin only. p_kind 'group' (piping_manpower_groups, hidden groups
--   included) or 'column' (piping_spool_columns). p_ids must be exactly the
--   project's rows of that kind, each once, in the new order; sets sort = 1..n
--   in that order in one statement and returns n.
--   Errors: 42501 'Chỉ admin được sắp xếp'; P0001 'Piping chưa được bật cho
--   dự án này', 'Loại sắp xếp không hợp lệ', 'Danh sách đã thay đổi, tải lại
--   trang rồi sắp xếp lại' (an id missing, extra, repeated, of another
--   project, or null).
create or replace function piping_reorder(
  p_project uuid,
  p_kind    text,
  p_ids     uuid[]
)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  ids  uuid[] := coalesce(p_ids, array[]::uuid[]);
  have uuid[];
  n    int;
begin
  if not is_admin() then
    raise exception 'Chỉ admin được sắp xếp' using errcode = '42501';
  end if;
  perform 1 from piping_settings where project_id = p_project and enabled for update;
  if not found then
    raise exception 'Piping chưa được bật cho dự án này';
  end if;
  if p_kind is null or p_kind not in ('group', 'column') then
    raise exception 'Loại sắp xếp không hợp lệ';
  end if;

  if p_kind = 'group' then
    perform 1 from piping_manpower_groups where project_id = p_project order by id for update;
    select coalesce(array_agg(id order by id), array[]::uuid[]) into have
    from piping_manpower_groups where project_id = p_project;
  else
    perform 1 from piping_spool_columns where project_id = p_project order by id for update;
    select coalesce(array_agg(id order by id), array[]::uuid[]) into have
    from piping_spool_columns where project_id = p_project;
  end if;
  -- Exactly the current set, each once: sorted, the two arrays are equal.
  -- A null element makes the comparison null, which is refused too.
  if (select coalesce(array_agg(x order by x), array[]::uuid[]) from unnest(ids) as x) is distinct from have then
    raise exception 'Danh sách đã thay đổi, tải lại trang rồi sắp xếp lại';
  end if;

  if p_kind = 'group' then
    update piping_manpower_groups g set sort = o.ord
    from unnest(ids) with ordinality as o(id, ord)
    where g.id = o.id and g.project_id = p_project;
  else
    update piping_spool_columns c set sort = o.ord
    from unnest(ids) with ordinality as o(id, ord)
    where c.id = o.id and c.project_id = p_project;
  end if;
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function piping_rename_spool_column(uuid, uuid, text) from public, anon;
grant execute on function piping_rename_spool_column(uuid, uuid, text) to authenticated;
revoke all on function piping_reorder(uuid, text, uuid[]) from public, anon;
grant execute on function piping_reorder(uuid, text, uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- Prove it
-- ---------------------------------------------------------------------------
do $$
declare
  n int;
  f text;
  sigs text[] := array[
    'public.piping_rename_spool_column(uuid, uuid, text)',
    'public.piping_reorder(uuid, text, uuid[])'];
begin
  -- One overload each, definer, pinned.
  select count(*) into n from pg_proc
  where pronamespace = 'public'::regnamespace
    and proname in ('piping_rename_spool_column', 'piping_reorder');
  if n <> 2 then
    raise exception '0039: expected exactly 2 function overloads, found %', n;
  end if;
  select count(*) into n from pg_proc
  where pronamespace = 'public'::regnamespace
    and proname in ('piping_rename_spool_column', 'piping_reorder')
    and prosecdef and proconfig @> array['search_path=public, pg_temp'];
  if n <> 2 then
    raise exception '0039: % of the 2 functions are pinned security definer', n;
  end if;

  -- Grants: not anon, yes authenticated.
  foreach f in array sigs loop
    if has_function_privilege('anon', f, 'execute') then
      raise exception '0039: anon can execute %', f;
    end if;
    if not has_function_privilege('authenticated', f, 'execute') then
      raise exception '0039: authenticated cannot execute %', f;
    end if;
  end loop;

  -- Admin-only, checked first, with 42501, and the settings lock before anything.
  select count(*) into n from pg_proc
  where pronamespace = 'public'::regnamespace
    and proname in ('piping_rename_spool_column', 'piping_reorder')
    and prosrc like '%if not is_admin() then%'
    and prosrc like '%errcode = ''42501''%'
    and prosrc not like '%is_gs()%'
    and prosrc like '%from piping_settings where project_id = p_project and enabled for update%';
  if n <> 2 then
    raise exception '0039: % of the 2 functions are admin-only with 42501 and lock the settings row', n;
  end if;

  -- And really refuse: a migration session has no caller.
  begin
    perform piping_rename_spool_column(gen_random_uuid(), gen_random_uuid(), 'x');
    raise exception '0039: piping_rename_spool_column ran with no caller';
  exception when insufficient_privilege then null;
  end;
  begin
    perform piping_reorder(gen_random_uuid(), 'group', array[]::uuid[]);
    raise exception '0039: piping_reorder ran with no caller';
  exception when insufficient_privilege then null;
  end;
end;
$$;
