-- Identity ------------------------------------------------------------------
create table profiles (
  id         uuid primary key references auth.users on delete cascade,
  username   text not null unique,
  full_name  text not null,
  role       text not null check (role in ('admin','gs')),
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

-- Admin-readable credentials. service_role only; see spec §7.
create table gs_credentials (
  user_id uuid primary key references profiles on delete cascade,
  secret  text not null                                  -- AES-GCM, "<iv>.<ciphertext>" base64
);

create table credential_access_log (
  id             bigserial primary key,
  admin_id       uuid not null references profiles,
  target_user_id uuid not null references profiles,
  at             timestamptz not null default now()
);

-- Domain --------------------------------------------------------------------
create table projects (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  code       text not null unique,
  created_at timestamptz not null default now()
);

create table project_stages (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects on delete cascade,
  seq        int  not null,
  name       text not null,
  color      text not null,
  weight     numeric(6,5) not null check (weight >= 0 and weight <= 1),
  unique (project_id, seq)
);

create table project_members (
  project_id uuid references projects on delete cascade,
  user_id    uuid references profiles on delete cascade,
  primary key (project_id, user_id)
);

create table decks (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references projects on delete cascade,
  seq           int  not null,
  name          text not null,
  code          text not null,
  image_path    text,
  image_w       int,
  image_h       int,
  total_area_m2 numeric(12,2) not null default 0,
  area_source   text not null default 'guides'
                check (area_source in ('guides','prorated')),
  unique (project_id, code)
);

create table deck_guides (
  id        uuid primary key default gen_random_uuid(),
  deck_id   uuid not null references decks on delete cascade,
  axis      text not null check (axis in ('x','y')),
  pos       numeric(8,6) not null check (pos >= 0 and pos <= 1),
  offset_mm numeric(12,2) not null,
  label     text
);

create table cells (
  id         uuid primary key default gen_random_uuid(),
  deck_id    uuid not null references decks on delete cascade,
  code       text not null,
  x          numeric(8,6) not null,
  y          numeric(8,6) not null,
  w          numeric(8,6) not null,
  h          numeric(8,6) not null,
  area_m2    numeric(12,3) not null,
  stage_id   uuid references project_stages on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references profiles,
  unique (deck_id, code)
);

create table zones (
  id          uuid primary key default gen_random_uuid(),
  deck_id     uuid not null references decks on delete cascade,
  seq         int  not null,
  name        text not null,
  stage_id    uuid not null references project_stages,
  start_date  date,
  finish_date date,
  unique (deck_id, stage_id, seq)
);

create table zone_cells (
  zone_id uuid references zones on delete cascade,
  cell_id uuid references cells on delete cascade,
  primary key (zone_id, cell_id)
);

create table cell_events (
  id            bigserial primary key,
  cell_id       uuid not null references cells on delete cascade,
  from_stage_id uuid references project_stages,
  to_stage_id   uuid references project_stages,
  at            timestamptz not null default now(),
  by            uuid references profiles
);

-- Indexes for the access paths the app actually uses ------------------------
create index cells_deck_id_idx        on cells (deck_id);
create index decks_project_id_idx     on decks (project_id);
create index deck_guides_deck_id_idx  on deck_guides (deck_id);
create index zones_deck_id_idx        on zones (deck_id);
create index cell_events_cell_id_idx  on cell_events (cell_id, at desc);
create index project_members_user_idx on project_members (user_id);
