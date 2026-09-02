-- Names a tablet may put beside a note.
--
-- profiles is readable by admins and by the row's own user (0006), and that
-- stays. The note thread on the GS modal (Feedback Rv1, item 7) shows every
-- earlier remark on a bay with who wrote it, and a GS reading profiles gets
-- nobody but themselves -- every author would render as "Không rõ người ghi".
-- Widening the profiles policy would hand every tablet `role` and `active`
-- for every account; this hands it two columns.
--
-- Definer, so the read runs as the function owner past profiles' RLS, with
-- the audience decided here: admins, and anyone sharing a project with the
-- caller. Granted to authenticated only: an anonymous client is refused at
-- the grant (42501) rather than given an empty set it could not tell from
-- "nobody shares a project with you".
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
     or p.id in (
       select pm2.user_id
       from project_members pm1
       join project_members pm2 on pm2.project_id = pm1.project_id
       where pm1.user_id = auth.uid()
     );
$$;

-- Functions are executable by PUBLIC unless told otherwise. Revoke first, so
-- the grant below is the whole audience.
revoke all on function coworker_names() from public, anon;
grant execute on function coworker_names() to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_proc where proname = 'coworker_names' and prosecdef
  ) then
    raise exception 'coworker_names is missing or is not security definer';
  end if;
  if has_function_privilege('anon', 'coworker_names()', 'execute') then
    raise exception 'anon can execute coworker_names';
  end if;
  if not has_function_privilege('authenticated', 'coworker_names()', 'execute') then
    raise exception 'authenticated cannot execute coworker_names';
  end if;
end $$;
