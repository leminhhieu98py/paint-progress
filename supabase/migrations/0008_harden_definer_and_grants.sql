-- is_admin() is what every admin policy resolves through, so its resolution
-- path is part of the security boundary. Bare `search_path = public` still
-- searches pg_temp first for relation names, and `authenticated` does hold
-- TEMPORARY on this database -- so a session that could run DDL could shadow
-- `profiles` and make this return true. Listing pg_temp last closes it.
create or replace function is_admin()
returns boolean
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and role = 'admin' and active
  );
$$;

-- Reverting an elevation that was granted for no reason. This guard reads no
-- tables; its only call, is_admin(), is already definer and so is unaffected by
-- the caller's privileges. SET search_path works the same on an invoker
-- function. Leaving it definer would mean any table access added here later
-- silently bypasses RLS.
create or replace function assert_gs_updates_stage_only()
returns trigger
language plpgsql
security invoker
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

-- Both tables are append-only-by-system: cell_events is written by the definer
-- trigger as postgres, credential_access_log by the Edge Function as
-- service_role. No client needs a write grant on either, so revoking makes them
-- fail closed on grants rather than closed only by policy -- the same treatment
-- gs_credentials already has. SELECT stays so the read policies still work.
revoke insert, update, delete on cell_events from anon, authenticated;
revoke insert, update, delete on credential_access_log from anon, authenticated;
