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

Every returned row must begin with `PASS` — 41 rows in a passing run against
a project with `0001`–`0028` applied (measured 2026-09-04 on dev).

The `0019` note check reports `FAIL` until that migration is applied, and the
three note tests in `tests/rls.integration.test.ts` are `it.skip`ped for the
same reason -- unskip them in the change that applies it.

The teardown also RESETS the fixture bay on deck `AD` -- stage back to null,
note back to empty -- and prunes the `cell_events` it accumulates. It does not
touch deck `DD`: that bay and its one event are read-only evidence two tests
look for. Fixtures are seeded by hand and inserted `on conflict do nothing`, so
without this reset every run starts on whatever the last one left, and a test
that asserts on a CHANGE quietly becomes an assertion about nothing.

`0019`–`0028` are applied to the dev project. Production holds `0001`–`0026`
(pushed by the owner on 2026-09-04). `0027` (`zones.color`) and `0028`
(viewer role, `profiles.hidden`, `project_members.all_works`, `work_members`,
`is_gs()` / `my_works()`, narrowed member policies) still have to be pushed to
production before the app from `feat/feedback-rv2-a` / `-b` is deployed
there. Both are additive and every existing membership keeps `all_works =
true`, so the deployed app is unaffected by them arriving early. `0028` also
needs the Edge Function redeployed with the app
(`npx supabase functions deploy admin-users --project-ref <prod ref>`): the
new actions (`rename`, `reactivate`, `hide`, `unhide`, `create` with `role`)
live there, and `deactivate` no longer removes memberships.

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
