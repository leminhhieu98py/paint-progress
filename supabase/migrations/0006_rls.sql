-- Helpers -------------------------------------------------------------------
create or replace function is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and role = 'admin' and active
  );
$$;

create or replace function my_projects()
returns setof uuid
language sql
security definer
set search_path = public
stable
as $$
  select project_id from project_members where user_id = auth.uid();
$$;

-- Enable RLS everywhere. Default deny: a table with RLS on and no matching
-- policy rejects every request.
alter table profiles              enable row level security;
alter table gs_credentials        enable row level security;
alter table credential_access_log enable row level security;
alter table projects              enable row level security;
alter table project_stages        enable row level security;
alter table project_members       enable row level security;
alter table decks                 enable row level security;
alter table deck_guides           enable row level security;
alter table cells                 enable row level security;
alter table zones                 enable row level security;
alter table zone_cells            enable row level security;
alter table cell_events           enable row level security;

-- profiles ------------------------------------------------------------------
create policy profiles_admin_all on profiles
  for all using (is_admin()) with check (is_admin());

create policy profiles_self_read on profiles
  for select using (id = auth.uid());

-- gs_credentials / credential_access_log ------------------------------------
-- No policy for gs_credentials at all: service_role bypasses RLS, everyone
-- else is denied. The admin's browser session cannot read it either.
create policy credential_log_admin_read on credential_access_log
  for select using (is_admin());

-- Domain tables -------------------------------------------------------------
create policy projects_admin_all on projects
  for all using (is_admin()) with check (is_admin());
create policy projects_member_read on projects
  for select using (id in (select my_projects()));

create policy project_stages_admin_all on project_stages
  for all using (is_admin()) with check (is_admin());
create policy project_stages_member_read on project_stages
  for select using (project_id in (select my_projects()));

create policy project_members_admin_all on project_members
  for all using (is_admin()) with check (is_admin());
create policy project_members_self_read on project_members
  for select using (user_id = auth.uid());

create policy decks_admin_all on decks
  for all using (is_admin()) with check (is_admin());
create policy decks_member_read on decks
  for select using (project_id in (select my_projects()));

create policy deck_guides_admin_all on deck_guides
  for all using (is_admin()) with check (is_admin());
create policy deck_guides_member_read on deck_guides
  for select using (
    deck_id in (select id from decks where project_id in (select my_projects()))
  );

create policy zones_admin_all on zones
  for all using (is_admin()) with check (is_admin());
create policy zones_member_read on zones
  for select using (
    deck_id in (select id from decks where project_id in (select my_projects()))
  );

create policy zone_cells_admin_all on zone_cells
  for all using (is_admin()) with check (is_admin());
create policy zone_cells_member_read on zone_cells
  for select using (
    zone_id in (
      select z.id from zones z
      join decks d on d.id = z.deck_id
      where d.project_id in (select my_projects())
    )
  );

-- cells: GS reads its projects and updates nothing but the stage -----------
create policy cells_admin_all on cells
  for all using (is_admin()) with check (is_admin());

create policy cells_member_read on cells
  for select using (
    deck_id in (select id from decks where project_id in (select my_projects()))
  );

create policy cells_member_update on cells
  for update using (
    deck_id in (select id from decks where project_id in (select my_projects()))
  ) with check (
    deck_id in (select id from decks where project_id in (select my_projects()))
  );

-- The policy above still permits a crafted request to change geometry. A column
-- GRANT cannot fix that: admin and GS both authenticate as the same Postgres
-- role (`authenticated`), so `grant update (stage_id)` would also block the
-- admin's geometry editing in Phase 2. The restriction has to be per-caller,
-- which means a trigger.
create or replace function assert_gs_updates_stage_only()
returns trigger
language plpgsql
as $$
begin
  if is_admin() then
    return new;
  end if;

  if new.deck_id is distinct from old.deck_id
     or new.code    is distinct from old.code
     or new.x       is distinct from old.x
     or new.y       is distinct from old.y
     or new.w       is distinct from old.w
     or new.h       is distinct from old.h
     or new.area_m2 is distinct from old.area_m2
  then
    raise exception 'only stage_id may be changed by a non-admin';
  end if;

  return new;
end;
$$;

-- Must fire before cells_set_audit_columns so a rejected write never stamps
-- updated_at. Postgres runs same-timing triggers in name order, and
-- 'cells_assert_gs_stage_only' sorts before 'cells_set_audit_columns'.
create trigger cells_assert_gs_stage_only
  before update on cells
  for each row
  execute function assert_gs_updates_stage_only();

create policy cell_events_admin_read on cell_events
  for select using (is_admin());
create policy cell_events_member_read on cell_events
  for select using (
    cell_id in (
      select c.id from cells c
      join decks d on d.id = c.deck_id
      where d.project_id in (select my_projects())
    )
  );
