# Supabase

Migrations are applied to the hosted project with `npx supabase db push`.
Local `supabase start` needs Docker and is not required for this project.

## Schema verification

`supabase/verify_schema.sql` exercises the trigger, foreign-key and RLS
behaviour set up across migrations 0001-0014: cross-project stage
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
re-stamps every cell on the deck), that `project_stages`' `(project_id,
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
Run it after any change to these
migrations:

```bash
nvm use 22
npx supabase db query --linked -f supabase/verify_schema.sql
```

Every returned row must begin with `PASS` — 31 rows in a passing run, one
per numbered check in the file's header comment.

Checks 29-31 arrived with `0014` and report `FAIL` until that migration is
applied — check 29 with `from_stage_name <NULL>`, which is the defect it fixes,
reproduced. Once this project holds real data, stop running this script against
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
3. Storage: create the private bucket `drawings`.
4. Edge Functions → `admin-users` → Secrets: `CRED_ENC_KEY`.
   `SERVICE_ROLE_KEY` is injected by the platform as `SUPABASE_SERVICE_ROLE_KEY`.

Never commit any of these values.
