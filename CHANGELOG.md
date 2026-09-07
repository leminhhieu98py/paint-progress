# Changelog

All notable changes to Construction Management are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Each release below is one batch of customer feedback: specified, built on its
own branch, verified against the development Supabase project, and deployed to
production by the owner. **Database migrations are listed per release and must
reach production before the app that needs them.**

## [1.5.0] - 2026-09-07

Feedback Rv4.

### Added

- **A shared employee roster** (`/admin/employees`), one list for every project,
  deck and work. Admins manage it; every signed-in account reads it. The foreman
  picks the crew lead and the painter from it instead of typing them.
- **`Xuất cả dự án`** on the field screen. Foremen and viewers export the whole
  project through the admin's own builder; row level security decides what lands
  in the file.
- **A production order** (`Lệnh sản xuất`) recorded against wasted hours — in the
  bay dialog, in the admin backfill, and as a column on the deck sheet.
- Bays can be added to and removed from a zone after it has been created.

### Changed

- **Every field on a bay update is compulsory except the note.** This reverses
  1.4.0's optional hours; the `không bắt buộc` label is gone. Updates already
  recorded keep their blanks, and an admin fills them in from A3.5.
- The waste reason is chosen from **a fixed list of 26 numbered reasons**
  (`1.1` … `8.5`) rather than typed. It is stored as code and text together, so
  changing the list later never rewrites history. Free text written earlier stays
  readable and is offered back in the admin backfill as `(ghi tự do cũ)`.
- Deck tabs on the field screen list only the decks the account holds a work on.
- The plan filter has no `Tất cả` option and defaults to the first coat. With
  every coat drawn at once there is no coat to measure *reached* against, so the
  overlay fell back to flat fill and one block's zone labels stacked.

### Removed

- **The one-tap `Công đoạn tiếp theo` button** in the bay dialog, at the client's
  request. With hours, a crew and a reason now compulsory, a button that skipped
  to a write could no longer collect what the write requires.

### Fixed

- The zone dialog showed the old dates back after saving them. The write had
  always landed; the dialog re-read a stale copy of the zone.

### Database

- `0032_employees_and_waste_order.sql` — `employees`, `cell_states.waste_order`,
  `cell_events.waste_order`, and `set_cell_event_effort` re-created with the new
  argument.

### Operational

- **Fill `/admin/employees` immediately after deploying.** The crew names are
  compulsory and must come from the roster, so a deployment whose `employees`
  table is empty cannot record progress at all.

## [1.4.0] - 2026-09-05

Feedback Rv2 items 11-13, and Feedback Rv3.

### Added

- **Man-hours on every bay update**: crew lead, painter, hours worked, hours
  wasted and a reason, written with the stage change and snapshotted onto the
  event so no later edit rewrites them.
- **Admin backfill of hours on past updates** (A3.5), through an admin-only
  `security definer` RPC, stamped with who edited and when.
- **A productivity dashboard** for admin, foreman and viewer
  (`/admin/dashboard`, `/gs/:projectId/dashboard`): totals, a coverage line,
  efficiency per stage, per-day charts, and crew and waste-reason tables.
- **A `Năng suất` sheet** in the workbook, and effort columns on every deck sheet.
- **A completion deadline per (deck, work)**, with a forecast of remaining m²,
  Mhr and days, and a warning when the deadline cannot be met (A3.6). Days are
  the largest stage figure rather than the sum, because the coats run in
  parallel; days are calendar days including Sundays; wasted hours enter no
  ratio. All three confirmed by the client.
- **Zone names and date ranges drawn on the drawing**, one card per zone, fitted
  to its bays and skipped when the zone is too small to read.
- Four deck figures: Mhr worked and Mhr wasted, today and to date.

### Changed

- **The product is now called Construction Management** — on the login screen, in
  the admin sidebar and in the page title. The login illustration was redrawn as
  an inline SVG of a platform, adding no image file and no request.
- A3.4's coat rows are cumulative, matching the foreman's card. The ring stays
  non-cumulative and now carries a caption saying so.
- The foreman's plan overlay distinguishes bays that reached the coat from bays
  that are only planned, using the admin's own function.
- A zone whose name already contains its coat no longer repeats it in the bay
  dialog.
- The deck detail screen reads the deck's events once and shares them between
  A3.5 and A3.6.

### Fixed

- **Event reads are paged past PostgREST's silent 1000-row cap**, ordered by
  time then id. Main Deck carries 1194 events; its history had been stopping at
  row 1000 and every figure derived from it was quietly short.

### Database

- `0030_effort.sql` — effort columns on `cell_states` and `cell_events`, the
  extended write guard, and `set_cell_event_effort`.
- `0031_work_deck_deadline.sql` — `work_decks.deadline`.

### Dependencies

- `recharts@3.10.1`, pinned and lazy-loaded in the dashboard chunk only.

## [1.3.0] - 2026-09-05

Feedback Rv2, batches A, B and C.

### Added

- **A third role, `viewer`**: reads exactly what a foreman on the same membership
  reads and writes nothing, enforced by `is_gs()` on the member write policies
  rather than by hiding buttons.
- **Per-work permission per account.** A membership is either all works or an
  explicit list, narrowed in the database by `my_works()`. Every membership that
  already existed kept all works.
- **Account rename, reversible lock and unlock, and hide.** There is no delete:
  hiding keeps every note's author resolvable.
- **Duplicate a deck** — the drawing, the guides and the bay mesh, and
  deliberately nothing else.
- **An admin-chosen zone colour**, refused when it equals one of that
  (work, deck)'s stage colours.
- Zone details for the foreman: a hover card on desktop, a plan line in the bay
  dialog on a tablet.
- A plan-by-coat filter on the field screen.
- **Layout images on the Plan sheet**, one per (deck, work) that has a plan, with
  the legend drawn into the PNG so it cannot drift out of step with what it names.
- `supabase/scripts/purge_user.sql`, for removing one account and its history.
  Run by the owner, wrapped in a transaction that rolls back by default.

### Changed

- **Planned bays are drawn before they reach the coat** — faint fill under a
  dashed frame. A zone used to be invisible until its bays reached the coat, so
  the plan disappeared exactly while it was still a plan.
- Decks with zero effective weight are hidden from the project rollup, with a
  line saying how many were hidden and why.
- Plan sheet column B reads `Khu vực` instead of `Vị trí tháo GG`: the column
  names a zone under any work.
- The zone dialog takes one date range per coat instead of two separate pickers.
- The `admin-users` Edge Function accepts `gs` or `viewer` and refuses every
  managed action aimed at an admin. Locking an account no longer deletes its
  memberships, so unlocking restores it whole.

### Fixed

- Works are searchable by name in the permissions dialog.
- The viewer's bay dialog carries one `Đóng` button and no hidden controls.

### Database

- `0027_zone_color.sql` — `zones.color`, nullable, so existing zones look
  unchanged.
- `0028_roles_and_work_members.sql` — the `viewer` role, `profiles.hidden`,
  `project_members.all_works`, `work_members`, `is_gs()` and `my_works()`.
- `0029_duplicate_deck.sql` — `duplicate_deck`, admin-only.

### Operational

- The `admin-users` Edge Function must be redeployed with this release. The
  previous version ignores `role` and creates a foreman when asked for a viewer.

## [1.2.0] - 2026-09-02

Work items, from Feedback Rv1 item 2 and the client's worked example. The largest
structural change since the first release.

### Added

- **Works (`Công việc`).** A project is divided into the disciplines it is paid
  for — sơn, tháo giáo, dọn dẹp, marking, chứng từ — each carrying its own
  weight, its own *counts toward the total* flag, and either bays of its own or a
  percentage the admin types.
- `/admin/works`: the work table, and the participating-decks matrix with a
  `Chia theo m²` suggestion for the deck weights.
- **A bay holds one position per work.** The same bay can be at Coat 2 for
  painting and untouched for scaffolding removal.
- Per-work stage lists, per-work bay states, per-work zones. Work selection on
  the deck detail panel and on the field screen.
- Overview and deck sheets organised by work, and a `Công việc` column on the
  event list and the Plan sheet.

### Changed

- **`Tỉ trọng` in the project rollup is now the deck's effective weight** across
  the counted works, not its share of project area. Area stopped deciding a
  deck's contribution the moment works carried weights of their own.
- The deck header's percentage is `P_d`, labelled `tổng hợp các công việc` — a
  convenience figure, not a billed one.
- Stage weight sums are enforced in the save path. The database triggers first
  drafted for this were withdrawn: two mechanisms enforcing one rule is one of
  them going stale.

### Database

- `0024_work_items.sql` — `works`, `work_decks`, `cell_states`,
  `deck_stages.work_id`, `cell_events.work_id` and `work_name`.
- `0025_work_items_fixes.sql` — `work_decks.weight` widened to `numeric(12,10)`,
  and the note rule moved into the AFTER INSERT logger.
- `0026_work_delete_guard.sql` — deleting a work that has recorded bays.

### Breaking

- **`cells` gives up `stage_id`, `note`, `updated_at` and `updated_by`** to
  `cell_states`, and those columns are dropped. The app deployed before this
  migration cannot read progress at all, so the migration and the deploy must
  happen in one sitting, off-hours.
- The backfill creates one work of weight 1 per project containing every deck at
  its m² share, which reproduces every pre-existing percentage exactly. Dev
  percentages were recorded before the migration and compared after.
  `work_decks.weight` carries ten decimals for that reason: five drifted the
  migrated project figure by 4e-7.

## [1.1.0] - 2026-09-02

Feedback Rv1, first batch.

### Added

- **The foreman sees every earlier note on a bay**, newest first, each with the
  coat it was written against and who wrote it. Needed a new
  `coworker_names()` RPC to name the authors without widening `profiles`, which
  would have exposed every account's role and active flag to every tablet.
- **The foreman exports the open deck** as an `.xlsx`, from the same loaders and
  renderers the admin export uses.
- **Delete a deck or a project**, behind the admin typing its exact name. A hard
  delete; the owner declined a soft delete.
- **A report-facing note override and hide for the admin**, both stamped with who
  and when and both reversible. The foreman's own sentence is never altered and
  never hidden from them. Written only by `set_report_note`; `cell_events` still
  carries no UPDATE policy.
- A Vercel SPA rewrite and baseline security headers.

### Changed

- **Coat progress reads in m²** on the field screen and on A3.4 —
  `6.854,54 / 40.000,00 m² · 17,36%`. The bay count is gone: the deck is billed
  in square metres, and on a deck of unequal bays the two figures disagree.
- **Bays that have not reached the viewed coat are left white** instead of
  hatched. Early in a coat the hatch was a wall of texture with the drawing
  invisible underneath, and the drawing is what the mesh is checked against.
- **The deck sheet lists one row per stage update** instead of one row per bay.
  100 bays through 4 coats is 400 rows.

### Database

- `0022_coworker_names.sql` — `coworker_names()`, two columns and nothing else.
- `0023_cell_event_report_notes.sql` — the four report columns on `cell_events`
  and `set_report_note`.

### Known consequence

- With one row per update, **a bay nobody has touched has no row** on the deck
  sheet, so the per-bay area inventory has left the file. The header block still
  carries the deck total and the area per coat. Flagged to the owner before
  shipping; adding a `Chưa bắt đầu` row per untouched bay is a one-line change.

## [1.0.0] - 2026-08-30

First production release.

Projects, decks and drawings; bay geometry detected from beam centrelines;
per-deck stage lists with weights; a foreman recording progress bay by bay on a
tablet with live multi-foreman sync; zone planning with date ranges; the XLSX
report reproducing the client's own workbook layout; role-split bundles and Row
Level Security.

Production runs its own Supabase project, created empty.

[1.5.0]: https://github.com/leminhhieu98py/paint-progress/compare/v1.4.0...v1.5.0
[1.4.0]: https://github.com/leminhhieu98py/paint-progress/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/leminhhieu98py/paint-progress/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/leminhhieu98py/paint-progress/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/leminhhieu98py/paint-progress/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/leminhhieu98py/paint-progress/releases/tag/v1.0.0
