-- 0027: a chosen colour per zone (Feedback Rv2, item 6).
--
-- Linh drew four zones on a coat and one of them came out in Coat 2's colour,
-- because the screens hand zone colours out by position and nothing kept them
-- off the deck's stage palette. The admin now picks the colour in the zone
-- dialog; the app refuses any colour a stage of that (work, deck) already
-- wears (src/domain/plan.ts, zoneColorConflict).
--
-- Nullable, and null means "not chosen": every existing zone keeps being
-- coloured by the palette exactly as before this migration, so nothing on a
-- deployed screen changes until an admin picks a colour. Lower-case six-digit
-- hex only -- the same form deck_stages.color carries -- so a comparison
-- between the two is a string equality.
--
-- Additive. Nothing here needs the app redeployed first, and the app that
-- needs it (feat/feedback-rv2-a) selects the column, so THIS runs before that
-- deploy.
alter table zones
  add column color text
  check (color is null or color ~ '^#[0-9a-f]{6}$');

comment on column zones.color is
  'Admin-chosen zone colour, lower-case #rrggbb; null = palette colour by position';
