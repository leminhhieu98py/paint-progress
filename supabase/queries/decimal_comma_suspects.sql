-- Values a dropped decimal comma may have inflated or deflated.
--
-- READ-ONLY: every statement below is a SELECT. Nothing is written, and
-- nothing here should be "fixed" automatically -- each row is a suspect for
-- a person to confirm with the foreman or admin who typed it.
--
-- Why: antd's InputNumber with no `decimalSeparator`/`parser` deletes a
-- comma instead of reading it, so "2,5" was saved as 25, "0,5" as 5 and
-- "2,25" as 225 (10x / 100x). A thousands dot was read as a decimal point,
-- so "8.000" was saved as 8 and "1.234,5" as 1.2345 (1000x too small).
-- Fixed in the app by src/components/viNumberInput.ts.
--
-- No date window. The effort columns only exist since 0030 (2026-09-05) and
-- stage_plans since 0033, so every value they hold was typed through the
-- affected fields -- including hours an admin backfilled onto older events.
-- works and decks carry no timestamp to window on.
--
-- Sections (run each on its own):
--   1. cell_events effort hours (work_hours, waste_hours)
--   2. stage_plans.planned_area_m2
--   3. works.manual_progress
--   4. decks.total_area_m2 against the bays under it
--
-- Not covered, on purpose:
--   * cell_states hours. 0030: cell_states "keeps only the transport copy --
--     nothing reads it back"; the report, the dashboards and the admin's
--     correction (set_cell_event_effort) all use cell_events. Listing it
--     would show rows that stay after the event has been fixed.
--   * works.weight and work_decks.weight. A dropped comma pushed a weight
--     past 1, the field clamped it to exactly 1, and the save refuses
--     counted weights that do not sum to 1 -- so the likely real effect was
--     a refused save, not stored data. An exact 1 left today is mostly the
--     legitimate one-work / one-deck case.
--
-- Tunables are in each section's `params` CTE.

-- ---------------------------------------------------------------------------
-- 1. Effort hours on cell_events.
--
-- Only whole numbers can be suspects: a dropped comma never leaves a
-- fraction. `pattern` says which signature a row matches:
--   '10x'  value >= min_value AND EITHER
--          a. the reference median (same lead on the same coat -- same work,
--             same to_stage_id -- or the coat's median over every lead when
--             that lead has fewer than min_group rows there) is below
--             min_value: "2,5" -> 25 among 2-4 Mhr;
--          b. its hours per m2 of the bay is ratio_factor times the coat's
--             median hours per m2 or more.
--   '0,d'  1 <= value <= 9 AND the reference median of the NON-ZERO values
--          is below 1: "0,5" -> 5 among 0,5 waste. Zeros are left out of
--          that median because most bays lose nothing, and a median of 0
--          would flag every whole hour of waste. A lead who logs 0,5 and a
--          real 2 still shows the 2: ask.
-- Medians are over the whole history, suspects included; with a handful of
-- rows per lead and coat one bad value does not move a median much.
-- ---------------------------------------------------------------------------
with params as (
  select
    10::numeric as min_value,
    3           as min_group,
    5::numeric  as ratio_factor
),
event_values as (
  select
    e.id, e.cell_id, e.work_id, e.work_name, e.to_stage_id, e.to_stage_name,
    coalesce(nullif(btrim(e.lead_name), ''), '(trống)') as lead_name,
    e.at, e.effort_edited_at,
    c.area_m2 as cell_area_m2,
    f.field, f.value
  from cell_events e
  join cells c on c.id = e.cell_id
  cross join lateral (values
    ('work_hours',  e.work_hours),
    ('waste_hours', e.waste_hours)
  ) as f(field, value)
  where f.value is not null
),
lead_stage as (
  select work_id, to_stage_id, lead_name, field,
         count(*) as n,
         count(*) filter (where value > 0) as n_nonzero,
         percentile_cont(0.5) within group (order by value) as median_value,
         percentile_cont(0.5) within group (order by value) filter (where value > 0) as median_nonzero
  from event_values
  group by work_id, to_stage_id, lead_name, field
),
stage as (
  select work_id, to_stage_id, field,
         count(*) as n,
         percentile_cont(0.5) within group (order by value) as median_value,
         percentile_cont(0.5) within group (order by value) filter (where value > 0) as median_nonzero,
         -- nullif: a bay of 0 m2 has no ratio, and percentile_cont skips nulls.
         percentile_cont(0.5) within group (order by value / nullif(cell_area_m2, 0)) as median_per_m2
  from event_values
  group by work_id, to_stage_id, field
),
scored as (
  select
    ev.*,
    ls.n as lead_stage_rows,
    st.n as stage_rows,
    case when ls.n >= p.min_group then ls.median_value else st.median_value end as reference_median,
    case when ls.n_nonzero >= p.min_group then ls.median_nonzero else st.median_nonzero end as reference_nonzero_median,
    ev.value / nullif(ev.cell_area_m2, 0) as value_per_m2,
    st.median_per_m2 as stage_median_per_m2,
    p.min_value, p.ratio_factor
  from event_values ev
  cross join params p
  join stage st
    on st.work_id is not distinct from ev.work_id
   and st.to_stage_id is not distinct from ev.to_stage_id
   and st.field = ev.field
  join lead_stage ls
    on ls.work_id is not distinct from ev.work_id
   and ls.to_stage_id is not distinct from ev.to_stage_id
   and ls.lead_name = ev.lead_name
   and ls.field = ev.field
),
flagged as (
  select
    sc.*,
    case
      when sc.value >= sc.min_value
       and (sc.reference_median < sc.min_value
            or (sc.stage_median_per_m2 > 0 and sc.value_per_m2 >= sc.ratio_factor * sc.stage_median_per_m2))
        then '10x'
      when sc.value between 1 and 9 and sc.reference_nonzero_median < 1
        then '0,d'
    end as pattern
  from scored sc
  where sc.value = trunc(sc.value)
)
select
  f.id                         as cell_event_id,
  f.pattern,
  f.field,
  d.code as deck_code, d.name as deck_name, c.code as cell_code,
  f.work_name,
  f.to_stage_name              as stage,
  f.lead_name                  as lead,
  f.value,
  round(f.value / 10, 2)       as suspected_value_if_10x,
  case when f.pattern = '10x' then round(f.value / 100, 2) end as suspected_value_if_100x,
  round(f.reference_median::numeric, 2)         as reference_median,
  round(f.reference_nonzero_median::numeric, 2) as reference_nonzero_median,
  f.lead_stage_rows, f.stage_rows,
  round(f.value_per_m2, 4)                      as value_per_m2,
  round(f.stage_median_per_m2::numeric, 4)      as stage_median_per_m2,
  f.at                         as created_at,
  f.effort_edited_at
from flagged f
join cells c on c.id = f.cell_id
join decks d on d.id = c.deck_id
where f.pattern is not null
order by deck_code, stage, lead, cell_code, created_at;

-- ---------------------------------------------------------------------------
-- 2. Planned area overrides on stage_plans.
--
-- planned_area_m2 is unconstrained numeric, so nothing clamped or rounded
-- what the field sent. 0 is a deliberate "plan nothing" and never a
-- suspect; null is "use the computed figure" and is skipped.
--   'inflated'  a whole number of inflate_factor times the deck total or
--               more -- a coat cannot plan more than its deck has.
--   'deflated'  below deflate_share of the deck total: "8.000" (the
--               field's own placeholder style) was saved as 8 m2.
--   'decimals'  more than 2 decimals: "1.234,5" was saved as 1.2345. Nobody
--               plans a coat to the square centimetre.
-- Suspected value: x1000 for the last two, /10 for the first.
-- ---------------------------------------------------------------------------
with params as (
  select 1.5::numeric as inflate_factor, 0.01::numeric as deflate_share
)
select
  sp.stage_id,
  case
    when sp.planned_area_m2 = trunc(sp.planned_area_m2)
     and sp.planned_area_m2 >= p.inflate_factor * d.total_area_m2 then 'inflated'
    when sp.planned_area_m2 < p.deflate_share * d.total_area_m2 then 'deflated'
    else 'decimals'
  end as pattern,
  d.code as deck_code, d.name as deck_name,
  w.name as work_name,
  s.name as stage,
  sp.planned_area_m2 as value,
  scale(sp.planned_area_m2) as decimals,
  d.total_area_m2,
  case when sp.planned_area_m2 = trunc(sp.planned_area_m2)
        and sp.planned_area_m2 >= p.inflate_factor * d.total_area_m2
       then round(sp.planned_area_m2 / 10, 2) end as suspected_value_if_10x,
  case when not (sp.planned_area_m2 = trunc(sp.planned_area_m2)
                 and sp.planned_area_m2 >= p.inflate_factor * d.total_area_m2)
       then sp.planned_area_m2 * 1000 end         as suspected_value_if_thousands,
  sp.created_at, sp.updated_at
from stage_plans sp
cross join params p
join decks d on d.id = sp.deck_id
join works w on w.id = sp.work_id
join deck_stages s on s.id = sp.stage_id
where sp.planned_area_m2 > 0
  and d.total_area_m2 > 0
  and (
    (sp.planned_area_m2 = trunc(sp.planned_area_m2) and sp.planned_area_m2 >= p.inflate_factor * d.total_area_m2)
    or sp.planned_area_m2 < p.deflate_share * d.total_area_m2
    or scale(sp.planned_area_m2) > 2
  )
order by deck_code, stage;

-- ---------------------------------------------------------------------------
-- 3. Manual progress on works.
--
-- manual_progress is numeric(6,5), a FRACTION checked to [0, 1]; the admin
-- types a percentage (0-100, the field's max) and the screen divides by
-- 100. A dropped comma therefore stored:
--   "7,5" %  -> 75 %  -> 0.75   under the clamp, a whole percentage;
--   "12,5" % -> 125 % -> clamped to 100 % -> 1.
--   'whole'    a whole percentage >= 10 and < 100 on a project where
--              another manual work holds a fractional one -- somebody there
--              types decimals, so a whole 75 % beside a 12,5 % is worth a
--              question. Suspected value: pct / 10.
--   'clamped'  exactly 100 % on a manual work that counts: anything from
--              "10,0" to "99,9" % lands here, and so does a finished work.
--              Suspected value: unknown -- ask.
-- works has no updated_at, so these are the values as they stand today.
-- ---------------------------------------------------------------------------
with manual as (
  select w.*, w.manual_progress * 100 as pct
  from works w
  where w.kind = 'manual'
)
select
  m.id as work_id,
  case when m.pct = 100 then 'clamped' else 'whole' end as pattern,
  p.name as project,
  m.name as work_name,
  m.counts,
  m.pct as value_pct,
  case when m.pct < 100 then round(m.pct / 10, 2) end as suspected_pct_if_10x,
  m.created_at
from manual m
join projects p on p.id = m.project_id
where (m.pct = 100 and m.counts)
   or (m.pct = trunc(m.pct) and m.pct >= 10 and m.pct < 100
       and exists (select 1 from manual o
                   where o.project_id = m.project_id and o.id <> m.id and o.pct <> trunc(o.pct)))
order by project, work_name;

-- ---------------------------------------------------------------------------
-- 4. Deck totals against the bays under them.
--
-- The deck-area field read a comma, but a thousands dot stopped the parse:
-- "6.000" was saved as 6 and "12.345" as 12.35 (numeric(12,2)).
--   'ratio'     the total and the sum of cells.area_m2 differ by ratio_factor
--               or more, either way. Catches a total typed wrong while its
--               bays kept their own areas.
--   'tiny_bays' the bays average under min_bay per bay. Since RV6-19 every
--               area save re-prorates the bays to the new total, so a
--               deflated total drags its bays down with it and the ratio
--               check sees nothing; a bay of a few dm2 is the trace left.
--               The column holds the work's quantity, not always m2 (0036),
--               so a deck measured in tonnes can land here legitimately.
-- Suspected value: x1000 when the total is the small side. A total far
-- above its bays is not a comma signature; the bays' sum is the likelier
-- figure there.
-- ---------------------------------------------------------------------------
with params as (
  select 10::numeric as ratio_factor, 1::numeric as min_bay
),
deck_bays as (
  select d.id, d.code, d.name, d.total_area_m2, d.area_source,
         count(c.id) as cell_count,
         sum(c.area_m2) as cells_sum
  from decks d
  join cells c on c.deck_id = d.id
  group by d.id
)
select
  db.id as deck_id,
  case
    when db.total_area_m2 > 0 and db.cells_sum > 0
     and (db.total_area_m2 >= p.ratio_factor * db.cells_sum or db.cells_sum >= p.ratio_factor * db.total_area_m2)
      then 'ratio'
    else 'tiny_bays'
  end as pattern,
  db.code as deck_code, db.name as deck_name,
  db.total_area_m2 as value,
  db.cells_sum,
  db.cell_count,
  round(db.cells_sum / db.cell_count, 3) as avg_bay,
  db.area_source,
  (select string_agg(distinct w.unit, ', ') from work_decks wd join works w on w.id = wd.work_id
   where wd.deck_id = db.id) as units,
  case when db.total_area_m2 < db.cells_sum or db.cells_sum / db.cell_count < p.min_bay
       then db.total_area_m2 * 1000 end as suspected_value_if_thousands
from deck_bays db
cross join params p
where (db.total_area_m2 > 0 and db.cells_sum > 0
       and (db.total_area_m2 >= p.ratio_factor * db.cells_sum or db.cells_sum >= p.ratio_factor * db.total_area_m2))
   or db.cells_sum / db.cell_count < p.min_bay
order by deck_code;
