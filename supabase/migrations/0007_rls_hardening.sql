-- The audit writer must run as the system. With RLS enabled on cell_events and
-- no INSERT policy, a security-invoker trigger makes every stage change fail
-- with 42501. Elevating the function keeps the table append-only-by-system:
-- clients cannot forge, alter or delete an event, and auth.uid() still resolves
-- from the request JWT so the real actor is recorded.
create or replace function log_cell_stage_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.stage_id is distinct from old.stage_id
     and exists (select 1 from cells where id = new.id) then
    insert into cell_events (cell_id, from_stage_id, to_stage_id,
                             from_stage_name, to_stage_name, by)
    values (new.id, old.stage_id, new.stage_id,
            (select name from project_stages where id = old.stage_id),
            (select name from project_stages where id = new.stage_id),
            auth.uid());
  end if;
  return null;
end;
$$;

-- A GS could renumber a cell's primary key: `id` was compared by nothing, and
-- cells_member_update's with-check only constrains deck_id. Also pin the
-- search_path -- this function is a privilege boundary and calls is_admin().
create or replace function assert_gs_updates_stage_only()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if is_admin() then
    return new;
  end if;

  if new.id      is distinct from old.id
     or new.deck_id is distinct from old.deck_id
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

-- Deactivation was asymmetric: is_admin() checks profiles.active but
-- my_projects() never did, so a deactivated GS kept read access until Task 7's
-- handler removed their project_members rows. Close it at the RLS layer.
create or replace function my_projects()
returns setof uuid
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select pm.project_id
  from project_members pm
  join profiles p on p.id = pm.user_id
  where pm.user_id = auth.uid() and p.active;
$$;

-- gs_credentials currently relies on RLS-with-no-policy as its only barrier,
-- while anon and authenticated still hold table grants from Supabase defaults.
-- Revoking makes it fail closed if a policy is ever added by mistake.
revoke all on gs_credentials from anon, authenticated;
