# Paint Progress

Tracks paint coats and scaffolding removal, bay by bay, on offshore platform
decks. Replaces an Excel workbook and emailed PDF drawings.

Two surfaces on one database:

- **Admin**, on a laptop. Projects, decks, the drawing and the bay mesh traced
  over it, each deck's paint coats and their weights, zone plans with dates, GS
  accounts, and the XLSX report.
- **GS**, on a tablet in the field. Open a deck, tap a bay, record the coat it
  has reached, leave a note. Meant to work one-handed in gloves.

Every percentage divides by the deck's declared area, and a deck's figure is
the weighted sum of each coat's share. That number is what the customer is
billed against, so it is computed one way, in one place
(`src/domain/progress.ts`), and checked against the source workbook.

## Running it

```bash
nvm use 22          # vitest needs node 22; node 18 fails on styleText
npm install
cp .env.example .env   # fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
npm run dev
```

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run typecheck` | `tsc -b --force`. **`npx tsc --noEmit` is a no-op here** — the root tsconfig is a solution file with `files: []` |
| `npm test` | Vitest. The RLS suite skips itself unless `.env.test.local` exists |
| `npm run lint` | Oxlint |
| `npm run build` | Production bundle into `dist/` |

Database, RLS, the account Edge Function and the live integration suite are
documented in [`supabase/README.md`](supabase/README.md). Read it before
touching a migration.

## Deploying

Vercel, from `main`. Preset Vite, root `./`, defaults for build and output.

Three environment variables, and they are **build-time**: Vite inlines them
into the bundle, so a deploy that ran without them needs another deploy, not a
restart.

| Variable | Value |
|---|---|
| `VITE_SUPABASE_URL` | The Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Its anon key. Public by design — RLS is the boundary |
| `VITE_APP_BASE_PATH` | Empty. Set it to move every route behind a prefix (spec §7.3) |

Then, on the Supabase project:

```bash
npx supabase secrets set CRED_ENC_KEY="$(openssl rand -base64 32)" --project-ref <ref>
npx supabase secrets set ADMIN_APP_ORIGIN="https://<deployed-domain>" --project-ref <ref>
```

`CRED_ENC_KEY` encrypts stored GS passwords; losing it means none of them can
be read back. `ADMIN_APP_ORIGIN` is the only origin the account Edge Function
answers — leave it unset and it falls back to localhost, so the Users screen
fails CORS with nothing on screen explaining why.

Set the password floor on the Supabase dashboard too (Authentication →
Providers → Email): minimum length **12**, requirements **letters and digits**.
`supabase/config.toml` configures the local stack only and cannot prove what a
hosted project is set to.

### About `vercel.json`

JSON takes no comments, so the two decisions in it are recorded here.

**The rewrite** exists because React Router owns every path and the build emits
one `index.html`. Without it `/admin/decks/<id>` works when reached by clicking
through the app and 404s the moment anyone refreshes it or opens a link
somebody sent them. `assets/` is excluded rather than left to Vercel's
filesystem-first ordering: that ordering is documented and would make the
exclusion unnecessary, but the failure it guards against is a hashed bundle
being served `index.html` — the whole app blank — which is not a thing to
discover on the morning it is handed over.

**No Content-Security-Policy**, deliberately. This app opens a websocket to
Supabase Realtime, rasterises PDFs in a worker and draws to canvas. A policy
written without measuring each of those is a policy that breaks the field
screen in a way nobody notices until a foreman cannot record a bay.

## Licence

Private. Not for redistribution.
