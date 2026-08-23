-- One demo zone, so "Hiện kế hoạch" can be seen working before Phase 4 builds
-- the zone editor (spec §8.5).
--
-- HAND-OFF ONLY. Do not run this as part of any task: it writes rows to whatever
-- database it is pointed at. Intended use, by the project owner, against a
-- database they are willing to change:
--
--   nvm use 22
--   npx supabase db query --linked -f supabase/fixtures/plan_zone_demo.sql
--
-- It picks the first project by name, that project's first deck by seq, that
-- project's last stage by seq (the scaffolding-removal stage, which is what the
-- `Kế hoạch tháo GG` sheet plans), and that deck's first four cells by code.
-- Deterministic, so re-running it is a no-op rather than a second zone.
--
-- To remove it again:
--   delete from zones where name = 'DEMO Zone 1';
do $$
declare
  d uuid; s uuid; z uuid;
begin
  select dk.id into d
  from decks dk
  join projects p on p.id = dk.project_id
  order by p.name, dk.seq
  limit 1;

  if d is null then
    raise exception 'no decks exist; nothing to plan';
  end if;

  select ps.id into s
  from project_stages ps
  join decks dk on dk.project_id = ps.project_id
  where dk.id = d
  order by ps.seq desc
  limit 1;

  if s is null then
    raise exception 'deck % has no project stages', d;
  end if;

  select id into z from zones where deck_id = d and name = 'DEMO Zone 1';
  if z is not null then
    return;
  end if;

  -- Five working days, matching the `Kế hoạch tháo GG` sheet's zone length.
  insert into zones (deck_id, seq, name, stage_id, start_date, finish_date)
  values (d, 1, 'DEMO Zone 1', s, current_date, current_date + 4)
  returning id into z;

  insert into zone_cells (zone_id, cell_id)
  select z, c.id
  from (select id, code from cells where deck_id = d order by code limit 4) c;
end $$;

-- Single result set, because `supabase db query -f` shows only the last one.
select format('%s DEMO Zone 1 on deck %s covers %s cell(s)',
              case when count(*) = 4 then 'PASS' else 'FAIL' end,
              max(z.deck_id::text), count(*)) as result
from zones z
left join zone_cells zc on zc.zone_id = z.id
where z.name = 'DEMO Zone 1';
