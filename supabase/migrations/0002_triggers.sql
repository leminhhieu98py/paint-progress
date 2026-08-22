-- Bookkeeping columns are never supplied by the client.
create or replace function set_cell_audit_columns()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

create trigger cells_set_audit_columns
  before update on cells
  for each row
  execute function set_cell_audit_columns();

-- Stage history: supplies the per-cell date labels and the audit trail.
create or replace function log_cell_stage_change()
returns trigger
language plpgsql
as $$
begin
  if new.stage_id is distinct from old.stage_id then
    insert into cell_events (cell_id, from_stage_id, to_stage_id, by)
    values (new.id, old.stage_id, new.stage_id, auth.uid());
  end if;
  return null;
end;
$$;

create trigger cells_log_stage_change
  after update on cells
  for each row
  execute function log_cell_stage_change();

-- A cell may only carry a stage belonging to its own deck's project.
create or replace function assert_stage_belongs_to_project()
returns trigger
language plpgsql
as $$
declare
  cell_project uuid;
  stage_project uuid;
begin
  if new.stage_id is null then
    return new;
  end if;

  select d.project_id into cell_project
    from decks d where d.id = new.deck_id;

  select ps.project_id into stage_project
    from project_stages ps where ps.id = new.stage_id;

  if cell_project is distinct from stage_project then
    raise exception 'stage % does not belong to project % of deck %',
      new.stage_id, cell_project, new.deck_id;
  end if;

  return new;
end;
$$;

create trigger cells_assert_stage_project
  before insert or update on cells
  for each row
  execute function assert_stage_belongs_to_project();
