-- The viewer reads every project — Feedback Rv6, item 7 (spec §C3, rules RV6-21, RV6-22).
--
-- Linh's item 7 asked for a read-only account for the bosses that sees the
-- whole company, not the one or two projects an admin remembered to assign.
-- Two answers were put to her: a fourth role, or the existing `viewer` (0028)
-- widened so it sees every project instead of only its assigned ones. Her
-- answer, relayed by the owner on 2026-09-15: **"theo đề xuất"** — the cheaper
-- one. The owner's ruling the same day: "cứ làm hết như bạn đề xuất".
--
-- ---------------------------------------------------------------------------
-- What changes, and where
-- ---------------------------------------------------------------------------
-- Nothing in a policy. Every member read in this schema resolves through one
-- of two predicates: `my_projects()` (0006, tightened in 0007) for the
-- project-scoped tables — projects, decks, deck_guides, cells, zone_cells and
-- the `drawings` bucket (0009/0010) — and `my_works()` (0028) for the
-- work-scoped ones — works, work_decks, deck_stages, cell_states, zones,
-- cell_events and stage_plans (0033). So "a viewer sees everything" is a
-- change INSIDE those two functions, with the same names, the same signatures
-- and the same return types, and the thirteen policies that call them keep
-- their names and bodies. `is_viewer()` is the new predicate both
-- consult, the exact shape of `is_gs()` (0028): an ACTIVE profile with the
-- role, so a locked viewer reads nothing, as a locked GS does.
--
-- For everyone who is not a viewer both functions return exactly what they
-- returned yesterday: the union's first half is empty unless `is_viewer()`
-- holds. A GS with no membership still reads nothing (RV6-22).
--
-- Writes are untouched on purpose. The two member write policies on
-- `cell_states` are gated on `is_gs()` (0028), and every other write is
-- `is_admin()`; widening the read set cannot widen either.
--
-- `coworker_names()` (0022) is the one project-gated read that does NOT go
-- through `my_projects()`: it joins `project_members` directly to decide whose
-- names a tablet may see beside a note. A viewer reading notes on a project it
-- was never assigned to would see every author as "Không rõ người ghi", so it
-- gains the same `is_viewer()` branch. Same grants, same definer, same pinned
-- search_path; verify_schema.sql row 34 still holds.
--
-- What is NOT done: `project_members` rows already held by viewers are left as
-- they are. They are harmless (nothing consults them for a viewer any more)
-- and deleting data in a migration that exists to widen a read would be the
-- wrong kind of surprise. The Users screen stops writing them for viewers
-- (RV6-25); the old rows only ever narrow, and narrow nothing now.
--
-- Purely additive: no table or column changes, no policy dropped or created.
-- Safe to apply ahead of the app that needs it — the deployed app still lands
-- a viewer on its first assigned project, which it can still read.

-- ---------------------------------------------------------------------------
-- 1. The predicate
-- ---------------------------------------------------------------------------
create or replace function is_viewer()
returns boolean
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and role = 'viewer' and active
  );
$$;

-- Functions are executable by PUBLIC unless told otherwise (see 0022, 0028).
revoke all on function is_viewer() from public, anon;
grant execute on function is_viewer() to authenticated;

-- ---------------------------------------------------------------------------
-- 2. The two functions every member read policy calls
-- ---------------------------------------------------------------------------
-- `create or replace` keeps the oid, the owner and the existing grants, so the
-- policies that name these functions are unaffected and no re-grant is needed.
-- The second half of each union is the body as 0007 / 0028 left it, verbatim.
create or replace function my_projects()
returns setof uuid
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select id
  from projects
  where is_viewer()
  union
  select pm.project_id
  from project_members pm
  join profiles p on p.id = pm.user_id
  where pm.user_id = auth.uid() and p.active;
$$;

create or replace function my_works()
returns setof uuid
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select id
  from works
  where is_viewer()
  union
  select w.id
  from works w
  join project_members pm on pm.project_id = w.project_id
  join profiles p on p.id = pm.user_id
  where pm.user_id = auth.uid() and p.active and pm.all_works
  union
  select wm.work_id
  from work_members wm
  join works w on w.id = wm.work_id
  join project_members pm on pm.project_id = w.project_id and pm.user_id = wm.user_id
  join profiles p on p.id = wm.user_id
  where wm.user_id = auth.uid() and p.active;
$$;

-- ---------------------------------------------------------------------------
-- 3. Names beside a note, for a viewer reading any project's notes
-- ---------------------------------------------------------------------------
create or replace function coworker_names()
returns table (id uuid, full_name text)
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select p.id, p.full_name
  from profiles p
  where p.role = 'admin'
     or is_viewer()
     or p.id in (
       select pm2.user_id
       from project_members pm1
       join project_members pm2 on pm2.project_id = pm1.project_id
       where pm1.user_id = auth.uid()
     );
$$;

-- ---------------------------------------------------------------------------
-- Prove it
-- ---------------------------------------------------------------------------
do $$
declare
  n int;
begin
  -- is_viewer(): present, definer, pinned, boolean, authenticated-only.
  if not exists (
    select 1 from pg_proc
    where pronamespace = 'public'::regnamespace and proname = 'is_viewer'
      and prosecdef
      and proconfig @> array['search_path=public, pg_temp']
      and pg_get_function_arguments(oid) = ''
      and pg_get_function_result(oid) = 'boolean'
  ) then
    raise exception '0034: is_viewer() is missing, not security definer, not pinned, or not "() returns boolean"';
  end if;
  if has_function_privilege('anon', 'public.is_viewer()', 'execute') then
    raise exception '0034: anon can execute is_viewer()';
  end if;
  if not has_function_privilege('authenticated', 'public.is_viewer()', 'execute') then
    raise exception '0034: authenticated cannot execute is_viewer()';
  end if;

  -- my_projects() and my_works(): still exactly one of each, same signature
  -- and return type as before, so every policy that names them still binds.
  -- A second overload would be the failure this check exists for: the policies
  -- would keep calling the OLD one and the viewer would read nothing new.
  select count(*) into n from pg_proc
  where pronamespace = 'public'::regnamespace and proname = 'my_projects';
  if n <> 1 then
    raise exception '0034: expected exactly one my_projects(), found %', n;
  end if;
  select count(*) into n from pg_proc
  where pronamespace = 'public'::regnamespace and proname = 'my_works';
  if n <> 1 then
    raise exception '0034: expected exactly one my_works(), found %', n;
  end if;
  if (select count(*) from pg_proc
      where pronamespace = 'public'::regnamespace
        and proname in ('my_projects', 'my_works')
        and prosecdef
        and proconfig @> array['search_path=public, pg_temp']
        and pg_get_function_arguments(oid) = ''
        and pg_get_function_result(oid) = 'SETOF uuid') <> 2 then
    raise exception '0034: my_projects()/my_works() are not both "() returns setof uuid", security definer, pinned';
  end if;
  -- Both bodies really consult the new predicate.
  if (select count(*) from pg_proc
      where pronamespace = 'public'::regnamespace
        and proname in ('my_projects', 'my_works', 'coworker_names')
        and prosrc like '%is_viewer()%') <> 3 then
    raise exception '0034: my_projects(), my_works() and coworker_names() do not all consult is_viewer()';
  end if;

  -- coworker_names() keeps the shape verify_schema.sql row 34 asserts.
  if not exists (
    select 1 from pg_proc
    where pronamespace = 'public'::regnamespace and proname = 'coworker_names'
      and prosecdef and proconfig @> array['search_path=public, pg_temp']
  ) then
    raise exception '0034: coworker_names() lost its definer or its pinned search_path';
  end if;
  if has_function_privilege('anon', 'public.coworker_names()', 'execute') then
    raise exception '0034: anon can execute coworker_names()';
  end if;

  -- No caller in a migration session: auth.uid() is null, so the predicate is
  -- false and both sets are empty. A true here would mean every anonymous
  -- request reads the whole company.
  if is_viewer() then
    raise exception '0034: is_viewer() is true with no caller';
  end if;
  if exists (select 1 from my_projects()) then
    raise exception '0034: my_projects() returns rows with no caller';
  end if;
  if exists (select 1 from my_works()) then
    raise exception '0034: my_works() returns rows with no caller';
  end if;

  -- The policies were not touched, and still route through the two functions
  -- whose bodies changed -- which is the whole mechanism of this migration.
  -- Five member reads via my_projects() (projects, decks, deck_guides, cells,
  -- zone_cells -- project_stages became deck_stages in 0018 and moved to
  -- my_works() in 0028), seven via my_works() (works, work_decks, deck_stages,
  -- cell_states, zones, cell_events, stage_plans), and the drawings bucket via
  -- my_projects() (0010).
  select count(*) into n from pg_policies
  where schemaname = 'public' and cmd = 'SELECT'
    and policyname like '%_member_read' and qual like '%my_projects()%';
  if n < 5 then
    raise exception '0034: only % public member read policies go through my_projects(), expected at least 5', n;
  end if;
  select count(*) into n from pg_policies
  where schemaname = 'public' and cmd = 'SELECT'
    and policyname like '%_member_read' and qual like '%my_works()%';
  if n < 7 then
    raise exception '0034: only % public member read policies go through my_works(), expected at least 7', n;
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'drawings_member_read' and cmd = 'SELECT'
      and qual like '%my_projects()%'
  ) then
    raise exception '0034: drawings_member_read is missing or no longer goes through my_projects()';
  end if;
end $$;
