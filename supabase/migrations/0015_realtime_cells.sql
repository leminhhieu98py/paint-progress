-- Realtime delivers Postgres changes only for tables in the publication the
-- Realtime service replicates, and Supabase creates `supabase_realtime` with no
-- tables in it. Without this, the GS screen's channel connects, reports
-- SUBSCRIBED, and receives nothing -- forever, with no error on the client, in
-- the server logs, or in any test that mocks the channel. Spec §11 row 3 (last
-- write wins, every open client converged) depends entirely on it.
--
-- Only `cells` is published. It is the only table a GS writes and the only one
-- whose changes another client has to see live; publishing the configuration
-- tables would stream an admin's editing keystrokes to every tablet on site.
--
-- RLS still applies: Realtime evaluates the subscriber's own policies for
-- postgres_changes, so cells_member_read (0006) is what limits a foreman to
-- their own project's decks. Publishing a table does not widen who can read it.
--
-- The membership check makes this idempotent -- `alter publication ... add
-- table` errors if the table is already a member, which would break a re-run of
-- the migration history being replayed. The publication's own absence raises
-- instead of skipping: silently
-- carrying on would leave realtime dead with a green migration, which is the
-- exact failure mode this file exists to prevent.
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise exception 'publication supabase_realtime is missing; realtime cannot be enabled';
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'cells'
  ) then
    alter publication supabase_realtime add table public.cells;
  end if;
end $$;
