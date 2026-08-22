-- A stage's identity is its id. seq is display order, and reordering has to be
-- able to swap two seqs inside one statement.
--
-- cells.stage_id and zones.stage_id point at project_stages ROWS, while the
-- stage config panel renumbers seq 1..n on every structural change. So while
-- saveStages upserted on (project_id, seq), the write rewrote whatever row sat
-- at each seq: clicking "Lên" on Coat 3 renamed the row holding Coat 2's
-- recorded progress, and every cell recorded at Coat 2 was thereafter counted as
-- Coat 3 -- a later, heavier stage, so the deck's reported percentage rose with
-- nothing deleted and nothing on screen to explain it. saveStages now upserts on
-- id, so a rename, a reweight and a reorder all preserve every row's id and
-- every cell keeps pointing at the stage the admin meant.
--
-- That makes seq an ordinary column that a reorder UPDATEs, which is where this
-- constraint gets in the way. `unique (project_id, seq)` as 0001 created it is
-- IMMEDIATE: it is checked after each row of a statement is written, not at the
-- end. A swap of seq 2 and seq 3 arrives as one `insert ... on conflict (id) do
-- update` with both rows in it, and after the first row is written two rows
-- momentarily hold the same seq -- so the immediate check rejects a statement
-- whose final state is perfectly unique.
--
-- DO NOT "tidy" this back to a plain unique constraint. Deferring the check does
-- not weaken it: duplicate seqs within one project are still impossible at
-- commit, which is the only moment any reader can observe them. What it buys is
-- the intermediate state a reorder cannot avoid passing through.
--
-- One consequence worth naming, because it is load-bearing rather than
-- accidental: Postgres will not accept a deferrable unique constraint as an ON
-- CONFLICT arbiter. After this migration `on_conflict=project_id,seq` fails
-- outright with "ON CONFLICT does not support deferrable unique
-- constraints/exclusion constraints as arbiters" (verified on postgres 17).
-- Keying a stage upsert on seq again is exactly the identity mistake this
-- removes, and it now fails loudly instead of silently relabelling recorded
-- progress. The upsert saveStages issues keys on `id`, the primary key, which
-- stays immediate and is unaffected.
--
-- The constraint is dropped and recreated under its existing name
-- (project_stages_project_id_seq_key, the name 0001's inline `unique
-- (project_id, seq)` generated) so nothing that refers to it by name has to
-- change. Recreating it also recreates the unique index behind it, so
-- (project_id, seq) is still indexed for the ordered reads listStages does.
alter table project_stages
  drop constraint project_stages_project_id_seq_key;

alter table project_stages
  add constraint project_stages_project_id_seq_key
  unique (project_id, seq) deferrable initially deferred;
