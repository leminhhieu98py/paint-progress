-- 0041: Piping Rv8 -- chart colours per project, Update Plan (merge) imports,
-- Actual imports for Reinstatement and Manpower, and the Pip/Paint/Insu
-- wording of the spool order message (spec 2026-10-19-rv8-feedback RV8-2,
-- RV8-4, RV8-5, RV8-6). Follows 0038-0040; their files are not touched.
--
-- What changes:
--   1. piping_settings.chart_colors jsonb not null default '{}' (series key ->
--      '#rrggbb'), an object by CHECK. The existing admin_all / member_read
--      policies already let the admin write it and members read it with the
--      row. No function or view of 0038-0040 lists the settings columns it
--      returns (piping_enable inserts by column list), so nothing else needs
--      to know about the column. The client validates the values and ignores
--      a stored value that is not '#rrggbb'.
--   2. piping_import_log_kind_check widened with 'reinstatement_actual' and
--      'manpower_actual' (dropped and re-added under the same name).
--   3. Three Update Plan functions beside the 0038 replace functions:
--      piping_merge_reinstatement_plan, piping_merge_manpower_plan,
--      piping_merge_spools. Same validation and messages as the replace
--      functions (copied), but nothing absent from the file is removed: a day,
--      a (group, day) cell or a spool that the file does not carry keeps its
--      value. Each logs the replace kind with summary.mode = 'update'.
--   4. Two Actual import functions: piping_import_reinstatement_actual and
--      piping_import_manpower_actual (kinds 'reinstatement_actual',
--      'manpower_actual').
--   5. piping_set_spool_actuals re-created with one changed line: its 'order'
--      message now names the milestones Pip / Paint / Insu (RV8-4). The body
--      is otherwise byte-identical to 0038's.
--
-- All five new functions follow the 0038 conventions: security definer,
-- search_path pinned, revoked from public and anon, executable by
-- authenticated; admin only, checked first (42501, Vietnamese); then Piping
-- must be enabled, and the project's piping_settings row is locked FIRST, FOR
-- UPDATE (0038 lock order: an import queues behind another import and field
-- writes queue behind it); one transaction each, so any error writes nothing
-- and no log row. Rule violations raise P0001 in Vietnamese, shown as is.
-- Dates in jsonb are 'YYYY-MM-DD' strings; numbers are JSON numbers.
--
-- Deploy order: apply this migration first, then the app. The app reads
-- piping_settings.chart_colors on every Piping page; against a database
-- without the column that read fails. The reverse order is safe: nothing
-- here changes what the 2.0.0 app reads or calls (the re-created function
-- keeps its signature, grants and results; only one message's words change).

-- ---------------------------------------------------------------------------
-- 1. Chart colours per project (RV8-2)
-- ---------------------------------------------------------------------------
alter table piping_settings
  add column chart_colors jsonb not null default '{}'::jsonb;
alter table piping_settings
  add constraint piping_settings_chart_colors_check check (jsonb_typeof(chart_colors) = 'object');
comment on column piping_settings.chart_colors is
  'Màu biểu đồ (RV8-2): khoá chuỗi số liệu -> #rrggbb. Khoá không có = màu mặc định.';

-- ---------------------------------------------------------------------------
-- 2. Import log kinds (RV8-6)
-- ---------------------------------------------------------------------------
alter table piping_import_log drop constraint piping_import_log_kind_check;
alter table piping_import_log add constraint piping_import_log_kind_check
  check (kind in ('reinstatement_plan', 'manpower_plan', 'spool_plan', 'spool_actual',
                  'reinstatement_actual', 'manpower_actual'));

-- ---------------------------------------------------------------------------
-- 3. Update Plan: merge imports (RV8-5)
-- ---------------------------------------------------------------------------

-- piping_merge_reinstatement_plan(p_project uuid, p_rows jsonb, p_file_name text,
--                                 p_summary jsonb default '{}') returns jsonb
--   Admin only. Sets the plan of each day in p_rows:
--     [{ "day": "YYYY-MM-DD", "plan_qty": number >= 0 }]  (each day once, <= 20 000 rows)
--   Days not in p_rows keep their plan (a blank cell in the file is no
--   element). Writes one piping_import_log row (kind 'reinstatement_plan');
--   summary = p_summary merged with rows, added (days without a plan
--   before), changed (days whose plan differs) and mode 'update' (always,
--   whatever p_summary says). Returns that summary plus "log_id".
--   Errors: as piping_replace_reinstatement_plan.
create or replace function piping_merge_reinstatement_plan(
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
  bad_row   bigint;
  bad_day   text;
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
  select e.ord, e.j->>'day' into bad_row, bad_day
  from jsonb_array_elements(p_rows) with ordinality as e(j, ord)
  where jsonb_typeof(e.j) = 'object' and coalesce(e.j->>'day', '') <> ''
    and not piping_is_iso_date(e.j->>'day')
  order by e.ord limit 1;
  if bad_row is not null then
    raise exception 'Ngày không hợp lệ "%" (phần tử %)', bad_day, bad_row;
  end if;
  select min(e.ord) into bad_row
  from jsonb_array_elements(p_rows) with ordinality as e(j, ord)
  where jsonb_typeof(e.j) <> 'object'
     or not piping_is_iso_date(e.j->>'day')
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

  select count(*) filter (where o.day is null),
         count(*) filter (where o.day is not null and n.plan_qty <> o.plan_qty)
    into n_added, n_changed
  from (select (e->>'day')::date as day, (e->>'plan_qty')::numeric as plan_qty
        from jsonb_array_elements(p_rows) e) n
  left join piping_reinstatement_plan o on o.project_id = p_project and o.day = n.day;

  insert into piping_reinstatement_plan (project_id, day, plan_qty)
  select p_project, (e->>'day')::date, (e->>'plan_qty')::numeric
  from jsonb_array_elements(p_rows) e
  on conflict (project_id, day) do update
    set plan_qty = excluded.plan_qty
    where piping_reinstatement_plan.plan_qty is distinct from excluded.plan_qty;

  summ := coalesce(p_summary, '{}'::jsonb) || jsonb_build_object(
    'rows', n_rows, 'added', n_added, 'changed', n_changed, 'mode', 'update');
  insert into piping_import_log (project_id, kind, file_name, row_count, summary, imported_by)
  values (p_project, 'reinstatement_plan', coalesce(btrim(p_file_name), ''), n_rows, summ, auth.uid())
  returning id into log_id;
  return summ || jsonb_build_object('log_id', log_id);
end;
$$;

-- piping_merge_manpower_plan(p_project uuid, p_rows jsonb, p_file_name text,
--                            p_summary jsonb default '{}') returns jsonb
--   Admin only. Sets each (group, day) cell in p_rows:
--     [{ "group_id": uuid, "day": "YYYY-MM-DD", "value": number >= 0 }]
--   each (group_id, day) once, every group of this project (hidden groups
--   included). Cells not in p_rows -- blank cells, absent days -- keep their
--   value. Limits as piping_replace_manpower_plan (<= 20 000 distinct days).
--   Writes one piping_import_log row (kind 'manpower_plan'); summary =
--   p_summary merged with rows (days), cells, added, changed (cells) and
--   mode 'update'. Returns that summary plus "log_id".
--   Errors: as piping_replace_manpower_plan.
create or replace function piping_merge_manpower_plan(
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
  n_cells   int;
  n_added   int;
  n_changed int;
  bad_row   bigint;
  bad_day   text;
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
  n_cells := jsonb_array_length(p_rows);
  if n_cells > 20000 * greatest(1, (select count(*) from piping_manpower_groups g
                                    where g.project_id = p_project)) then
    raise exception 'File vượt quá 20 000 dòng';
  end if;
  select count(distinct e->>'day') into n_rows from jsonb_array_elements(p_rows) e;
  if n_rows > 20000 then
    raise exception 'File vượt quá 20 000 dòng';
  end if;
  select e.ord, e.j->>'day' into bad_row, bad_day
  from jsonb_array_elements(p_rows) with ordinality as e(j, ord)
  where jsonb_typeof(e.j) = 'object' and coalesce(e.j->>'day', '') <> ''
    and not piping_is_iso_date(e.j->>'day')
  order by e.ord limit 1;
  if bad_row is not null then
    raise exception 'Ngày không hợp lệ "%" (phần tử %)', bad_day, bad_row;
  end if;
  select min(e.ord) into bad_row
  from jsonb_array_elements(p_rows) with ordinality as e(j, ord)
  where jsonb_typeof(e.j) <> 'object'
     or coalesce(e.j->>'group_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or not piping_is_iso_date(e.j->>'day')
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

  select count(*) filter (where o.day is null),
         count(*) filter (where o.day is not null and n.value <> o.value)
    into n_added, n_changed
  from (select (e->>'group_id')::uuid as group_id, (e->>'day')::date as day, (e->>'value')::numeric as value
        from jsonb_array_elements(p_rows) e) n
  left join piping_manpower_plan o on o.group_id = n.group_id and o.day = n.day;

  insert into piping_manpower_plan (project_id, group_id, day, value)
  select p_project, (e->>'group_id')::uuid, (e->>'day')::date, (e->>'value')::numeric
  from jsonb_array_elements(p_rows) e
  on conflict (group_id, day) do update
    set value = excluded.value
    where piping_manpower_plan.value is distinct from excluded.value;

  summ := coalesce(p_summary, '{}'::jsonb) || jsonb_build_object(
    'rows', n_rows, 'cells', n_cells, 'added', n_added, 'changed', n_changed, 'mode', 'update');
  insert into piping_import_log (project_id, kind, file_name, row_count, summary, imported_by)
  values (p_project, 'manpower_plan', coalesce(btrim(p_file_name), ''), n_rows, summ, auth.uid())
  returning id into log_id;
  return summ || jsonb_build_object('log_id', log_id);
end;
$$;

-- piping_merge_spools(p_project uuid, p_rows jsonb, p_file_name text,
--                     p_summary jsonb default '{}') returns jsonb
--   Admin only. Updates and adds spools from p_rows, in file order, shaped
--   as piping_replace_spools takes them:
--     [{ "spool_no": text (required), "line_no", "insu_type", "drawing_no",
--        "test_package_no", "painting_system": text | null,
--        "ph_plan", "ih_plan", "iw_plan": "YYYY-MM-DD" | null,
--        "extra": { "<extra column label>": text | null } | null }]
--   (<= 20 000 rows). The client sends only the file's non-empty cells as
--   keys; here an absent key, a null and a blank text all mean "keep".
--   Validation and messages are piping_replace_spools's (copied).
--   Matching (R-10, as the replace): old and new rows pair on spool_no
--   (trimmed, case-sensitive) and, within one spool_no, by order -- old by
--   seq, new by file position. A matched spool takes every non-empty value
--   of its row (master fields, plan dates) and keeps the rest; its extra is
--   merged key-wise (old extra || the row's non-blank values); its id, seq,
--   actuals, stamps and notes are untouched. An unmatched row is inserted
--   with seq continuing after the project's current max, in file order.
--   Nothing is deleted. Afterwards the project may hold at most 20 000
--   spools (the bound piping_set_spool_actuals and the client's reads rely
--   on); more raises and writes nothing. Writes one piping_import_log row
--   (kind 'spool_plan'); summary = p_summary merged with rows, added,
--   matched, changed (matched with any value different) and mode 'update'.
--   Returns that summary plus "log_id".
--   Errors: as piping_replace_spools, plus 'Dự án vượt quá 20 000 spool sau
--   khi cập nhật (N)'.
--   Locks: settings FOR UPDATE, then all of the project's spools in id order.
create or replace function piping_merge_spools(
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
  n_rows     int;
  n_added    int;
  n_matched  int;
  n_changed  int;
  n_total    int;
  base_seq   int;
  bad_row    bigint;
  bad_text   text;
  bad_reason text;
  summ       jsonb;
  log_id     uuid;
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
     or coalesce(jsonb_typeof(e.j->'extra'), 'null') not in ('object', 'null');
  if bad_row is not null then
    raise exception 'Dữ liệu kế hoạch Insulation không hợp lệ (dòng %)', bad_row;
  end if;
  -- Plan dates: absent / null / '' is "keep"; anything else must be a real day.
  select e.ord, d.v into bad_row, bad_text
  from jsonb_array_elements(p_rows) with ordinality as e(j, ord)
  cross join lateral (values (e.j->>'ph_plan'), (e.j->>'ih_plan'), (e.j->>'iw_plan')) as d(v)
  where coalesce(d.v, '') <> '' and not piping_is_iso_date(d.v)
  order by e.ord limit 1;
  if bad_row is not null then
    raise exception 'Ngày không hợp lệ "%" (dòng %)', bad_text, bad_row;
  end if;
  -- Extra columns (Q21A), as piping_replace_spools: text values (or null),
  -- keyed by a configured label (lower(btrim())), at most once per row,
  -- stored under the configured label's own spelling.
  select e.ord, kv.key,
         case when jsonb_typeof(kv.value) not in ('string', 'null') then 'type' else 'label' end
    into bad_row, bad_text, bad_reason
  from jsonb_array_elements(p_rows) with ordinality as e(j, ord)
  cross join lateral jsonb_each(case when jsonb_typeof(e.j->'extra') = 'object'
                                     then e.j->'extra' else '{}'::jsonb end) kv
  where jsonb_typeof(kv.value) not in ('string', 'null')
     or not exists (select 1 from piping_spool_columns c
                    where c.project_id = p_project and lower(btrim(c.label)) = lower(btrim(kv.key)))
  order by e.ord limit 1;
  if bad_row is not null then
    if bad_reason = 'type' then
      raise exception 'Giá trị cột "%" ở dòng % phải là văn bản', bad_text, bad_row;
    end if;
    raise exception 'Cột "%" ở dòng % chưa được cấu hình (Cấu hình → Cột thêm)', bad_text, bad_row;
  end if;
  select e.ord into bad_row
  from jsonb_array_elements(p_rows) with ordinality as e(j, ord)
  cross join lateral jsonb_each(case when jsonb_typeof(e.j->'extra') = 'object'
                                     then e.j->'extra' else '{}'::jsonb end) kv
  group by e.ord, lower(btrim(kv.key)) having count(*) > 1
  order by e.ord limit 1;
  if bad_row is not null then
    raise exception 'Một cột thêm xuất hiện hai lần ở dòng %', bad_row;
  end if;

  -- Lock order (0038 header): settings (above), then every spool of the
  -- project in id order, before the merge below updates them.
  perform 1 from piping_spools where project_id = p_project order by id for update;
  select coalesce(max(seq), 0) into base_seq from piping_spools where project_id = p_project;

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
           (select coalesce(jsonb_object_agg(c.label, btrim(kv.value #>> '{}')), '{}'::jsonb)
            from jsonb_each(case when jsonb_typeof(e.j->'extra') = 'object'
                                 then e.j->'extra' else '{}'::jsonb end) kv
            join piping_spool_columns c
              on c.project_id = p_project and lower(btrim(c.label)) = lower(btrim(kv.key))
            where jsonb_typeof(kv.value) = 'string' and btrim(kv.value #>> '{}') <> '') as extra
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
  ), merged as (
    -- A null on the new side is "keep" (absent, null or blank in the row).
    select n.ord, n.spool_no, o.id as old_id,
           o.line_no as o_line_no, o.insu_type as o_insu_type, o.drawing_no as o_drawing_no,
           o.test_package_no as o_test_package_no, o.painting_system as o_painting_system,
           o.extra as o_extra, o.ph_plan as o_ph_plan, o.ih_plan as o_ih_plan, o.iw_plan as o_iw_plan,
           coalesce(n.line_no, o.line_no) as line_no,
           coalesce(n.insu_type, o.insu_type) as insu_type,
           coalesce(n.drawing_no, o.drawing_no) as drawing_no,
           coalesce(n.test_package_no, o.test_package_no) as test_package_no,
           coalesce(n.painting_system, o.painting_system) as painting_system,
           coalesce(o.extra, '{}'::jsonb) || n.extra as extra,
           coalesce(n.ph_plan, o.ph_plan) as ph_plan,
           coalesce(n.ih_plan, o.ih_plan) as ih_plan,
           coalesce(n.iw_plan, o.iw_plan) as iw_plan
    from new_ranked n
    left join old_ranked o on o.spool_no = n.spool_no and o.rk = n.rk
  ), pairs as (
    select m.*,
           (m.old_id is not null
            and (m.o_line_no, m.o_insu_type, m.o_drawing_no, m.o_test_package_no, m.o_painting_system,
                 m.o_extra, m.o_ph_plan, m.o_ih_plan, m.o_iw_plan)
                is distinct from
                (m.line_no, m.insu_type, m.drawing_no, m.test_package_no, m.painting_system,
                 m.extra, m.ph_plan, m.ih_plan, m.iw_plan)) as changed
    from merged m
  ), updated as (
    update piping_spools p
    set line_no         = x.line_no,
        insu_type       = x.insu_type,
        drawing_no      = x.drawing_no,
        test_package_no = x.test_package_no,
        painting_system = x.painting_system,
        extra           = x.extra,
        ph_plan         = x.ph_plan,
        ih_plan         = x.ih_plan,
        iw_plan         = x.iw_plan
    from pairs x
    where x.changed and p.id = x.old_id
    returning 1
  ), added as (
    insert into piping_spools (project_id, seq, spool_no, line_no, insu_type, drawing_no,
                               test_package_no, painting_system, extra, ph_plan, ih_plan, iw_plan)
    select p_project, base_seq + row_number() over (order by x.ord), x.spool_no, x.line_no, x.insu_type,
           x.drawing_no, x.test_package_no, x.painting_system, x.extra, x.ph_plan, x.ih_plan, x.iw_plan
    from pairs x
    where x.old_id is null
    returning 1
  )
  select (select count(*) from added),
         (select count(*) from pairs where old_id is not null),
         (select count(*) from updated)
    into n_added, n_matched, n_changed;

  -- Nothing is ever removed here, so the 20 000 bound is on the result.
  select count(*) into n_total from piping_spools where project_id = p_project;
  if n_total > 20000 then
    raise exception 'Dự án vượt quá 20 000 spool sau khi cập nhật (%)', n_total;
  end if;

  summ := coalesce(p_summary, '{}'::jsonb) || jsonb_build_object(
    'rows', n_rows, 'added', n_added, 'matched', n_matched, 'changed', n_changed, 'mode', 'update');
  insert into piping_import_log (project_id, kind, file_name, row_count, summary, imported_by)
  values (p_project, 'spool_plan', coalesce(btrim(p_file_name), ''), n_rows, summ, auth.uid())
  returning id into log_id;
  return summ || jsonb_build_object('log_id', log_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Actual imports for Reinstatement and Manpower (RV8-6)
-- ---------------------------------------------------------------------------

-- piping_import_reinstatement_actual(p_project uuid, p_rows jsonb, p_file_name text,
--                                    p_summary jsonb default '{}') returns jsonb
--   Admin only. p_rows: [{ "day": "YYYY-MM-DD", "qty": number >= 0 }], each
--   day once, every day <= today (VN), <= 20 000 rows. A blank cell in the
--   file is no element (that day is kept).
--   Each element sets that day's TOTAL: when it differs from the stored total
--   (the sum of the day's entries, 0 without any), all entries of the day are
--   deleted and one entry of qty is inserted (none when qty is 0, which
--   empties the day). A day whose total already equals qty is left as it is,
--   so its entries keep who entered them. The new entries are stamped by the
--   trigger as the admin's (created_by).
--   Cap (R-4, Q9A): the project's total Test Pack must be set, and the
--   cumulative actual AFTER the import must not exceed it -- checked here
--   once, before any write. The per-row cap in piping_reinstatement_actual_check
--   still runs on each insert; the deletes go first, so the inserts only
--   ever raise the sum towards a result already known to fit, and it never
--   fires on an intermediate state.
--   Writes one piping_import_log row (kind 'reinstatement_actual', row_count
--   = days in the file); summary = p_summary merged with days (elements),
--   added (days without entries that get a qty > 0) and overwritten (days
--   with entries whose total changes). Returns that summary plus "log_id".
--   Errors: 42501 'Chỉ admin được nhập số liệu thực tế'; P0001 not enabled,
--   'Dữ liệu thực tế không hợp lệ', 'Ngày không hợp lệ "x" (phần tử N)',
--   'Dữ liệu thực tế không hợp lệ (phần tử N)' (1-based), 'Ngày D lặp lại
--   trong file', 'File vượt quá 20 000 dòng', 'Không nhập được ngày trong
--   tương lai (DD/MM/YYYY)', 'Admin chưa nhập tổng Test Pack', 'Vượt tổng
--   Test Pack (đã có X / Y)' (X = cumulative after the import, vi decimal
--   comma; Y = total).
create or replace function piping_import_reinstatement_actual(
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
  n_rows        int;
  n_added       int;
  n_overwritten int;
  bad_row       bigint;
  bad_day       text;
  dup_day       text;
  future_day    date;
  cap           int;
  after_total   numeric;
  days          date[];
  summ          jsonb;
  log_id        uuid;
begin
  if not is_admin() then
    raise exception 'Chỉ admin được nhập số liệu thực tế' using errcode = '42501';
  end if;
  -- FOR UPDATE: the cap trigger writes this row anyway; an import queues
  -- behind another import and field entries queue behind it.
  perform 1 from piping_settings where project_id = p_project and enabled for update;
  if not found then
    raise exception 'Piping chưa được bật cho dự án này';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array'
     or (p_summary is not null and jsonb_typeof(p_summary) <> 'object') then
    raise exception 'Dữ liệu thực tế không hợp lệ';
  end if;
  n_rows := jsonb_array_length(p_rows);
  if n_rows > 20000 then
    raise exception 'File vượt quá 20 000 dòng';
  end if;
  select e.ord, e.j->>'day' into bad_row, bad_day
  from jsonb_array_elements(p_rows) with ordinality as e(j, ord)
  where jsonb_typeof(e.j) = 'object' and coalesce(e.j->>'day', '') <> ''
    and not piping_is_iso_date(e.j->>'day')
  order by e.ord limit 1;
  if bad_row is not null then
    raise exception 'Ngày không hợp lệ "%" (phần tử %)', bad_day, bad_row;
  end if;
  select min(e.ord) into bad_row
  from jsonb_array_elements(p_rows) with ordinality as e(j, ord)
  where jsonb_typeof(e.j) <> 'object'
     or not piping_is_iso_date(e.j->>'day')
     or case when jsonb_typeof(e.j->'qty') = 'number'
             then (e.j->>'qty')::numeric < 0 else true end;
  if bad_row is not null then
    raise exception 'Dữ liệu thực tế không hợp lệ (phần tử %)', bad_row;
  end if;
  select e->>'day' into dup_day
  from jsonb_array_elements(p_rows) e
  group by e->>'day' having count(*) > 1
  order by 1 limit 1;
  if dup_day is not null then
    raise exception 'Ngày % lặp lại trong file', to_char(dup_day::date, 'DD/MM/YYYY');
  end if;
  select max((e->>'day')::date) into future_day from jsonb_array_elements(p_rows) e;
  if future_day > piping_vn_today() then
    raise exception 'Không nhập được ngày trong tương lai (%)', to_char(future_day, 'DD/MM/YYYY');
  end if;
  select s.total_test_packs into cap from piping_settings s where s.project_id = p_project;
  if cap is null then
    raise exception 'Admin chưa nhập tổng Test Pack';
  end if;

  -- The days whose total changes, and the counts for the log.
  with f as (
    select (e->>'day')::date as day, (e->>'qty')::numeric as qty
    from jsonb_array_elements(p_rows) e
  ), cur as (
    select a.day, sum(a.qty) as total
    from piping_reinstatement_actual a
    where a.project_id = p_project and a.day in (select f.day from f)
    group by a.day
  )
  select coalesce(array_agg(f.day) filter (where coalesce(c.total, 0) <> f.qty), '{}'::date[]),
         count(*) filter (where c.total is null and f.qty <> 0),
         count(*) filter (where c.total is not null and c.total <> f.qty)
    into days, n_added, n_overwritten
  from f left join cur c on c.day = f.day;

  -- The cap on the result: the days kept plus the file's totals of the days replaced.
  select coalesce((select sum(a.qty) from piping_reinstatement_actual a
                   where a.project_id = p_project and a.day <> all (days)), 0)
         + coalesce((select sum((e->>'qty')::numeric) from jsonb_array_elements(p_rows) e
                     where (e->>'day')::date = any (days)), 0)
    into after_total;
  if after_total > cap then
    raise exception 'Vượt tổng Test Pack (đã có % / %)', replace(trim_scale(after_total)::text, '.', ','), cap;
  end if;

  -- Deletes before inserts (see the header).
  delete from piping_reinstatement_actual where project_id = p_project and day = any (days);
  insert into piping_reinstatement_actual (project_id, day, qty)
  select p_project, (e->>'day')::date, (e->>'qty')::numeric
  from jsonb_array_elements(p_rows) e
  where (e->>'day')::date = any (days) and (e->>'qty')::numeric > 0;

  summ := coalesce(p_summary, '{}'::jsonb) || jsonb_build_object(
    'days', n_rows, 'added', n_added, 'overwritten', n_overwritten);
  insert into piping_import_log (project_id, kind, file_name, row_count, summary, imported_by)
  values (p_project, 'reinstatement_actual', coalesce(btrim(p_file_name), ''), n_rows, summ, auth.uid())
  returning id into log_id;
  return summ || jsonb_build_object('log_id', log_id);
end;
$$;

-- piping_import_manpower_actual(p_project uuid, p_rows jsonb, p_file_name text,
--                               p_summary jsonb default '{}') returns jsonb
--   Admin only. p_rows: [{ "day": "YYYY-MM-DD", "values": { "<group id>": number >= 0 } }],
--   one element per file row, each day once, every day <= today (VN),
--   <= 20 000 rows; every group of this project, hidden groups included. A
--   blank cell is no key (that cell is kept). Each value upserts its
--   (group, day) cell -- 0 is stored as 0 -- stamped by the trigger
--   (created_by on a new cell, edited_by/at on a changed one).
--   Writes one piping_import_log row (kind 'manpower_actual', row_count =
--   days); summary = p_summary merged with days, cells, added (cells without
--   a value before) and overwritten (cells whose value changes). Returns
--   that summary plus "log_id".
--   Errors: 42501 'Chỉ admin được nhập số liệu thực tế'; P0001 not enabled,
--   'Dữ liệu thực tế không hợp lệ', 'Ngày không hợp lệ "x" (phần tử N)',
--   'Dữ liệu thực tế không hợp lệ (phần tử N)', 'Ngày D lặp lại trong file',
--   'Ngày D của một nhóm lặp lại trong file' (one group id twice in a row,
--   in another letter case), 'Nhóm nhân lực không thuộc dự án này', 'File
--   vượt quá 20 000 dòng', 'Không nhập được ngày trong tương lai (DD/MM/YYYY)'.
create or replace function piping_import_manpower_actual(
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
  n_rows        int;
  n_cells       int;
  n_added       int;
  n_overwritten int;
  bad_row       bigint;
  bad_day       text;
  dup_day       text;
  future_day    date;
  summ          jsonb;
  log_id        uuid;
begin
  if not is_admin() then
    raise exception 'Chỉ admin được nhập số liệu thực tế' using errcode = '42501';
  end if;
  -- FOR UPDATE: queues behind a Manpower Plan import; field writes (FOR
  -- SHARE) queue behind this one.
  perform 1 from piping_settings where project_id = p_project and enabled for update;
  if not found then
    raise exception 'Piping chưa được bật cho dự án này';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array'
     or (p_summary is not null and jsonb_typeof(p_summary) <> 'object') then
    raise exception 'Dữ liệu thực tế không hợp lệ';
  end if;
  n_rows := jsonb_array_length(p_rows);
  if n_rows > 20000 then
    raise exception 'File vượt quá 20 000 dòng';
  end if;
  select e.ord, e.j->>'day' into bad_row, bad_day
  from jsonb_array_elements(p_rows) with ordinality as e(j, ord)
  where jsonb_typeof(e.j) = 'object' and coalesce(e.j->>'day', '') <> ''
    and not piping_is_iso_date(e.j->>'day')
  order by e.ord limit 1;
  if bad_row is not null then
    raise exception 'Ngày không hợp lệ "%" (phần tử %)', bad_day, bad_row;
  end if;
  select min(e.ord) into bad_row
  from jsonb_array_elements(p_rows) with ordinality as e(j, ord)
  where jsonb_typeof(e.j) <> 'object'
     or not piping_is_iso_date(e.j->>'day')
     or coalesce(jsonb_typeof(e.j->'values'), 'null') <> 'object'
     or exists (
       select 1
       from jsonb_each(case when jsonb_typeof(e.j->'values') = 'object' then e.j->'values' else '{}'::jsonb end) kv
       where kv.key !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          or case when jsonb_typeof(kv.value) = 'number'
                  then (kv.value #>> '{}')::numeric < 0 else true end
     );
  if bad_row is not null then
    raise exception 'Dữ liệu thực tế không hợp lệ (phần tử %)', bad_row;
  end if;
  select e->>'day' into dup_day
  from jsonb_array_elements(p_rows) e
  group by e->>'day' having count(*) > 1
  order by 1 limit 1;
  if dup_day is not null then
    raise exception 'Ngày % lặp lại trong file', to_char(dup_day::date, 'DD/MM/YYYY');
  end if;
  select e->>'day' into dup_day
  from jsonb_array_elements(p_rows) e
  cross join lateral jsonb_each(e->'values') kv
  group by e->>'day', lower(kv.key) having count(*) > 1
  order by 1 limit 1;
  if dup_day is not null then
    raise exception 'Ngày % của một nhóm lặp lại trong file', to_char(dup_day::date, 'DD/MM/YYYY');
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_rows) e
    cross join lateral jsonb_each(e->'values') kv
    where not exists (
      select 1 from piping_manpower_groups g
      where g.project_id = p_project and g.id = kv.key::uuid
    )
  ) then
    raise exception 'Nhóm nhân lực không thuộc dự án này';
  end if;
  select max((e->>'day')::date) into future_day from jsonb_array_elements(p_rows) e;
  if future_day > piping_vn_today() then
    raise exception 'Không nhập được ngày trong tương lai (%)', to_char(future_day, 'DD/MM/YYYY');
  end if;

  select count(*),
         count(*) filter (where o.day is null),
         count(*) filter (where o.day is not null and o.value <> n.value)
    into n_cells, n_added, n_overwritten
  from (select kv.key::uuid as group_id, (e->>'day')::date as day, (kv.value #>> '{}')::numeric as value
        from jsonb_array_elements(p_rows) e
        cross join lateral jsonb_each(e->'values') kv) n
  left join piping_manpower_actual o on o.group_id = n.group_id and o.day = n.day;

  insert into piping_manpower_actual (project_id, group_id, day, value)
  select p_project, kv.key::uuid, (e->>'day')::date, (kv.value #>> '{}')::numeric
  from jsonb_array_elements(p_rows) e
  cross join lateral jsonb_each(e->'values') kv
  on conflict (group_id, day) do update
    set value = excluded.value
    where piping_manpower_actual.value is distinct from excluded.value;

  summ := coalesce(p_summary, '{}'::jsonb) || jsonb_build_object(
    'days', n_rows, 'cells', n_cells, 'added', n_added, 'overwritten', n_overwritten);
  insert into piping_import_log (project_id, kind, file_name, row_count, summary, imported_by)
  values (p_project, 'manpower_actual', coalesce(btrim(p_file_name), ''), n_rows, summ, auth.uid())
  returning id into log_id;
  return summ || jsonb_build_object('log_id', log_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. piping_set_spool_actuals: Pip / Paint / Insu in the order message (RV8-4)
-- ---------------------------------------------------------------------------
-- Re-created from 0038 with one line changed: the import-mode 'order'
-- message now reads 'ngày thực tế phải theo thứ tự Pip ≤ Paint ≤ Insu'.
-- Signature, defaults, rules, locks and results are 0038's, unchanged; its
-- contract comment is 0038's (see there).
create or replace function piping_set_spool_actuals(
  p_project     uuid,
  p_changes     jsonb,
  p_overwrite   boolean default false,
  p_import_file text default null,
  p_dry_run     boolean default false,
  p_file_rows   int default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  caller_is_admin boolean := is_admin();
  overwrite       boolean := coalesce(p_overwrite, false);
  dry_run         boolean := coalesce(p_dry_run, false);
  results         jsonb;
  n_changes       int;
  n_spools        int;
  n_saved         int;
  n_unchanged     int;
  bad             jsonb;
  bad_date        text;
  bad_spool       text;
  future_day      date;
begin
  if not (caller_is_admin or (is_gs() and p_project in (select my_projects()))) then
    raise exception 'Bạn không có quyền ghi dữ liệu Piping của dự án này' using errcode = '42501';
  end if;
  -- Lock order (header): the settings row first. FOR SHARE: queues behind an
  -- Insulation Plan import (FOR UPDATE), never behind another field write.
  perform 1 from piping_settings where project_id = p_project and enabled for share;
  if not found then
    raise exception 'Piping chưa được bật cho dự án này';
  end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'array'
     or exists (
       select 1 from jsonb_array_elements(p_changes) c
       where jsonb_typeof(c) <> 'object'
          or coalesce(c->>'spool_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          or coalesce(c->>'milestone', '') not in ('ph', 'ih', 'iw')
          or not (c ? 'date')
          or jsonb_typeof(c->'date') not in ('string', 'null')
     ) then
    raise exception 'Dữ liệu ngày thực tế không hợp lệ';
  end if;
  select count(*), count(distinct lower(c->>'spool_id')) into n_changes, n_spools
  from jsonb_array_elements(p_changes) c;
  if n_spools > 20000 or n_changes > 60000
     or (p_file_rows is not null and (p_file_rows < 0 or p_file_rows > 20000)) then
    raise exception 'File vượt quá 20 000 dòng';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_changes) c
    group by lower(c->>'spool_id'), c->>'milestone' having count(*) > 1
  ) then
    raise exception 'Một spool và mốc xuất hiện hai lần';
  end if;
  select c->>'date', c->>'spool_id' into bad_date, bad_spool
  from jsonb_array_elements(p_changes) c
  where jsonb_typeof(c->'date') = 'string' and not piping_is_iso_date(c->>'date')
  limit 1;
  if bad_date is not null then
    raise exception 'Ngày không hợp lệ "%" (spool %)', bad_date,
      coalesce((select s.spool_no from piping_spools s
                where s.id = bad_spool::uuid and s.project_id = p_project), bad_spool);
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

  -- Lock order (header): the target spools, in id order, before reading them.
  perform 1 from piping_spools s
  where s.project_id = p_project
    and s.id in (select distinct (c->>'spool_id')::uuid from jsonb_array_elements(p_changes) c)
  order by s.id
  for update;

  -- One set-based pass: classify every spool, write the 'saved' ones (unless
  -- a dry run), and build the result. Linear in the number of changes.
  with ch as (
    select (c.j->>'spool_id')::uuid as spool_id, jsonb_object_agg(c.j->>'milestone', c.j->'date') as m,
           min(c.ord) as first_ord
    from jsonb_array_elements(p_changes) with ordinality as c(j, ord)
    group by 1
  ), cur as (
    select ch.spool_id, ch.first_ord, s.id as found_id, s.spool_no,
           s.ph_actual as o_ph, s.ih_actual as o_ih, s.iw_actual as o_iw,
           case when ch.m ? 'ph' then (ch.m->>'ph')::date else s.ph_actual end as n_ph,
           case when ch.m ? 'ih' then (ch.m->>'ih')::date else s.ih_actual end as n_ih,
           case when ch.m ? 'iw' then (ch.m->>'iw')::date else s.iw_actual end as n_iw
    from ch
    left join piping_spools s on s.id = ch.spool_id and s.project_id = p_project
  ), classified as (
    select cur.*,
           case
             when found_id is null then 'not_found'
             when coalesce(n_ph > n_ih, false) or coalesce(n_ih > n_iw, false)
                  or coalesce(n_ph > n_iw, false) then 'order'
             when n_ph is not distinct from o_ph and n_ih is not distinct from o_ih
                  and n_iw is not distinct from o_iw then 'unchanged'
             when not overwrite
                  and (coalesce(n_ph <> o_ph, false) or coalesce(n_ih <> o_ih, false)
                       or coalesce(n_iw <> o_iw, false)) then 'overwrite_needed'
             else 'saved'
           end as status
    from cur
  ), written as (
    update piping_spools p
    set ph_actual = x.n_ph, ih_actual = x.n_ih, iw_actual = x.n_iw
    from classified x
    where x.status = 'saved' and not dry_run and p.id = x.found_id
    returning p.id
  )
  select coalesce(jsonb_agg(jsonb_build_object('spool_id', x.spool_id, 'spool_no', x.spool_no,
                                               'status', x.status) order by x.spool_id), '[]'::jsonb),
         count(*) filter (where x.status = 'saved'),
         count(*) filter (where x.status = 'unchanged'),
         -- The first failing spool in the order of p_changes (file order), for
         -- the import-mode message below.
         (array_agg(jsonb_build_object('spool_id', x.spool_id, 'spool_no', x.spool_no, 'status', x.status)
                    order by x.first_ord)
            filter (where x.status in ('not_found', 'order', 'overwrite_needed')))[1]
    into results, n_saved, n_unchanged, bad
  from classified x;
  -- `written` needs no reference: a data-modifying WITH runs to completion
  -- whether or not the main query reads it.

  if p_import_file is not null and not dry_run then
    if bad is not null then
      -- Raising rolls back the 'saved' writes above: nothing of the file lands.
      raise exception 'Spool %: %. Không có dữ liệu nào được ghi.',
        coalesce(bad->>'spool_no', bad->>'spool_id'),
        case bad->>'status'
          when 'not_found' then 'không còn trong dự án (kế hoạch vừa được nhập lại?)'
          when 'order' then 'ngày thực tế phải theo thứ tự Pip ≤ Paint ≤ Insu'
          else 'đã có ngày thực tế khác, cần xác nhận ghi đè'
        end;
    end if;
    insert into piping_import_log (project_id, kind, file_name, row_count, summary, imported_by)
    values (
      p_project, 'spool_actual', btrim(p_import_file), n_spools,
      jsonb_build_object('file_rows', p_file_rows, 'spools', n_spools, 'changes', n_changes, 'saved', n_saved,
                         'unchanged', n_unchanged, 'overwrite', overwrite),
      auth.uid()
    );
  end if;

  return results;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Grants (0038's pattern)
-- ---------------------------------------------------------------------------
revoke all on function piping_merge_reinstatement_plan(uuid, jsonb, text, jsonb) from public, anon;
grant execute on function piping_merge_reinstatement_plan(uuid, jsonb, text, jsonb) to authenticated;
revoke all on function piping_merge_manpower_plan(uuid, jsonb, text, jsonb) from public, anon;
grant execute on function piping_merge_manpower_plan(uuid, jsonb, text, jsonb) to authenticated;
revoke all on function piping_merge_spools(uuid, jsonb, text, jsonb) from public, anon;
grant execute on function piping_merge_spools(uuid, jsonb, text, jsonb) to authenticated;
revoke all on function piping_import_reinstatement_actual(uuid, jsonb, text, jsonb) from public, anon;
grant execute on function piping_import_reinstatement_actual(uuid, jsonb, text, jsonb) to authenticated;
revoke all on function piping_import_manpower_actual(uuid, jsonb, text, jsonb) from public, anon;
grant execute on function piping_import_manpower_actual(uuid, jsonb, text, jsonb) to authenticated;
-- Unchanged by `create or replace`, restated so this file alone shows them.
revoke all on function piping_set_spool_actuals(uuid, jsonb, boolean, text, boolean, integer) from public, anon;
grant execute on function piping_set_spool_actuals(uuid, jsonb, boolean, text, boolean, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Prove it
-- ---------------------------------------------------------------------------
do $$
declare
  n    int;
  f    text;
  fns  text[] := array['piping_merge_reinstatement_plan', 'piping_merge_manpower_plan', 'piping_merge_spools',
                       'piping_import_reinstatement_actual', 'piping_import_manpower_actual'];
  sigs text[] := array[
    'public.piping_merge_reinstatement_plan(uuid, jsonb, text, jsonb)',
    'public.piping_merge_manpower_plan(uuid, jsonb, text, jsonb)',
    'public.piping_merge_spools(uuid, jsonb, text, jsonb)',
    'public.piping_import_reinstatement_actual(uuid, jsonb, text, jsonb)',
    'public.piping_import_manpower_actual(uuid, jsonb, text, jsonb)',
    'public.piping_set_spool_actuals(uuid, jsonb, boolean, text, boolean, integer)'];
  def  text;
begin
  -- The colour column: jsonb, not null, default '{}', an object by CHECK.
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'piping_settings' and column_name = 'chart_colors'
      and data_type = 'jsonb' and is_nullable = 'NO' and column_default = '''{}''::jsonb'
  ) then
    raise exception '0041: piping_settings.chart_colors is missing, nullable, or not jsonb default ''{}''';
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.piping_settings'::regclass and conname = 'piping_settings_chart_colors_check'
      and pg_get_constraintdef(oid) like '%jsonb_typeof(chart_colors)%object%'
  ) then
    raise exception '0041: piping_settings_chart_colors_check is missing';
  end if;

  -- The log kinds: the four of 0038 and the two new ones.
  select pg_get_constraintdef(oid) into def from pg_constraint
  where conrelid = 'public.piping_import_log'::regclass and conname = 'piping_import_log_kind_check';
  if def is null
     or def not like '%''reinstatement_plan''%' or def not like '%''manpower_plan''%'
     or def not like '%''spool_plan''%' or def not like '%''spool_actual''%'
     or def not like '%''reinstatement_actual''%' or def not like '%''manpower_actual''%' then
    raise exception '0041: piping_import_log_kind_check lacks a kind: %', def;
  end if;

  -- The five new functions: one overload each, definer, pinned.
  select count(*) into n from pg_proc
  where pronamespace = 'public'::regnamespace and proname = any (fns);
  if n <> 5 then
    raise exception '0041: expected exactly 5 function overloads, found %', n;
  end if;
  select count(*) into n from pg_proc
  where pronamespace = 'public'::regnamespace and proname = any (fns)
    and prosecdef and proconfig @> array['search_path=public, pg_temp'];
  if n <> 5 then
    raise exception '0041: % of the 5 functions are pinned security definer', n;
  end if;

  -- Grants: not anon, yes authenticated (the re-created one included).
  foreach f in array sigs loop
    if has_function_privilege('anon', f, 'execute') then
      raise exception '0041: anon can execute %', f;
    end if;
    if not has_function_privilege('authenticated', f, 'execute') then
      raise exception '0041: authenticated cannot execute %', f;
    end if;
  end loop;

  -- Admin-only, checked first, with 42501, and the settings lock FOR UPDATE.
  select count(*) into n from pg_proc
  where pronamespace = 'public'::regnamespace and proname = any (fns)
    and prosrc like '%if not is_admin() then%'
    and prosrc like '%errcode = ''42501''%'
    and prosrc not like '%is_gs()%'
    and prosrc like '%from piping_settings where project_id = p_project and enabled for update%';
  if n <> 5 then
    raise exception '0041: % of the 5 functions are admin-only with 42501 and lock the settings row', n;
  end if;

  -- And really refuse: a migration session has no caller.
  begin
    perform piping_merge_reinstatement_plan(gen_random_uuid(), '[]'::jsonb, 'x.xlsx', '{}'::jsonb);
    raise exception '0041: piping_merge_reinstatement_plan ran with no caller';
  exception when insufficient_privilege then null;
  end;
  begin
    perform piping_merge_manpower_plan(gen_random_uuid(), '[]'::jsonb, 'x.xlsx', '{}'::jsonb);
    raise exception '0041: piping_merge_manpower_plan ran with no caller';
  exception when insufficient_privilege then null;
  end;
  begin
    perform piping_merge_spools(gen_random_uuid(), '[]'::jsonb, 'x.xlsx', '{}'::jsonb);
    raise exception '0041: piping_merge_spools ran with no caller';
  exception when insufficient_privilege then null;
  end;
  begin
    perform piping_import_reinstatement_actual(gen_random_uuid(), '[]'::jsonb, 'x.xlsx', '{}'::jsonb);
    raise exception '0041: piping_import_reinstatement_actual ran with no caller';
  exception when insufficient_privilege then null;
  end;
  begin
    perform piping_import_manpower_actual(gen_random_uuid(), '[]'::jsonb, 'x.xlsx', '{}'::jsonb);
    raise exception '0041: piping_import_manpower_actual ran with no caller';
  exception when insufficient_privilege then null;
  end;

  -- piping_set_spool_actuals: still the one pinned definer overload, with the
  -- new words and without the old ones.
  select count(*) into n from pg_proc
  where pronamespace = 'public'::regnamespace and proname = 'piping_set_spool_actuals'
    and prosecdef and proconfig @> array['search_path=public, pg_temp']
    and prosrc like '%ngày thực tế phải theo thứ tự Pip ≤ Paint ≤ Insu%'
    and prosrc not like '%Painting Handover%';
  if n <> 1 then
    raise exception '0041: piping_set_spool_actuals is not the single pinned definer with the Pip ≤ Paint ≤ Insu message';
  end if;
  select count(*) into n from pg_proc
  where pronamespace = 'public'::regnamespace and proname = 'piping_set_spool_actuals';
  if n <> 1 then
    raise exception '0041: expected exactly 1 piping_set_spool_actuals overload, found %', n;
  end if;
end;
$$;
