-- 0028: a third role, hidden accounts, and permission per work
-- (Feedback Rv2, items 1c, 1d, 1e, 2).
--
-- WHAT CHANGES FOR A DEPLOYED APP: nothing it can notice. Every existing
-- membership gets all_works = true, which is exactly the visibility it has
-- today; hidden defaults to false; no existing profile is a viewer. The
-- policies below only ever narrow what a member reads, and they narrow it to
-- the same set when all_works is true. So this can land before the app that
-- uses it, and must: the new app selects the new columns.
--
-- ---------------------------------------------------------------------------
-- 1. Roles. 'viewer' reads what a GS on the same projects reads and writes
--    nothing (the bosses' account). Enforced by is_gs() on the two member
--    write policies, not by the screen.
-- ---------------------------------------------------------------------------
alter table profiles drop constraint profiles_role_check;
alter table profiles
  add constraint profiles_role_check check (role in ('admin', 'gs', 'viewer'));

-- Hidden, never deleted (item 1e). cell_events.by and cell_states.updated_by
-- keep pointing at the row, so every note and history line still names the
-- person after they have left. The Users screen filters hidden rows out by
-- default and shows them on request.
alter table profiles add column hidden boolean not null default false;

-- ---------------------------------------------------------------------------
-- 2. Permission per work (item 1c). Per (account, project): every work of the
--    project (the default and today's behaviour) or the listed ones.
-- ---------------------------------------------------------------------------
alter table project_members add column all_works boolean not null default true;

create table work_members (
  work_id uuid not null references works    on delete cascade,
  user_id uuid not null references profiles on delete cascade,
  primary key (work_id, user_id)
);
create index work_members_user_id_idx on work_members (user_id);
comment on table work_members is
  'The works an account may see in a project whose membership has all_works = false. Rows for a project the account is no longer a member of are inert (my_works joins project_members).';

alter table work_members enable row level security;
create policy work_members_admin_all on work_members
  for all using (is_admin()) with check (is_admin());
create policy work_members_self_read on work_members
  for select using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 3. The two predicates every member policy below reads.
-- ---------------------------------------------------------------------------
create or replace function is_gs()
returns boolean
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and role = 'gs' and active
  );
$$;

-- The works the caller may see: all works of every project where the
-- membership says all_works, plus the listed works where it does not. Both
-- halves require an ACTIVE profile (as my_projects does) and, for the listed
-- half, a membership row for the work's project -- a work grant left behind
-- after the project membership was removed grants nothing.
create or replace function my_works()
returns setof uuid
language sql
security definer
set search_path = public, pg_temp
stable
as $$
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

revoke all on function is_gs() from public, anon;
revoke all on function my_works() from public, anon;
grant execute on function is_gs() to authenticated;
grant execute on function my_works() to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Member read policies that carry a work id now go through my_works().
--    A work belongs to exactly one project, so "work in my_works()" already
--    implies "deck in one of my projects"; the old deck predicate is dropped
--    rather than kept as a redundant second subquery. Decks, cells, guides
--    and drawings stay project-scoped on purpose: a deck is visible even when
--    none of its works are, and the GS screen shows it as unassigned.
-- ---------------------------------------------------------------------------
drop policy works_member_read on works;
create policy works_member_read on works
  for select using (id in (select my_works()));

drop policy work_decks_member_read on work_decks;
create policy work_decks_member_read on work_decks
  for select using (work_id in (select my_works()));

drop policy deck_stages_member_read on deck_stages;
create policy deck_stages_member_read on deck_stages
  for select using (work_id in (select my_works()));

drop policy cell_states_member_read on cell_states;
create policy cell_states_member_read on cell_states
  for select using (work_id in (select my_works()));

-- The writes are the GS's alone (item 2): a viewer passes my_works() and fails
-- is_gs(). cell_states_assert_gs_write (0024) still guards WHAT is written.
drop policy cell_states_member_insert on cell_states;
create policy cell_states_member_insert on cell_states
  for insert with check (is_gs() and work_id in (select my_works()));

drop policy cell_states_member_update on cell_states;
create policy cell_states_member_update on cell_states
  for update
  using (is_gs() and work_id in (select my_works()))
  with check (is_gs() and work_id in (select my_works()));

-- A zone is planned for one stage, and the stage names the work.
drop policy zones_member_read on zones;
create policy zones_member_read on zones
  for select using (
    stage_id in (select id from deck_stages where work_id in (select my_works()))
  );

-- History follows the work too. A row whose work_id is null (the work was
-- deleted, 0026) is the admin's to read; the member's screens never list it.
drop policy cell_events_member_read on cell_events;
create policy cell_events_member_read on cell_events
  for select using (work_id in (select my_works()));

do $$
begin
  if not exists (
    select 1 from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname in ('is_gs', 'my_works')
      and prosecdef
      and proconfig @> array['search_path=public, pg_temp']
    having count(*) = 2
  ) then
    raise exception '0028: is_gs()/my_works() are not both security definer with a pinned search_path';
  end if;
  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'work_members') <> 2 then
    raise exception '0028: work_members must carry exactly two policies';
  end if;
end $$;
