-- Work items (Công việc): progress by work, not by m² alone.
--
-- Feedback Rv1 item 2, and Linh's `Ví dụ tính tiến độ của 1 dự án.xlsx`: a
-- project is paid for several disciplines -- sơn, tháo giáo, dọn dẹp,
-- marking -- each with its own weight, some of them outside the project total,
-- and a deck's weight inside a discipline is the admin's number, not its m².
-- The owner chose the model where a bay carries ONE POSITION PER WORK, so
-- painting and scaffold removal advance independently on the same bay.
--
--   projects
--   └── works               W_w, counts, kind ∈ {bays, manual}
--       ├── work_decks       D_wd
--       ├── deck_stages      now keyed by (work_id, deck_id)
--       └── cell_states      one row per (cell, work): stage, note, audit
--
-- What this migration promises: every existing percentage stays where it was.
-- Each project gets one bays work of weight 1 that counts, containing every
-- deck at its m² share, with every existing coat and every bay's current
-- stage moved under it -- the exact shape the domain's equivalence test
-- proves reproduces the old formula to the last digit.
--
-- Every trigger that lived on `cells` moves to `cell_states`, rewritten from
-- its CURRENT definition (0020's lesson: `create or replace` replaces, so the
-- source must be the newest one, never the easiest one to find). The four
-- progress columns on `cells` are then dropped: `cells` is geometry from here.
--
-- Deploy order: push this, then deploy the app, minutes apart. The app on
-- `main` today reads `cells.stage_id` and will show no progress in between.

-- ---------------------------------------------------------------------------
-- 1. works
-- ---------------------------------------------------------------------------
create table works (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references projects on delete cascade,
  seq             int  not null,
  name            text not null,
  kind            text not null check (kind in ('bays', 'manual')),
  -- W_w. Across the works that count these sum to 1; enforced by the API save,
  -- as stage weights always have been.
  weight          numeric(6,5) not null default 0 check (weight >= 0 and weight <= 1),
  -- Tính vào tổng. Marking, chứng từ, lên xà lan are tracked but not summed.
  counts          boolean not null default true,
  -- Read only for kind = 'manual': the percentage the admin types.
  manual_progress numeric(6,5) not null default 0 check (manual_progress >= 0 and manual_progress <= 1),
  created_at      timestamptz not null default now(),
  -- Deferrable, like deck_stages.seq: a drag-reorder swaps two seqs in one
  -- statement.
  unique (project_id, seq) deferrable initially deferred,
  unique (project_id, name)
);
create index works_project_id_idx on works (project_id);

comment on table works is
  'Work items (Công việc) of a project. weight is W_w; the ones with counts = true sum to 1.';

alter table works enable row level security;
create policy works_admin_all on works
  for all using (is_admin()) with check (is_admin());
create policy works_member_read on works
  for select using (project_id in (select my_projects()));

-- ---------------------------------------------------------------------------
-- 2. work_decks -- which decks a bays work covers, and at what weight
-- ---------------------------------------------------------------------------
create table work_decks (
  work_id uuid not null references works on delete cascade,
  deck_id uuid not null references decks on delete cascade,
  -- D_wd. Across one work's decks these sum to 1; enforced by the API save.
  weight  numeric(6,5) not null default 0 check (weight >= 0 and weight <= 1),
  primary key (work_id, deck_id)
);
create index work_decks_deck_id_idx on work_decks (deck_id);

alter table work_decks enable row level security;
create policy work_decks_admin_all on work_decks
  for all using (is_admin()) with check (is_admin());
create policy work_decks_member_read on work_decks
  for select using (
    work_id in (select id from works where project_id in (select my_projects()))
  );

-- ---------------------------------------------------------------------------
-- 3. Backfill: one work per project, every deck in it at its m² share
-- ---------------------------------------------------------------------------
insert into works (project_id, seq, name, kind, weight, counts)
select p.id, 1, 'Công việc chính', 'bays', 1, true
from projects p;

-- m² share, or equal shares when no deck declares an area yet. Weights are
-- numeric(6,5): the rounding is at the fifth decimal, inside the epsilon the
-- API holds sums to.
insert into work_decks (work_id, deck_id, weight)
select w.id, d.id,
       case
         when t.total > 0 then round(d.total_area_m2 / t.total, 5)
         else round(1.0 / t.n, 5)
       end
from decks d
join works w on w.project_id = d.project_id
join (
  select project_id, sum(total_area_m2) as total, count(*) as n
  from decks group by project_id
) t on t.project_id = d.project_id;

-- ---------------------------------------------------------------------------
-- 4. deck_stages belong to a (work, deck)
-- ---------------------------------------------------------------------------
alter table deck_stages add column work_id uuid references works on delete cascade;

update deck_stages s
set work_id = w.id
from decks d
join works w on w.project_id = d.project_id
where d.id = s.deck_id;

alter table deck_stages alter column work_id set not null;
alter table deck_stages drop constraint deck_stages_deck_id_seq_key;
alter table deck_stages
  add constraint deck_stages_work_id_deck_id_seq_key
  unique (work_id, deck_id, seq) deferrable initially deferred;
create index deck_stages_work_id_idx on deck_stages (work_id);

comment on table deck_stages is
  'Paint stages of one (work, deck), innermost first by seq. Weights sum to 1 per (work, deck).';

-- ---------------------------------------------------------------------------
-- 5. cell_states -- where each bay stands, per work
-- ---------------------------------------------------------------------------
create table cell_states (
  cell_id    uuid not null references cells on delete cascade,
  work_id    uuid not null references works on delete cascade,
  -- Denormalised from cells so RLS and the realtime filter can see the deck
  -- without a join; a trigger below refuses a row whose deck_id lies.
  deck_id    uuid not null references decks on delete cascade,
  stage_id   uuid references deck_stages on delete set null,
  note       text not null default '',
  updated_at timestamptz not null default now(),
  updated_by uuid references profiles on delete set null,
  primary key (cell_id, work_id)
);
create index cell_states_deck_id_idx on cell_states (deck_id);
create index cell_states_work_id_idx on cell_states (work_id);

comment on table cell_states is
  'One row per (bay, work): the stage the bay has reached in that work, the note left with it, and who moved it.';

alter table cell_states enable row level security;
create policy cell_states_admin_all on cell_states
  for all using (is_admin()) with check (is_admin());
create policy cell_states_member_read on cell_states
  for select using (
    deck_id in (select id from decks where project_id in (select my_projects()))
  );
-- The foreman's write is an upsert: the first tick on a bay for a work
-- creates the row, later ticks update it. No member delete.
create policy cell_states_member_insert on cell_states
  for insert with check (
    deck_id in (select id from decks where project_id in (select my_projects()))
  );
create policy cell_states_member_update on cell_states
  for update using (
    deck_id in (select id from decks where project_id in (select my_projects()))
  ) with check (
    deck_id in (select id from decks where project_id in (select my_projects()))
  );

-- Realtime, as 0015/0016 did for cells: in the publication, and with a full
-- replica identity so a DELETE's old record carries deck_id for the filter.
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise exception 'publication supabase_realtime is missing; realtime cannot be enabled';
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'cell_states'
  ) then
    alter publication supabase_realtime add table public.cell_states;
  end if;
end $$;
alter table public.cell_states replica identity full;

-- 5a. The row must be about the cell's own deck, the (work, deck) must exist,
-- and the stage must belong to that (work, deck). Replaces
-- assert_stage_belongs_to_project, which asserted the deck half on cells.
create or replace function assert_cell_state_consistent()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  cell_deck uuid;
  stage_work uuid;
  stage_deck uuid;
begin
  select c.deck_id into cell_deck from cells c where c.id = new.cell_id;
  if cell_deck is distinct from new.deck_id then
    raise exception 'cell_states.deck_id % does not match cell %''s deck %', new.deck_id, new.cell_id, cell_deck;
  end if;
  if not exists (select 1 from work_decks wd where wd.work_id = new.work_id and wd.deck_id = new.deck_id) then
    raise exception 'deck % is not part of work %', new.deck_id, new.work_id;
  end if;
  if new.stage_id is not null then
    select s.work_id, s.deck_id into stage_work, stage_deck from deck_stages s where s.id = new.stage_id;
    if stage_work is distinct from new.work_id or stage_deck is distinct from new.deck_id then
      raise exception 'stage % does not belong to work % on deck %', new.stage_id, new.work_id, new.deck_id;
    end if;
  end if;
  return new;
end;
$$;

-- 5b. A non-admin may set stage_id and note, and nothing else; and a note
-- only together with the stage (0019's rule: the log fires on a stage
-- change, so a note-only write would move the note with nothing in
-- cell_events naming who wrote it). On INSERT the audit columns need no
-- guard: the stamper (5c, which fires after this one -- trigger names fire
-- alphabetically for one event) overwrites both unconditionally, so nothing a
-- client supplies there can survive. Replaces assert_gs_updates_stage_only.
create or replace function assert_gs_state_write()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if is_admin() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.stage_id is null and new.note <> '' then
      raise exception 'a note may only be changed together with the stage';
    end if;
    return new;
  end if;
  if new.cell_id    is distinct from old.cell_id
     or new.work_id    is distinct from old.work_id
     or new.deck_id    is distinct from old.deck_id
     or new.updated_at is distinct from old.updated_at
     or new.updated_by is distinct from old.updated_by
  then
    raise exception 'only stage_id and note may be changed by a non-admin';
  end if;
  if new.note is distinct from old.note
     and new.stage_id is not distinct from old.stage_id
  then
    raise exception 'a note may only be changed together with the stage';
  end if;
  return new;
end;
$$;

-- 5c. Stamp who and when, only when the stage actually moves (0011's rule),
-- and always on the first row. Replaces set_cell_audit_columns.
create or replace function set_cell_state_audit_columns()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE' and new.stage_id is not distinct from old.stage_id then
    return new;
  end if;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

-- 5d. The audit log, now naming the work. Definer, as 0007 made it: with RLS
-- on cell_events a GS session inserting its own audit row is refused. The
-- 0004 and 0014 guards carry over unchanged in meaning.
create or replace function log_cell_state_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  old_stage uuid;
begin
  old_stage := case when tg_op = 'INSERT' then null else old.stage_id end;
  if new.stage_id is not distinct from old_stage then
    return null;
  end if;
  -- 0004: this AFTER trigger can fire for a cell the same statement deleted.
  if not exists (select 1 from cells where id = new.cell_id) then
    return null;
  end if;
  -- 0014: the stage went to null because its row was deleted, not because
  -- anybody moved the bay back.
  if new.stage_id is null
     and old_stage is not null
     and not exists (select 1 from deck_stages where id = old_stage) then
    return null;
  end if;
  insert into cell_events (cell_id, work_id, work_name,
                           from_stage_id, to_stage_id, from_stage_name, to_stage_name,
                           note, by)
  values (new.cell_id, new.work_id, (select name from works where id = new.work_id),
          old_stage, new.stage_id,
          (select name from deck_stages where id = old_stage),
          (select name from deck_stages where id = new.stage_id),
          new.note, auth.uid());
  return null;
end;
$$;

create trigger cell_states_assert_consistent
  before insert or update on cell_states
  for each row execute function assert_cell_state_consistent();
create trigger cell_states_assert_gs_write
  before insert or update on cell_states
  for each row execute function assert_gs_state_write();
create trigger cell_states_set_audit_columns
  before insert or update on cell_states
  for each row execute function set_cell_state_audit_columns();
create trigger cell_states_log_stage_change
  after insert or update on cell_states
  for each row execute function log_cell_state_change();

-- ---------------------------------------------------------------------------
-- 6. cell_events name the work
-- ---------------------------------------------------------------------------
alter table cell_events
  add column work_id   uuid references works on delete set null,
  add column work_name text;

update cell_events e
set work_id = w.id, work_name = w.name
from cells c
join decks d on d.id = c.deck_id
join works w on w.project_id = d.project_id
where c.id = e.cell_id;

-- ---------------------------------------------------------------------------
-- 7. Backfill cell_states from cells, with the triggers held: this is a move,
--    not a stage change, and must write no events and stamp nobody.
-- ---------------------------------------------------------------------------
alter table cell_states disable trigger user;
insert into cell_states (cell_id, work_id, deck_id, stage_id, note, updated_at, updated_by)
select c.id, w.id, c.deck_id, c.stage_id, coalesce(c.note, ''), c.updated_at, c.updated_by
from cells c
join decks d on d.id = c.deck_id
join works w on w.project_id = d.project_id;
alter table cell_states enable trigger user;

-- ---------------------------------------------------------------------------
-- 8. Stage deletion still writes one event per bay that sat at the stage --
--    read from cell_states now. Trigger deck_stages_log_deletion stays.
-- ---------------------------------------------------------------------------
create or replace function log_stage_deletion_on_cells()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- 0004's lesson: deleting a project fans out into decks -> deck_stages
  -- (firing this) racing decks -> cells CASCADE at another depth. When the
  -- deck is already gone its bays are going with it.
  insert into cell_events (cell_id, work_id, work_name,
                           from_stage_id, to_stage_id, from_stage_name, to_stage_name, by)
  select cs.cell_id, cs.work_id, (select name from works where id = cs.work_id),
         old.id, null, old.name, null, auth.uid()
  from cell_states cs
  where cs.stage_id = old.id
    and exists (select 1 from decks d where d.id = old.deck_id);
  return old;
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. cells is geometry from here: drop the progress triggers, then the
--    columns, then the functions nothing calls any more.
-- ---------------------------------------------------------------------------
drop trigger if exists cells_set_audit_columns    on cells;
drop trigger if exists cells_log_stage_change     on cells;
drop trigger if exists cells_assert_stage_project on cells;
drop trigger if exists cells_assert_gs_stage_only on cells;
drop policy  if exists cells_member_update on cells;

alter table cells
  drop column stage_id,
  drop column note,
  drop column updated_at,
  drop column updated_by;

drop function if exists set_cell_audit_columns();
drop function if exists log_cell_stage_change();
drop function if exists assert_stage_belongs_to_project();
drop function if exists assert_gs_updates_stage_only();

-- ---------------------------------------------------------------------------
-- 10. Prove the move
-- ---------------------------------------------------------------------------
do $$
declare
  n_projects int; n_works int; n_cells int; n_states int; n_stages_orphan int; n_events_orphan int;
begin
  select count(*) into n_projects from projects;
  select count(*) into n_works from works;
  if n_works <> n_projects then
    raise exception 'works: % rows for % projects', n_works, n_projects;
  end if;
  select count(*) into n_cells from cells;
  select count(*) into n_states from cell_states;
  if n_states <> n_cells then
    raise exception 'cell_states: % rows for % cells', n_states, n_cells;
  end if;
  select count(*) into n_stages_orphan from deck_stages where work_id is null;
  if n_stages_orphan <> 0 then
    raise exception '% deck_stages rows have no work_id', n_stages_orphan;
  end if;
  select count(*) into n_events_orphan
  from cell_events e join cells c on c.id = e.cell_id
  where e.work_id is null;
  if n_events_orphan <> 0 then
    raise exception '% cell_events rows on live cells have no work_id', n_events_orphan;
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'cells' and column_name = 'stage_id'
  ) then
    raise exception 'cells.stage_id still exists';
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'cell_states'
  ) then
    raise exception 'cell_states is not published for realtime';
  end if;
end $$;
