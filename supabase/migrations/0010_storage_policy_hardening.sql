-- Compare the path segment as TEXT against the project ids cast to text, rather
-- than casting the segment to uuid. A first segment that is not a valid uuid
-- would raise 22P02 inside the policy, and an error in a policy is not a deny:
-- one malformed object name would turn every GS's bucket listing into a hard
-- failure instead of just hiding that object.
drop policy drawings_member_read on storage.objects;

create policy drawings_member_read on storage.objects
  for select using (
    bucket_id = 'drawings'
    and (storage.foldername(name))[1] in (
      select p::text from my_projects() as p
    )
  );

-- Note for whoever edits these policies next: anon and authenticated hold stock
-- Supabase INSERT/UPDATE/DELETE grants on storage.objects, so RLS is the only
-- thing preventing a GS from writing or deleting any drawing. drawings_admin_all
-- is the sole policy covering those commands -- drawings_member_read is
-- select-only. Dropping or loosening drawings_admin_all reopens writes for every
-- authenticated user, silently, with no error.
