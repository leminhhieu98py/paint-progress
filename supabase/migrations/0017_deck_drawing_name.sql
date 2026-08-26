-- The name of the file the drawing came from, and which page of it.
--
-- The stored image is a render: its path is `<project>/<deck>.png`, minted from
-- ids, and the PDF it came from is not recorded anywhere. An admin who uploaded
-- a drawing, saved, and came back had no way to tell which file they had used
-- -- on a project whose sheets are all called things like 00171-14, that is not
-- a small thing to be unsure about.
--
-- Nullable, because every deck that already has a drawing has one whose origin
-- nobody recorded. A backfill would have to invent the answer.
alter table decks add column drawing_name text;
alter table decks add column drawing_page int;

comment on column decks.drawing_name is
  'Original file name of the uploaded drawing, for the admin to recognise it by.';
comment on column decks.drawing_page is
  'Which page of that file was rendered. Null for a single-page file.';
