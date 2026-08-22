# Supabase

Migrations are applied to the hosted project with `npx supabase db push`.
Local `supabase start` needs Docker and is not required for this project.

## Schema verification

`supabase/verify_schema.sql` exercises the trigger and foreign-key behaviour set
up across migrations 0001-0005: cross-project stage rejection, the audit
trigger, the stage-change log, the durability of the `cell_events` name
snapshot against both a stage rename and a hard stage delete (on separate
fixtures, so destroying one stage cannot disarm the other check), an
explicit assertion that the project-delete cascade race is still armed
before it runs, and a full project delete/cascade. Run it after any change
to these migrations, and always before adding more of them (Task 5 adds RLS
policies and a fourth `cells` trigger):

```bash
nvm use 22
npx supabase db query --linked -f supabase/verify_schema.sql
```

Every returned row must begin with `PASS` — 9 rows in a passing run, one
per numbered check in the file's header comment.

**WARNING: this script inserts and then deletes test rows. Never run it
against a database holding real project data.**

## One-time dashboard setup

See spec §12. In short:

1. Authentication → Providers → Email: disable **Allow new users to sign up**.
2. Create the bootstrap admin `linhdeptrai123@app.local`, then insert its
   `profiles` row with `username = 'linhdeptrai123'`, `role = 'admin'`.
3. Storage: create the private bucket `drawings`.
4. Edge Functions → `admin-users` → Secrets: `CRED_ENC_KEY`.
   `SERVICE_ROLE_KEY` is injected by the platform as `SUPABASE_SERVICE_ROLE_KEY`.

Never commit any of these values.
