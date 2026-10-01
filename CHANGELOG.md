# Changelog

All notable changes to Construction Management are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Each release below is one batch of customer feedback: specified, built on its
own branch, verified against the development Supabase project, and deployed to
production by the owner. **Database migrations are listed per release and must
reach production before the app that needs them.**

## [1.9.0] - 2026-10-01

Linh's review Rv7: filters that apply as they change, a copyright line on
every screen, zoom below 100%, every zone label on the drawing, and a new
login animation. No database migration, no Edge Function.

### Added

- **Copyright line on every screen**: "Bản quyền © 2026 Đoàn Công Linh –
  XDVTH", at the bottom right of the page, in the flow (never over content);
  on a GS phone above the bottom tab bar. The developer is named in the page's
  author meta and the package author only.
- **Zoom out to 25%** on every layout canvas (Sàn editor, Sàn progress, GS):
  below 100% the drawing sits centred in its frame; Vừa khung returns to 100%.

### Changed

- **Filters apply as soon as they change**, on every admin and field screen;
  the Đặt lại and Tìm buttons are gone, phone filter sheets included. The
  Nhân lực search filters as you type; Enter applies at once. On KPI a chart
  filter change no longer drops unsaved plan-table edits.
- **Login screen**: the tagline is gone and the animation is LottieFiles'
  "Businessmen at the table" (Lottie Simple License), in a square frame; with
  reduced motion it shows one still frame.

### Fixed

- **Every zone shows its label on the drawing.** A zone too narrow or too short
  for its label at the smallest legible size lost the label entirely (Sàn
  A3.4, Zone 3); its label now overhangs the zone at that size.

## [1.8.0] - 2026-09-30

The UI consistency release, the Nhân lực screen, and a fix for number fields.
One layout, table, filter bar and type scale across the admin and field
screens; charts and rings that read on phones; the field screens' second pass;
an animated login screen; and the one item from Linh's review of v1.7.0. The
admin's Người dùng and Nhân viên screens become one screen, Nhân lực, where a
person's name appears once. And every number field now reads a Vietnamese
decimal comma: since 1.4.0 production has saved "2,5" as 25 in several fields.
One database migration (`0037`) and an Edge Function redeploy (`admin-users`).

### Added

- **Nhân lực**, one screen for GS and Visitor accounts and employees. It
  replaces Người dùng and Nhân viên in the menu; `/admin/employees` redirects
  to it. One list, GS first, then Visitor, then Nhân viên, each sorted by
  name, with the role as a badge (Nhân viên / GS / Visitor) whose tooltip is the role's description, a filter by name or login,
  Phân quyền and Trạng thái, and `-` where an employee has no data. Xuất danh
  sách still exports the employees.
- **Thêm nhân lực** asks for the role first (Nhân viên by default, GS or
  Visitor) and shows only the fields that role needs: a Nhân viên has a name
  only and cannot sign in; a GS needs a login, password and project; a Visitor
  needs no project, since a Visitor reads every project.
- **One Sửa dialog per row**, the create dialog prefilled: Họ tên, Phân quyền,
  and for an account its login and password, one masked field whose eye
  shows the stored password (logged as before) with a copy icon beside it,
  and, for a GS, its projects and the works within them. Lưu saves only what
  changed, in a fixed order, and on a refusal says what was saved and what
  was not. A row keeps only Sửa, for an account Xem mật khẩu (the password
  and a copy icon, nothing else), Khoá/Mở khoá and, for an account, Ẩn/Hiện
  lại; an employee is locked and
  unlocked like an account (it leaves the tablet's crew pickers), replacing
  the Đang làm switch.
- **Đổi phân quyền**, the role in the Sửa dialog, turns an employee into a GS
  or Visitor account and back, and a GS into a Visitor, behind a dialog that
  says what happens. An account
  turned into an employee is locked and hidden, not deleted, so the history it
  wrote keeps its author; turning the person back re-opens that account. A GS
  or Visitor account is not offered in the tablet's crew pickers, which list
  employees as before.
- **One person, one row.** A name may belong to one person across GS/Visitor
  accounts and employees, compared without case and outer spaces. A duplicate
  is refused in the dialog, by the Edge Function and by the database.
- Data tables paginate, 10 / 20 / 50 / 100 rows a page. Every select can be
  searched by typing.
- Rings and their legends highlight each other on hover and focus, and hovering
  a chart legend item highlights its series.
- On phones the field screens have a bottom tab bar, and filters open in a
  bottom sheet behind a one-row bar.

### Changed

- **Decks are reordered by drag** on the Sàn list (a handle on each row, or
  Alt+↑/↓ on a focused handle); the new order is saved on drop, with no Lưu
  step. The Lên/Xuống arrow column is gone. If a write fails, the list reloads
  the real order and says why.
- **The KPI plan table is relabelled**: `Dự kiến triển khai` for the date range
  and `Diện tích` for the planned area, with no placeholder in the area field.
  `Tự động tính` sits beside `Lưu` as an icon action; pressing it clears the
  typed area so the row goes back to the computed figure, which its tooltip
  names.
- **The project ring's legend shows each deck's contribution** to the project
  figure (weight × progress) under the header `Đóng góp`: the figure the arc
  is sized by, so the legend adds up to the centre exactly (with `Còn lại`).
  1.7.0 showed the deck's own progress there, so `83,22%` sat beside an arc a
  fifth of the ring and the numbers did not add up to `42,91%`. The deck's own
  progress is the table's, beside the ring, as `Tiến độ sàn`; hovering a slice
  still names both figures. No number changed.
- **The login screen's picture moves**: "Free construction Animation" by
  Lakhwinder, from LottieFiles
  (https://lottiefiles.com/free-animation/construction-g8Hve0ildf), under the
  Lottie Simple License (https://lottiefiles.com/page/license), in its
  original colours, played by `lottie-web` (new dependency). It is loaded only
  by the login screen, is shown on phones too (above the card, 160 px tall at
  most), and pauses while the page is hidden. The drawn platform stays for
  visitors who ask for reduced motion and whenever the animation cannot load.
  The published file loops eight of its movements with expressions, which
  the light player skips; those are written out as keyframes
  (`scripts/bake-lottie-pingpong.mjs`), so it plays as published.
- **One layout for every screen.** One inset inside every card, one type
  scale, table columns aligned by content and centred vertically, one control
  height per row, one colour swatch, and eight distinct chart colours.
  Categories read as coloured badges; the facts beside a title read as one
  line.
- **One filter bar.** A bar with more than one control applies on `Tìm`, with
  `Đặt lại` beside it; the work is chosen from a searchable select everywhere,
  and tab-like filters are searchable selects.
- **The field screens, second pass.** One header holds the navigation and the
  account menu, with no back buttons; the deck is picked on the Sàn page; each
  tab has one filter bar with the project first; the exports are bar actions.
  The admin table, type and colour rules apply there too; on phones tables
  scroll sideways, stat cards are compact and chart legends run one item per
  line.
- **Explanations moved out of the way.** Subtitles that read like the
  developer's reasoning are removed or become a `(?)` tooltip or a rule; the
  `Quy tắc áp dụng` entries read as helper text; no rule IDs on screen.
- The viewer role reads **Visitor** everywhere it read `Chỉ xem`.

### Fixed

- **Every number field reads a Vietnamese decimal comma**: "2,5" Mhr is 2,5,
  not 25. In production since 1.4.0, antd's number field deleted the comma, so
  "2,5" was saved as 25, "0,7" of a weight as 7 and clamped to 1, and "1.230,5"
  as 1,2305. Affected: Mhr thực hiện and Mhr hao phí in the bay dialog, the
  hour fields of the effort history, the KPI plan area, the work and deck
  weights, and the manual %. The deck area already read a comma but stopped at
  a thousands dot ("5.258,5" was saved as 5,258); it now reads it too.
  A dot is read as the decimal point, as phone keypads send it ("2.5" is 2,5),
  except in the two area fields (KPI plan area, deck area): there "8.000" means
  8000 m², as the field's own placeholder writes it, so type "8,125" for
  8,125 m². A page number reads "1.230" as page 1230.
- A read-only report, `supabase/queries/decimal_comma_suspects.sql`, lists
  stored values that a dropped comma may have inflated or deflated — effort
  hours, KPI plan areas, manual %, deck totals — for the owner to check with
  the people who typed them. Nothing is changed automatically.
- **Nhân lực polish**:
  - A name clash quotes the name as it is stored, not as typed.
  - Lock, hide and a change to Nhân viên confirm under a lock or an eye, not
    the trash can, since nothing is deleted.
  - The page error clears when a row action starts or the filter bar is
    applied or reset.
  - Thêm uses Sửa's password field (masked, eye inside, copy and generate
    joined beside it).

### Database

- `0037_nhan_luc_unique_names.sql` — one name per person across GS/Visitor
  accounts (`profiles`) and employees, through a BEFORE row trigger on each
  table; a refusal is `SQLSTATE PPDUP`. The name lookups run only for admins
  and the service role, and INSERT on `profiles` is revoked from anon and
  authenticated, on `employees` from anon. **Run
  `supabase/queries/nhan_luc_duplicates.sql` (read-only) first**: the migration
  fails fast, changing nothing, while any name it lists as blocking exists.

### Operational

Deploy in this order: migration `0037` → redeploy the Edge Function
`admin-users` (Đổi phân quyền, Visitors without a project, the duplicate-name
refusals) → the app. The app's Nhân lực dialogs call the new function
actions. After deploying, run `supabase/queries/decimal_comma_suspects.sql`
(read-only) and check the rows it lists.

## [1.7.0] - 2026-09-15

Feedback Rv6 — eight items from Linh after she accepted Rv5, one item the owner
added, and one bug she reported separately the same day. Three of the items
needed a database migration each; all three are additive.

### Added

- **A3.4 compares a deck between two dates.** Each layer of the deck-progress
  panel has a date picker beside its coat picker; a date shows the bays as they
  stood at the end of that day, rebuilt from the recorded history, with the
  header saying `Trạng thái ngày …`. Two layers side by side therefore compare
  one coat on two days, or two coats on one day. History is complete from
  2026-08-24 and the panel says so. In `So sánh hai lớp` each layer's controls
  sit above its own drawing.
- **`Hiện kế hoạch` on A3.4**, the same switch the field screen has: off, the
  drawing shows only what has been done, with no zone tint, outline or label.
- **`Tất cả công đoạn` as a layer on A3.4**: every bay in the colour of the
  highest coat it has reached, exactly the field screen's live view, with one
  chip per coat and every coat's zones listed below.
- **Zones can be renamed** from their own dialog; the coat suffix stays.
- **Admins reorder decks** with `Lên`/`Xuống` on the deck list. The field
  screen's tabs, the rollup, the KPI plan table and the workbook already read
  that order.
- **KPI colours per deck.** The admin picks a Plan and an Actual colour for each
  deck under `Màu biểu đồ theo sàn`; the chart uses them whenever one deck is
  selected, on the admin's screen and on the field screen alike. Unset decks
  keep the system pair.
- **KPI chart zoom**: a range slider under the axis; drag its handles to zoom,
  its body to pan. It resets when the filters change.
- **A title under the KPI chart** — the deck's name and, when one coat is
  chosen, the coat's: `CAM Under Deck MD — Blasting & Coat 1`.
- **A quantity and a unit per work.** A work declares what its decks are
  measured in — `Diện tích`/`m²` by default, or anything the admin types, such
  as `Khối lượng`/`Kg`. Every label beside a figure follows the work when one
  work is in view; where several works of different units meet (the project
  rollup, the workbook's project sheets, KPI across all coats) the heading reads
  `Số lượng`, each row carries its own unit, and a sum across units is shown as
  `—` with the reason. **No number changed**: the columns still hold the same
  values and every percentage is a ratio within one work.
- **The viewer sees every project.** A `Chỉ xem` account lands on a project
  chooser, switches projects from the header, and no longer needs to be assigned
  to any. The users screen says so on such accounts. The role still writes
  nothing.

### Changed

- The project rollup's ring lists decks by **code**, and the percentage beside
  each is the deck's own progress — the same number as the table beside it. The
  arcs still add up to the project figure; the note explaining the arithmetic is
  gone, and the ring has more room so codes are not cut short.
- The KPI cumulative-actual curve **stops at today**; the plan still runs to the
  end of its window. The paragraph under the chart about corrections moved to
  the specification.

### Fixed

- **Changing a deck's total area did not re-divide the bays.** A3.1 saved the
  new total and the bays kept their old figures, so the sum of bays could read
  27.429 m² under a 6.000 m² deck and every area-weighted number was computed
  from stale bays until someone happened to re-save the mesh. Saving the total
  now re-divides every bay by its drawn share, keeping every bay's identity,
  coat and history. The confirmation dialog had always promised this.
- `Lên`/`Xuống` and a zone rename cannot fire twice from one fast interaction.
- Dragging a colour in the OS picker writes once when the drag settles, not once
  per step.
- The A3.4 date picker refuses future dates by the app's Vietnam day, like every
  other "today" in the app.

### Database

- `0034` — `is_viewer()`, and `my_projects()` / `my_works()` re-created so a
  viewer reads every project and every work; `coworker_names()` extended the
  same way. Function bodies only; no table, column or policy changes, and no
  write path opened.
- `0035` — `decks.kpi_plan_color`, `decks.kpi_actual_color`, nullable `#RRGGBB`.
- `0036` — `works.quantity_label`, `works.unit`, `not null` with the defaults
  `Diện tích` and `m²`, so every existing work reads as before.

### Operational

`0034`, `0035` and `0036` must reach production **before** this release is
deployed: the app selects the new columns by name, and PostgREST answers a
select naming a missing column with `400` rather than omitting it. Applying
them ahead of time is safe — the running 1.6.0 app never names them. No Edge
Function change.

### Known consequences

- History for the date comparison starts at 2026-08-24; a bay redrawn since
  then has no earlier history and reads as not started before its redraw.
- A deck placed in two works of different units has no unit of its own and is
  shown as a bare figure under `Số lượng`. Linh's rule is that decks of one
  unit go in one work; the database does not enforce it.

## [1.6.0] - 2026-09-09

Feedback Rv5, and the five corrections the owner made after reviewing it on
the development project.

### Added

- **KPI, plan against actual** — its own item in the sidebar for the admin, and
  its own screen on the field client. The admin types a start and an end date
  per coat of each deck; the system works out how much of that coat remains on
  the start date and spreads it evenly over every calendar day of the window,
  Sundays and holidays included. One chart carries planned and actual m² per day
  as bars and the two cumulative shares as S-curves, filterable by deck and by
  coat. It reproduces the customer's own `KPI.xlsx`, whose figures are the
  regression tests. The admin writes the dates; the admin, the foreman and the
  viewer all read the charts.
- **`Thông tin nhanh — Hôm nay`** on every deck tab of the field screen: the m²
  recorded today against each coat the admin configured on that deck, today's
  man-hours and wasted hours, and the totals to date. Per deck, across every
  work it belongs to, and it says on its face that man-hours exist only from
  2026-09-05.
- **Search and an Excel export on the employee roster.** The search ignores tone
  marks, so `cuong` finds `Lê Minh Cường`. The export always carries the whole
  roster including retired names, whatever the search is filtered to, and says
  so.
- A search box on the crew-lead table of the productivity screen.
- **Crew productivity in the exported report**, as a block below the coat table
  on the existing `Năng suất` sheet rather than a sheet or a download of its own.
  It covers the whole project and does not follow the screen's filters.

### Changed

- **A bay being taken off a coat is no longer asked for a crew or for hours.**
  Recording a fresh bay is unchanged: every field is there from the moment the
  dialog opens.
- The productivity screen no longer lists the `Chưa bắt đầu` coat or the
  `Chưa ghi` crew lead in any table or chart, and **hours booked against no coat
  now leave every total on that screen and in the workbook** — the cards above
  the coat table, the crew table, the waste-reason table and the field screen's
  own figures all agree again.
- The project rollup's ring and its `Tổng dự án` m² cover the decks the table
  lists, no longer the decks it hides.
- The KPI plan window is one range picker per coat, matching how plan dates are
  entered elsewhere in the app.

### Fixed

- **Decks read 0,00% on the project rollup although they had been worked for
  weeks.** The project-wide read of bay states was a single unpaged request, and
  PostgREST answers at most 1000 rows without reporting that it truncated. Which
  decks lost their states depended on the order the database happened to return
  them, which is why one screenshot showed a deck at 31,48% and the next at
  0,00%. Every bay-state read now pages. The field screen's deck tabs were wrong
  the same way and are fixed with it. **No data was lost or repaired — the rows
  were always there.**
- The project's total m² added up decks that the table above it hides. That
  figure is display only and never fed a percentage.
- KPI actual counted work done before the plan window, while the planned area
  counted only what remained at the start of it — so a coat 76% finished before
  its window began read 327% against plan. Actual now counts only what falls
  inside the window, with no upper bound so overrun stays visible.
- The KPI day axis is a contiguous range of days rather than a list, so coats
  whose windows do not abut no longer leave the axis with holes in it.

### Removed

- **The deck-area warning on the field screen.** It asked the reader to have an
  admin check the deck, on the one screen whose users are never admins. The
  admin's own warning, at a 5% threshold, is untouched. It had also been firing
  on floating-point dust — the customer's screenshot showed it complaining that
  40.000,00 m² does not equal 40.000,00 m².

### Database

- `0033` — `stage_plans`: one KPI plan window per coat, with the admin's
  optional area override. Purely additive: a new table, its own two policies and
  two triggers, and no change to anything already there.

### Operational

`0033` must reach production before this release is deployed. It is safe to
apply ahead of time — the running 1.5.0 app never reads the table — and unlike
`0032` there is no window in which the old app breaks. No Edge Function change
since 2026-09-04.

### Known consequence

KPI actual takes each bay at its **last** update for a coat, at the client's
request, so that a foreman's mistyped figure can be corrected instead of counted
twice. A past day's actual therefore changes when a correction lands on it. The
chart says so under the axis.

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

[1.9.0]: https://github.com/leminhhieu98py/paint-progress/compare/v1.8.0...v1.9.0
[1.8.0]: https://github.com/leminhhieu98py/paint-progress/compare/v1.7.0...v1.8.0
[1.7.0]: https://github.com/leminhhieu98py/paint-progress/compare/v1.6.0...v1.7.0
[1.6.0]: https://github.com/leminhhieu98py/paint-progress/compare/v1.5.0...v1.6.0
[1.5.0]: https://github.com/leminhhieu98py/paint-progress/compare/v1.4.0...v1.5.0
[1.4.0]: https://github.com/leminhhieu98py/paint-progress/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/leminhhieu98py/paint-progress/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/leminhhieu98py/paint-progress/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/leminhhieu98py/paint-progress/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/leminhhieu98py/paint-progress/releases/tag/v1.0.0
