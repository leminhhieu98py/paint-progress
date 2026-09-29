# Supabase

Migrations are applied to the hosted project with `npx supabase db push`.
Local `supabase start` needs Docker and is not required for this project.

## Schema verification

`supabase/verify_schema.sql` exercises the trigger, foreign-key and RLS
behaviour set up across migrations 0001-0015: cross-project stage
rejection, the audit trigger, the stage-change log, the durability of the
`cell_events` name snapshot against both a stage rename and a hard stage
delete (on separate fixtures, so destroying one stage cannot disarm the
other check), an explicit assertion that the project-delete cascade race is
still armed before it runs, a full project delete/cascade, and — since
0006/0007/0008 — that RLS is enabled on every table, that `gs_credentials`
and `credential_access_log` carry exactly the policies (or absence of
policies) they're supposed to, that the security-definer helper/trigger
functions are configured correctly, that the `cells` trigger firing order is
both named and timed correctly, and that no foreign key in the schema is
left with a bare `ON DELETE` (no action). Since 0009, it also checks that the
`drawings` storage bucket exists and is private, that its two storage
policies exist, and that the last two functions (`assert_stage_belongs_to_project`,
`set_cell_audit_columns`) pin `search_path`. Since 0011/0012/0013 it also
checks that `set_cell_audit_columns` stamps `updated_at`/`updated_by` only
when `stage_id` actually changes (so a geometry-only save no longer
re-stamps every cell on the deck), that `deck_stages`' `(deck_id,
seq)` uniqueness is `deferrable initially deferred` and that both stage
writes the config panel issues are accepted — a reorder that swaps two
`seq` values in one statement, and a middle-stage removal that renumbers
the survivors past the vacated `seq` — and that a non-admin cannot forge
`cells.updated_at` or `cells.updated_by` while a plain stage change is
still accepted and still stamped.
Since 0014 it also checks that deleting a stage a cell currently sits at
writes exactly one `cell_events` row carrying the deleted stage's name (it
used to write a nameless one, permanently, because `cells.stage_id` is `ON
DELETE SET NULL` and 0005 dropped the recovering foreign key), that returning
a cell to "not started" while its stage is still alive is still logged with
that name, and that a whole-project delete still succeeds with the new
`before delete` trigger inside its cascade.
Since 0015 it also checks that `public.cells` is a member of the
`supabase_realtime` publication — Realtime replicates that publication and
nothing else, so without the membership the GS screen's channel subscribes
successfully and then receives nothing at all. Like checks 29-31, check 32
reports `FAIL` until its migration is applied.
Since 0022/0023 it also checks (34, 35) that `coworker_names()` and
`set_report_note()` are security definer with a pinned `search_path`, that
`anon` cannot execute either, that `cell_events` carries the four report-note
columns and the named `cell_events_report_edited_by_fkey`, and that
`authenticated` still holds no UPDATE on `cell_events` -- `set_report_note()`
is meant to be the only client-reachable write onto the audit table. Both
report `FAIL` until their migrations are applied.
Since 0024/0025 (work items) every fixture in the script hangs off a `works`
row via `_verify_seed_work`, the progress checks read and write `cell_states`
instead of `cells.stage_id`, and four rows were added: `cell_states` is
published with `REPLICA IDENTITY FULL`, `cells` carries none of the four
progress columns, the three new tables carry their policies, and the four
`cell_states` trigger functions pin `search_path`. Two checks plant their
sentinel with `cell_states_assert_gs_write` held for one statement, because
the stamper now writes `updated_at` on insert too.
Run it after any change to these
migrations:

```bash
nvm use 22
npx supabase db query --linked -f supabase/verify_schema.sql
```

Every returned row must begin with `PASS` — 45 rows in a passing run against
a project with `0001`–`0032` applied (measured 2026-09-07 on dev); row 46
arrives with `0037` and reports `FAIL` until it is applied.

The `0019` note check reports `FAIL` until that migration is applied, and the
three note tests in `tests/rls.integration.test.ts` are `it.skip`ped for the
same reason -- unskip them in the change that applies it.

The teardown also RESETS the fixture bay on deck `AD` -- stage back to null,
note back to empty -- and prunes the `cell_events` it accumulates. It does not
touch deck `DD`: that bay and its one event are read-only evidence two tests
look for. Fixtures are seeded by hand and inserted `on conflict do nothing`, so
without this reset every run starts on whatever the last one left, and a test
that asserts on a CHANGE quietly becomes an assertion about nothing.

`0019`–`0032` are applied to the dev project, and production now holds
`0001`–`0032`. The owner pushed `0001`–`0029` together with the current Edge
Function on 2026-09-04, then `0030` (effort columns on `cell_states` /
`cell_events`, the `set_cell_event_effort` backfill RPC, the effort rule in the
GS write guard) and `0031` (`work_decks.deadline`) with the `v1.4.0` release,
and `0032` (`employees`, `cell_states.waste_order`, `cell_events.waste_order`)
with `v1.5.0` on 2026-09-07. `CHANGELOG.md` records which release carried
which migration. No Edge Function change since 2026-09-04.

Every migration from `0027` on is additive for DATA -- each new column is
nullable or defaulted and no row is rewritten -- so one arriving early never
breaks the app already deployed. The app that NEEDS it is the fragile side: it
writes or reads the new columns and fails against a database without them, so
the migration always goes first. `0032` is the one exception worth naming: it
replaces `set_cell_event_effort` with a seven-argument signature and drops the
six-argument one, so between its push and the deploy the admin backfill on the
old app fails. Minutes apart, and only that one action.

`0033` (`stage_plans`, the KPI plan window per coat — Feedback Rv5 item 9) is
**applied to dev on 2026-09-09 by the owner, and not yet to production.** It
is a new table with its own two policies and two triggers, plus a
`do $$ ... $$` block at the end that raises if the columns, the primary key,
the policies, the triggers or the two check constraints are not what the
migration claims — so applying it is self-verifying and needs no new
`verify_schema.sql` row. Purely additive: it alters nothing that already
exists, so it is safe to apply to production ahead of the app that needs it,
and unlike `0032` there is no window in which the deployed app breaks. The
`stage_plans` cases in `tests/rls.integration.test.ts` passed against dev on
2026-09-09, so the two policies are verified by a real viewer session and not
only by shape.

`0034` (`is_viewer()`, and `my_projects()` / `my_works()` re-created so a
viewer reads every project — Feedback Rv6 item 7, Linh's "theo đề xuất") is
**applied to dev on 2026-09-15 by the owner, and not yet to production.** It
creates one predicate and replaces the bodies of three existing functions
(`my_projects`, `my_works`, `coworker_names`) with the same names, signatures,
return types and grants, so the thirteen member read policies and the
`drawings` storage policy that call them are untouched and keep working. Its
`do $$ ... $$` block raises if any of the three functions gained an overload,
lost its definer or pinned `search_path`, or stopped consulting `is_viewer()`;
if `is_viewer()` or either set function returns anything with no caller; or if
the read policies no longer route through the two functions — so applying it
is self-verifying and needs no new `verify_schema.sql` row (rows 14 and 34
still hold). Purely additive: no table, column or policy changes, so it is
safe to apply to production ahead of the app that needs it. The
`0034` cases in `tests/rls.integration.test.ts` (a viewer with no
`project_members` row reads every table of a project it was never assigned
to and writes none of them; a GS with no assignment still reads nothing) run
against dev in the owner's full suite; run them before the PROD push.

`0035` (`decks.kpi_plan_color`, `decks.kpi_actual_color` — the KPI chart's
Plan and Actual colours per deck, Feedback Rv6 item 5c) is **applied to dev
on 2026-09-15 by the owner, and not yet to production.** Two nullable `text`
columns on `decks`, each with a check
constraint admitting null or `#RRGGBB` (the same six-digit form the
StageConfigPanel hex field enforces for `stages.color`); null is the system
default the chart uses today. No policy, trigger or function work:
`decks_admin_all` carries the admin write and `decks_member_read` (through
`my_projects()`, so a viewer reads it on every project since `0034`) carries
the read for the GS and the viewer, and both already cover every column of
the row. Its `do $$ ... $$` block raises if either column is missing, not
text, NOT NULL or defaulted; if either check constraint is missing or does not
say "null or `#RRGGBB`"; if the pattern admits a five-, seven- or no-hash
value; or if `decks` no longer carries exactly the two `0006` policies — so
applying it is self-verifying and needs no new `verify_schema.sql` row.
Purely additive: no row rewritten, so it is safe to apply to production
ahead of the app that needs it; the deployed app selects its deck columns by
name and never sees these. **The reverse order is not safe:** the app built
from this branch names the two columns in its deck selects
(`progressApi.ts` `DECK_SELECT`, `decksApi.ts`), and PostgREST answers a
select that names a missing column with `400 column decks.kpi_plan_color does
not exist` rather than omitting it — every screen that loads decks would
error. Apply `0035` first, deploy the app second, as was done for `0033`. No
new `tests/rls.integration.test.ts` case: the policies are unchanged and
their `decks` cases already run.

`0036` (`works.quantity_label`, `works.unit` — the quantity a work is measured
in and its unit, Feedback Rv6 item 3, Linh: "the unit belongs to the work") is
**applied to dev: pending (the owner applies it; fill in the date), and not
yet to production.** Two `text not null` columns on `works` defaulting to
`Diện tích` and `m²`, each with a check constraint bounding the trimmed text
to 1–30 characters (the same rule `saveWorks` enforces before writing), so
every existing work reads exactly as it did until an admin edits it. The
`*_m2` numeric columns (`decks.total_area_m2`, `cells.area_m2`,
`stage_plans.planned_area_m2`) are NOT renamed: they hold the quantity in the
work's unit, and their column comments now say so (RV6-38). No policy, trigger
or function work: `works_admin_all` carries the write and `works_member_read`
(through `my_works()`) the read, and both already cover every column. Its
`do $$ ... $$` block raises if either column is missing, nullable or
undefaulted; if a default is not the string the app hard-coded until now; if
any existing row did not take the defaults; if either length constraint is
missing or does not say "btrim … between 1 and 30"; if the rule admits a blank
or a 31-character value or refuses a 30-character one; if any of the three
`*_m2` columns is gone; or if `works` no longer carries exactly its two
policies — so applying it is self-verifying and needs no new
`verify_schema.sql` row. Purely additive: safe to apply to production ahead of
the app that needs it; the deployed app selects its work columns by name and
never sees these. **The reverse order is not safe:** the app built from this
branch names both columns in every work select (`worksApi.ts`
`WORK_COLUMNS`, `progressApi.ts` `WORK_SELECT`, `projectsApi.ts`,
`gsApi.ts`), and PostgREST answers such a select with `400 column
works.quantity_label does not exist` — the KPI, Sàn, Công việc and GS screens
all fail to load (seen on dev on 2026-09-15 while the code was ahead of the
database). Apply `0036` first, deploy the app second. The `mapWork` defaults
only cover a row that lacks the fields, which a 400 never produces. No new
`tests/rls.integration.test.ts` case: the policies are unchanged and their
`works` cases already run.

`0037` (two BEFORE row triggers, `employees_assert_unique_name` and
`profiles_assert_unique_name` — one person, one row on the Nhân lực screen,
rules NL-03/NL-06) is **not yet applied to dev or production**. Names compare
as `lower(btrim(full_name))`, as `employees_name_key` does: two GS/Visitor
accounts never share a name (hidden ones included), and an employee never
shares one with a visible GS/Visitor account (a hidden one is allowed: that is
an account parked by "Đổi phân quyền" to Nhân viên). Admin accounts are outside
the rule. A refusal is SQLSTATE `PPDUP` with DETAIL `account`, `hidden_account`,
`employee` or `retired_employee`, which the app and the `admin-users` Edge Function translate. The lookup runs
only for an admin, the service role and SQL sessions: a BEFORE trigger fires
before RLS checks the new row, so for anon or a GS it would confirm that a
name exists; those callers are refused first with RLS's own 42501, which also
stops a security definer function they call from writing a name around the
rule. For the same
reason `0037` revokes INSERT on `profiles` from `anon` and `authenticated`
(only the Edge Function creates accounts) and on `employees` from `anon`.
**It changes no row.** Before the push, run the read-only report
`supabase/queries/nhan_luc_duplicates.sql`; every row with
`blocks_migration = true` must be renamed or merged by hand first, because the
migration's first block raises (before creating anything) while one exists.
Its closing `do $$ ... $$` block raises if either function is not a pinned
definer raising `PPDUP`, if either trigger is missing, disabled or on other
events, if `employees_name_key` is gone, or if the data breaks the rule;
`verify_schema.sql` row 46 re-checks the same on demand. Deploy order:
`0037`, then the Edge Function (its `create`, `unhide` and new `change_role`
translate the refusal and order their writes around it), then the app. The
deployed app keeps working against `0037` alone; a refused write shows the
database's English message until the new app ships. The owner-run cases are in
`tests/nhanLuc.integration.test.ts`.

`supabase/scripts/purge_user.sql` removes one test account together with the
bays it ticked (owner request, 2026-09-04). It is a dry run until its
`v_confirm` literal is set; read its header before running it anywhere.
The `0025` dev backfill was checked: every project's percentage was identical
before and after it, to ten decimals.

The Vitest global teardown runs `tests/rls-teardown.sql` through
`supabase db query --linked`, i.e. against whatever project the CLI is linked
to. Since 2026-09-04 it refuses to run unless that ref equals
`RLS_TEST_PROJECT_REF` in `.env.test.local`, because a unit-test run right
after a production migration push (CLI still linked to PROD) executed the
teardown there once. Relink to dev (`npx supabase link --project-ref <dev>`)
after every production push.

Checks 29-31 arrived with `0014` and report `FAIL` until that migration is
applied — check 29 with `from_stage_name NULL`, which is the defect it fixes,
reproduced. Check 32 arrived with `0015` and reports `FAIL` with `0 membership
row(s)` until that migration is applied, which is the state in which realtime
is silently dead. Once this project holds real data, stop running this script against
it and use a disposable copy. It is self-cleaning in every ordinary outcome, but
a cleanup step that fails and is caught leaves that check's `VERIFY` fixtures
behind — see check 9's comment.

**WARNING: this script inserts and then deletes test rows. Never run it
against a database holding real project data.**

This script connects as `postgres`, which bypasses RLS entirely (see the
banner at the top of the file). It verifies structure only — it cannot
observe whether an actual `authenticated` session is correctly allowed or
denied. That is what the RLS integration suite below is for.

## RLS integration suite

`tests/rls.integration.test.ts` (run via `npx vitest run
tests/rls.integration.test.ts`, or as part of `npm test`) is the only place
real RLS decisions are observed, because it is the only thing here that runs
as an ordinary `authenticated` session rather than as `postgres`. It holds
three suites:

- **as a GS session** — the member read policies, the stage-only update
  guard, and the escalation attempts a supervisor could make.
- **as an admin session** — the eleven policies that resolve through
  `is_admin()`. Each one gets a positive assertion through the admin session
  *and* the same operation through a GS session, which must be refused. The
  pairing is the point: a policy rewritten to `using (true)` passes every
  positive-only assertion, and only the GS half notices.
- **the `admin-users` Edge Function** — the four actions, the create
  rollback, the inactive-admin 403, the GS 403 and the malformed-body 400,
  all through `functions.invoke` with a real session JWT.

It is skipped, not failed, when unconfigured. Required run order, once:

1. In the Supabase dashboard, create all three auth accounts: the bootstrap
   admin (`linhdeptrai123`, see below), the test GS (`rlstest-gs`) and the
   test admin (`rlstest-admin`, which also needs a `profiles` row with
   `role = 'admin'`). See `.env.test.local.example` for the exact steps.
2. `nvm use 22 && npx supabase db query --linked -f tests/rls-fixtures.sql`
   — every returned row must say `PASS`. A `FAIL` means one of the three
   accounts above is missing or misconfigured; the suite must not be
   trusted until this script reports all-`PASS`.
3. Copy `.env.test.local.example` to `.env.test.local` and fill in the
   Supabase URL/anon key and the two passwords chosen above.

Set `RLS_TESTS_REQUIRED=1` to make the suite fail loudly instead of
silently skipping when `.env.test.local` is absent.

### Teardown is a separate step

The admin and Edge Function suites write. Their `afterAll` hooks remove
everything an authenticated admin session can reach, but two kinds of
residue are out of reach of *any* session by design — the `auth.users` rows
the `create` action makes, and the `credential_access_log` rows `reveal`
writes (0008 revoked write grants on that table from `authenticated`, so the
only role that may read the log cannot edit it, test suites included). So
after running the suite against a live project:

```bash
nvm use 22
npx supabase db query --linked -f tests/rls-teardown.sql
```

Every returned row must say `PASS` — ten rows, the last four of which check
that the shared fixtures the script must *not* touch are still intact.
`tests/rls-fixtures.sql` repeats the same purge at setup, and unconditionally
restores `rlstest-admin`'s `active` flag, because a killed run skips both the
`afterAll` hooks and the teardown script.

**`rlstest-admin` can read every GS password through the Edge Function.**
Give it a long random password, and treat it as a real admin credential.

## One-time dashboard setup

See spec §12. In short:

1. Authentication → Providers → Email: disable **Allow new users to sign up**.
2. Create the bootstrap admin `linhdeptrai123@app.local`, then insert its
   `profiles` row with `username = 'linhdeptrai123'`, `role = 'admin'`.
3. Storage: nothing to do. `0009` creates the private `drawings` bucket as
   part of `db push` -- this step used to say "create the bucket by hand" and
   was left behind when the insert moved into the migration.
4. Edge Functions → `admin-users` → Secrets: `CRED_ENC_KEY`.
   `SERVICE_ROLE_KEY` is injected by the platform as `SUPABASE_SERVICE_ROLE_KEY`.

### Adding an admin

There is no in-app way, on purpose: `admin-users` hardcodes `role: 'gs'`, so an
admin can only be minted by someone holding the database. An admin reads every
project, reveals every GS password and deletes every deck; a path to one from
inside the app would be the most valuable thing here to compromise.

1. Dashboard → Authentication → Users → Add user → Create new user.
   Email `<username>@app.local`, a password, and tick **Auto Confirm User**.
   An unconfirmed user is refused at login with the same message as a wrong
   password, which is a bad thing to work out over a phone call.
2. Edit the two literals at the top of the DO block in
   `supabase/create_admin.sql`, then
   `npx supabase db query --linked -f supabase/create_admin.sql`.
3. It prints every admin account and whether each can sign in. Hand the
   credentials over in person or by a channel the recipient already trusts --
   never through a repo, a ticket or a chat log.

The dev bootstrap admin and a customer's admin should not be the same account:
the dev one is in `.env.test.local`, its password is known to whoever set the
project up, and the integration suite signs in as it.

Never commit any of these values.
