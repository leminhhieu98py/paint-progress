# Supabase

Migrations are applied to the hosted project with `npx supabase db push`.
Local `supabase start` needs Docker and is not required for this project.

## Schema verification

`supabase/verify_schema.sql` exercises the trigger, foreign-key and RLS
behaviour set up across migrations 0001-0007: cross-project stage
rejection, the audit trigger, the stage-change log, the durability of the
`cell_events` name snapshot against both a stage rename and a hard stage
delete (on separate fixtures, so destroying one stage cannot disarm the
other check), an explicit assertion that the project-delete cascade race is
still armed before it runs, a full project delete/cascade, and — since
0006/0007 — that RLS is enabled on every table, that `gs_credentials` and
`credential_access_log` carry exactly the policies (or absence of policies)
they're supposed to, that the security-definer helper/trigger functions are
configured correctly, and that the `cells` trigger firing order is both
named and timed correctly. Run it after any change to these migrations:

```bash
nvm use 22
npx supabase db query --linked -f supabase/verify_schema.sql
```

Every returned row must begin with `PASS` — 19 rows in a passing run, one
per numbered check in the file's header comment.

**WARNING: this script inserts and then deletes test rows. Never run it
against a database holding real project data.**

This script connects as `postgres`, which bypasses RLS entirely (see the
banner at the top of the file). It verifies structure only — it cannot
observe whether an actual `authenticated` session is correctly allowed or
denied. That is what the RLS integration suite below is for.

## RLS integration suite

`tests/rls.integration.test.ts` (run via `npx vitest run
tests/rls.integration.test.ts`, or as part of `npm test`) exercises RLS as
a real GS session. It is skipped, not failed, when unconfigured. Required
run order, once:

1. In the Supabase dashboard, create both auth accounts: the bootstrap
   admin (`linhdeptrai123`, see below) and the test GS (username
   `rlstest-gs`, any password).
2. `nvm use 22 && npx supabase db query --linked -f tests/rls-fixtures.sql`
   — every returned row must say `PASS`. A `FAIL` means one of the two
   accounts above is missing or misconfigured; the suite must not be
   trusted until this script reports all-`PASS`.
3. Copy `.env.test.local.example` to `.env.test.local` and fill in the
   Supabase URL/anon key and the GS password chosen above.

Set `RLS_TESTS_REQUIRED=1` to make the suite fail loudly instead of
silently skipping when `.env.test.local` is absent.

## One-time dashboard setup

See spec §12. In short:

1. Authentication → Providers → Email: disable **Allow new users to sign up**.
2. Create the bootstrap admin `linhdeptrai123@app.local`, then insert its
   `profiles` row with `username = 'linhdeptrai123'`, `role = 'admin'`.
3. Storage: create the private bucket `drawings`.
4. Edge Functions → `admin-users` → Secrets: `CRED_ENC_KEY`.
   `SERVICE_ROLE_KEY` is injected by the platform as `SUPABASE_SERVICE_ROLE_KEY`.

Never commit any of these values.
