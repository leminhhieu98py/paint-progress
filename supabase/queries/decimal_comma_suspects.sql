-- Values a dropped decimal comma may have inflated.
--
-- READ-ONLY: every statement below is a SELECT. Nothing is written, and
-- nothing here should be "fixed" automatically -- each row is a suspect for
-- a person to confirm with the foreman or admin who typed it.
--
-- Why: antd's InputNumber with no `decimalSeparator`/`parser` deletes a
-- comma instead of reading it, so a value typed "2,5" was saved as 25 and
-- "2,25" as 225 (10x / 100x). "1.230,5" became 1.2305 (numeric(8,2) stores
-- 1.23), which deflates and is NOT caught here. Fixed in the app by
-- src/components/viNumberInput.ts.
--
-- Sections (run each on its own):
--   1. effort hours (work_hours, waste_hours) on cell_events and cell_states
--   2. stage_plans.planned_area_m2
--   3. works.weight and works.manual_progress, work_decks.weight
--   4. decks.total_area_m2 (the thousands-dot variant: "5.258,5" -> 5.26)
--
-- Tunables are in each section's `params` CTE.

-- ---------------------------------------------------------------------------
-- 1. Effort hours on cell_events (the history) and cell_states (the latest
--    hours per bay, which is what the dashboards read).
--
-- A row is a suspect when the value is a whole number >= min_value and
-- EITHER
--   a. the median of the same lead on the same coat (same work, same stage
--      id) is below min_value -- falling back to the coat's median over
--      every lead when that lead has fewer than min_group rows there;
--   b. its hours per m2 of the bay is ratio_factor times the coat's median
--      hours per m2 or more.
-- Medians come from the cell_events history only, over all time, so the
-- window does not move them and a bay's latest state is not counted twice.
-- Only the suspects themselves are limited to `since`: cell_events on
-- coalesce(effort_edited_at, at), cell_states on updated_at. A bad value
-- usually shows twice -- once as its event, once as the bay's state.
-- ---------------------------------------------------------------------------
with params as (
  select
    timestamptz '2026-09-05 00:00:00+07' as since,
    10::numeric                          as min_value,
    3                                    as min_group,
    5::numeric                           as ratio_factor
),
-- Every recorded value, one row per field: the population the medians use
-- and the cell_events half of the candidates.
event_values as (
  select
    e.id, e.cell_id, e.work_id, e.work_name, e.to_stage_id as stage_id, e.to_stage_name as stage_name,
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
state_values as (
  select
    cs.cell_id, cs.work_id, w.name as work_name, cs.stage_id, s.name as stage_name,
    coalesce(nullif(btrim(cs.lead_name), ''), '(trống)') as lead_name,
    cs.updated_at,
    c.area_m2 as cell_area_m2,
    f.field, f.value
  from cell_states cs
  join cells c on c.id = cs.cell_id
  join works w on w.id = cs.work_id
  left join deck_stages s on s.id = cs.stage_id
  cross join lateral (values
    ('work_hours',  cs.work_hours),
    ('waste_hours', cs.waste_hours)
  ) as f(field, value)
  where f.value is not null
),
candidates as (
  select
    'cell_events'::text as source, ev.id::text as row_id,
    ev.cell_id, ev.work_id, ev.work_name, ev.stage_id, ev.stage_name, ev.lead_name,
    ev.cell_area_m2, ev.field, ev.value,
    ev.at as created_at, ev.effort_edited_at as edited_at,
    coalesce(ev.effort_edited_at, ev.at) as seen_at
  from event_values ev
  union all
  select
    'cell_states', sv.cell_id::text || '/' || sv.work_id::text,
    sv.cell_id, sv.work_id, sv.work_name, sv.stage_id, sv.stage_name, sv.lead_name,
    sv.cell_area_m2, sv.field, sv.value,
    null::timestamptz, sv.updated_at,
    sv.updated_at
  from state_values sv
),
lead_stage as (
  select work_id, stage_id, lead_name, field,
         count(*) as n,
         percentile_cont(0.5) within group (order by value) as median_value
  from event_values
  group by work_id, stage_id, lead_name, field
),
stage as (
  select work_id, stage_id, field,
         count(*) as n,
         percentile_cont(0.5) within group (order by value) as median_value,
         -- nullif: a bay of 0 m2 has no ratio, and percentile_cont skips nulls.
         percentile_cont(0.5) within group (order by value / nullif(cell_area_m2, 0)) as median_per_m2
  from event_values
  group by work_id, stage_id, field
),
scored as (
  select
    ca.*,
    ls.n as lead_stage_rows,
    st.n as stage_rows,
    case when coalesce(ls.n, 0) >= p.min_group then ls.median_value else st.median_value end as reference_median,
    ca.value / nullif(ca.cell_area_m2, 0) as value_per_m2,
    st.median_per_m2 as stage_median_per_m2,
    p.since, p.min_value, p.ratio_factor
  from candidates ca
  cross join params p
  join stage st
    on st.work_id is not distinct from ca.work_id
   and st.stage_id is not distinct from ca.stage_id
   and st.field = ca.field
  -- Left: a bay's state can name a lead no event on that coat carries.
  left join lead_stage ls
    on ls.work_id is not distinct from ca.work_id
   and ls.stage_id is not distinct from ca.stage_id
   and ls.lead_name = ca.lead_name
   and ls.field = ca.field
)
select
  sc.source,
  sc.row_id,
  sc.field,
  d.code as deck_code, d.name as deck_name, c.code as cell_code,
  sc.work_name,
  sc.stage_name            as stage,
  sc.lead_name             as lead,
  sc.value,
  round(sc.value / 10, 2)  as suspected_value_if_10x,
  round(sc.value / 100, 2) as suspected_value_if_100x,
  round(sc.reference_median::numeric, 2)    as reference_median,
  sc.lead_stage_rows, sc.stage_rows,
  round(sc.value_per_m2, 4)                 as value_per_m2,
  round(sc.stage_median_per_m2::numeric, 4) as stage_median_per_m2,
  coalesce(sc.reference_median < sc.min_value, false)                             as flag_median,
  -- Same test as the WHERE below: a coat whose median is 0 (most waste) has
  -- no ratio to be "far above".
  coalesce(sc.stage_median_per_m2 > 0
           and sc.value_per_m2 >= sc.ratio_factor * sc.stage_median_per_m2, false) as flag_per_m2,
  sc.created_at,
  sc.edited_at
from scored sc
join cells c on c.id = sc.cell_id
join decks d on d.id = c.deck_id
where sc.seen_at >= sc.since
  and sc.value >= sc.min_value
  and sc.value = trunc(sc.value)
  and (
    sc.reference_median < sc.min_value
    or (sc.stage_median_per_m2 > 0 and sc.value_per_m2 >= sc.ratio_factor * sc.stage_median_per_m2)
  )
order by deck_code, stage, lead, cell_code, source, created_at;

-- ---------------------------------------------------------------------------
-- 2. Planned area overrides on stage_plans.
--
-- A suspect is a whole-number override since `since` that is ratio_factor
-- times the deck's total area or more -- a coat cannot plan more area than
-- its deck has. planned_area_m2 is unconstrained numeric, so nothing clamped
-- it.
-- ---------------------------------------------------------------------------
with params as (
  select timestamptz '2026-09-05 00:00:00+07' as since, 1.5::numeric as ratio_factor
)
select
  sp.stage_id,
  d.code as deck_code, d.name as deck_name,
  w.name as work_name,
  s.name as stage,
  sp.planned_area_m2 as value,
  d.total_area_m2,
  round(sp.planned_area_m2 / 10, 2)  as suspected_value_if_10x,
  round(sp.planned_area_m2 / 100, 2) as suspected_value_if_100x,
  sp.created_at, sp.updated_at
from stage_plans sp
cross join params p
join decks d on d.id = sp.deck_id
join works w on w.id = sp.work_id
join deck_stages s on s.id = sp.stage_id
where sp.updated_at >= p.since
  and sp.planned_area_m2 is not null
  and sp.planned_area_m2 = trunc(sp.planned_area_m2)
  and d.total_area_m2 > 0
  and sp.planned_area_m2 >= p.ratio_factor * d.total_area_m2
order by deck_code, stage;

-- ---------------------------------------------------------------------------
-- 3. Weights and manual progress.
--
-- These columns are numeric(6,5) checked to [0, 1], and the fields had
-- max={1} / max={100}%, so "0,7" was saved as 7 and clamped to exactly 1,
-- and "12,5" % as 125 clamped to 100 %. An inflated value therefore shows as
-- exactly 1. The tables carry no updated_at, so there is no date window:
-- this lists every current exact-1 value on a work or deck that shares its
-- sum with others. A lone work or deck at 1 is legitimate and is left out.
-- Suspected intended value: unknown (anything from 0,1 to 0,99) -- ask.
-- ---------------------------------------------------------------------------
select
  'works.weight' as field,
  w.id::text as id, p.name as project, w.name as work_name, null::text as deck_code,
  w.weight as value,
  (select count(*) from works o where o.project_id = w.project_id and o.counts and o.id <> w.id) as others_in_sum,
  w.created_at
from works w
join projects p on p.id = w.project_id
where w.counts
  and w.weight = 1
  and exists (select 1 from works o where o.project_id = w.project_id and o.counts and o.id <> w.id)
union all
select
  'works.manual_progress',
  w.id::text, p.name, w.name, null,
  w.manual_progress,
  null,
  w.created_at
from works w
join projects p on p.id = w.project_id
where w.kind = 'manual'
  and w.manual_progress = 1
union all
select
  'work_decks.weight',
  wd.work_id::text || '/' || wd.deck_id::text, p.name, w.name, d.code,
  wd.weight,
  (select count(*) from work_decks o where o.work_id = wd.work_id and o.deck_id <> wd.deck_id and o.weight > 0),
  null
from work_decks wd
join works w on w.id = wd.work_id
join projects p on p.id = w.project_id
join decks d on d.id = wd.deck_id
where wd.weight = 1
  and exists (select 1 from work_decks o where o.work_id = wd.work_id and o.deck_id <> wd.deck_id)
order by field, project, work_name;

-- ---------------------------------------------------------------------------
-- 4. Deck totals typed with thousands dots.
--
-- The deck-area field already read a comma, but not a thousands dot:
-- "5.258,5" stopped at 5.258 and numeric(12,2) stored 5.26 -- 1000x too
-- small, not inflated. The signature is a total under 10 m2 with a fraction
-- on a deck that has bays. decks has no timestamp, so there is no window.
-- Suspected intended value: value * 1000 (approximate: the third decimal
-- was rounded away).
-- ---------------------------------------------------------------------------
select
  d.id as deck_id, d.code as deck_code, d.name as deck_name,
  d.total_area_m2 as value,
  d.total_area_m2 * 1000 as suspected_value_if_thousands,
  d.area_source,
  (select count(*) from cells c where c.deck_id = d.id) as cell_count
from decks d
where d.total_area_m2 > 0
  and d.total_area_m2 < 10
  and d.total_area_m2 <> trunc(d.total_area_m2)
  and exists (select 1 from cells c where c.deck_id = d.id)
order by deck_code;
