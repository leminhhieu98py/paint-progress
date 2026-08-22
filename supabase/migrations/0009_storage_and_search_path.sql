-- Private bucket for deck drawings. Phase 1 shipped no bucket at all, which the
-- whole-branch review flagged: Phase 2's first upload would have been the test.
insert into storage.buckets (id, name, public)
values ('drawings', 'drawings', false)
on conflict (id) do nothing;

-- Path convention is {project_id}/{deck_id}.png, so the project id is the first
-- folder segment. storage.foldername() splits on '/' and is 1-indexed.
create policy drawings_admin_all on storage.objects
  for all using (bucket_id = 'drawings' and is_admin())
  with check (bucket_id = 'drawings' and is_admin());

create policy drawings_member_read on storage.objects
  for select using (
    bucket_id = 'drawings'
    and (storage.foldername(name))[1]::uuid in (select my_projects())
  );

-- The last two definer/invoker functions left without a pinned search_path.
-- assert_stage_belongs_to_project resolves decks and project_stages from
-- whatever PostgREST sets per request, so a change to db-extra-search-path
-- would break the central write in a way neither verification layer sees.
create or replace function assert_stage_belongs_to_project()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  cell_project uuid;
  stage_project uuid;
begin
  if new.stage_id is null then
    return new;
  end if;

  select d.project_id into cell_project from decks d where d.id = new.deck_id;
  select ps.project_id into stage_project from project_stages ps where ps.id = new.stage_id;

  if cell_project is distinct from stage_project then
    raise exception 'stage % does not belong to project % of deck %',
      new.stage_id, cell_project, new.deck_id;
  end if;

  return new;
end;
$$;

create or replace function set_cell_audit_columns()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;
