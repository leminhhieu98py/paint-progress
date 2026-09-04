-- 0029: duplicate a deck (Feedback Rv2, item 3).
--
-- Offshore platforms repeat: the same deck drawing, the same bay grid, on a
-- second module or a second campaign. Drawing the grid again by hand was the
-- slowest step in setting a deck up, so this copies it.
--
-- WHAT IS COPIED: the deck row (same project, next seq, the given name and
-- code, the declared area and how it was measured, the drawing's dimensions
-- and the name of the file it came from), every guide, every cell with its
-- code, geometry and area. The drawing FILE is copied by the client afterwards
-- (`storage.copy`) and image_path set then: a copy, not a shared path, because
-- deleteDeck removes the file its row points at.
--
-- WHAT IS NOT: works, work_decks, deck_stages, cell_states, cell_events,
-- zones. A copy is a new deck with nothing recorded on it; it joins a work
-- when the admin adds it there.
--
-- One function rather than three client inserts so the row, its guides and
-- its cells arrive together or not at all. Security definer, admin-only by its
-- own check: the caller's RLS would also allow every insert here, but a
-- definer function must not rely on that, and a GS calling it gets a plain
-- refusal instead of a half-copied deck.
create or replace function duplicate_deck(src uuid, new_name text, new_code text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  s      decks%rowtype;
  new_id uuid;
begin
  if not is_admin() then
    raise exception 'only an admin may duplicate a deck';
  end if;
  select * into s from decks where id = src;
  if not found then
    raise exception 'deck % not found', src;
  end if;

  insert into decks (
    project_id, seq, name, code, total_area_m2, area_source, image_w, image_h, drawing_name, drawing_page
  )
  values (
    s.project_id,
    (select coalesce(max(seq), 0) + 1 from decks where project_id = s.project_id),
    new_name, new_code, s.total_area_m2, s.area_source, s.image_w, s.image_h, s.drawing_name, s.drawing_page
  )
  returning id into new_id;

  insert into deck_guides (deck_id, axis, pos, offset_mm, label)
  select new_id, axis, pos, offset_mm, label from deck_guides where deck_id = src;

  insert into cells (deck_id, code, x, y, w, h, area_m2)
  select new_id, code, x, y, w, h, area_m2 from cells where deck_id = src;

  return new_id;
end $$;

revoke all on function duplicate_deck(uuid, text, text) from public, anon;
grant execute on function duplicate_deck(uuid, text, text) to authenticated;

comment on function duplicate_deck(uuid, text, text) is
  'Admin-only copy of a deck: row, guides and cells. Works, stages, states, events and zones are not copied; the drawing file is copied by the client.';
