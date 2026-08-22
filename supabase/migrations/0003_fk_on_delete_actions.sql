-- Stage history must survive a stage being reconfigured or a project deleted.
-- The event keeps its timestamp and actor; only the stage reference goes null.
alter table cell_events
  drop constraint cell_events_from_stage_id_fkey,
  add  constraint cell_events_from_stage_id_fkey
       foreign key (from_stage_id) references project_stages on delete set null;

alter table cell_events
  drop constraint cell_events_to_stage_id_fkey,
  add  constraint cell_events_to_stage_id_fkey
       foreign key (to_stage_id) references project_stages on delete set null;

-- A zone is a plan for one specific stage. If that stage is removed from the
-- project's configuration the plan is meaningless, so it goes with it. Cascade
-- rather than set null because zones.stage_id is NOT NULL.
alter table zones
  drop constraint zones_stage_id_fkey,
  add  constraint zones_stage_id_fkey
       foreign key (stage_id) references project_stages on delete cascade;

-- Who did what must outlive the actor's account. Accounts are normally
-- deactivated rather than deleted, but profiles.id cascades from auth.users,
-- so a genuine auth deletion must not be blocked by history.
alter table cells
  drop constraint cells_updated_by_fkey,
  add  constraint cells_updated_by_fkey
       foreign key (updated_by) references profiles on delete set null;

alter table cell_events
  drop constraint cell_events_by_fkey,
  add  constraint cell_events_by_fkey
       foreign key (by) references profiles on delete set null;

-- An audit log that disappears when its subject is deleted is not an audit log.
-- Both columns must therefore become nullable before they can be set null.
alter table credential_access_log
  alter column admin_id drop not null,
  alter column target_user_id drop not null;

alter table credential_access_log
  drop constraint credential_access_log_admin_id_fkey,
  add  constraint credential_access_log_admin_id_fkey
       foreign key (admin_id) references profiles on delete set null;

alter table credential_access_log
  drop constraint credential_access_log_target_user_id_fkey,
  add  constraint credential_access_log_target_user_id_fkey
       foreign key (target_user_id) references profiles on delete set null;
