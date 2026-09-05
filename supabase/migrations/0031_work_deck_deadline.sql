-- Hạn hoàn thành cho một (công việc, sàn) — Feedback Rv2, item 13.
--
-- The date the customer expects this deck finished FOR THIS WORK. Per
-- (work, deck) rather than per deck, because the coats a deadline is about
-- belong to a (work, deck) since 0024: one deck carried by both "Sơn" and
-- "Tháo giáo" has two schedules and one date could only ever be right for
-- one of them. A project with a single work reads exactly as "hạn của sàn",
-- which is how Linh's workbook puts it ("Sàn A có 4 công đoạn. Ngày cần hoàn
-- thành công việc là 8/10/2026").
--
-- A `date`, not a timestamptz: nobody schedules a deck to the minute, and the
-- forecast counts whole calendar days in Vietnam time. Null means "no deadline
-- set", which is every row before this migration -- the forecast still prints
-- how much work is left, it just has nothing to be late against.
--
-- No policy or trigger work. `work_decks_admin_all` (0024) already carries the
-- admin write, `work_decks_member_read` (narrowed by 0028 to my_works()) the
-- field read, and nothing on this table guards columns.
alter table work_decks add column deadline date;

comment on column work_decks.deadline is
  'Ngày cần hoàn thành công việc này trên sàn này. Null: chưa đặt hạn.';

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'work_decks' and column_name = 'deadline'
      and data_type = 'date' and is_nullable = 'YES'
  ) then
    raise exception 'work_decks.deadline is missing, is not a date, or is NOT NULL';
  end if;
  -- The two policies this column relies on must still be the ones that decide
  -- who may write it: an admin, and nobody else.
  if (select count(*) from pg_policies
      where schemaname = 'public' and tablename = 'work_decks'
        and policyname in ('work_decks_admin_all', 'work_decks_member_read')) <> 2 then
    raise exception 'work_decks policies are not the expected pair';
  end if;
end $$;
