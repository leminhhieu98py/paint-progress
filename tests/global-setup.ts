import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { promisify } from 'node:util'

const run = promisify(execFile)

/**
 * The rows of `supabase db query --output-format json`, whichever shape the CLI
 * prints. Up to 2.118 it was `{ "rows": [...] }`; 2.120 prints the bare array,
 * and both put "Initialising login role..." in front. Slicing from the first
 * `{` read only the first row of the array and failed on what followed.
 */
export function parseQueryRows(stdout: string): Record<string, unknown>[] {
  const starts = [stdout.indexOf('['), stdout.indexOf('{')].filter((i) => i >= 0)
  if (starts.length === 0) throw new Error(`rls-teardown: no JSON in the CLI output:\n${stdout}`)
  const parsed: unknown = JSON.parse(stdout.slice(Math.min(...starts)))
  if (Array.isArray(parsed)) return parsed as Record<string, unknown>[]
  return ((parsed as { rows?: Record<string, unknown>[] }).rows) ?? []
}

/**
 * Purge what the RLS suite leaves in the live project.
 *
 * The Edge Function's `create` action makes real auth users, and `reveal`
 * writes credential_access_log rows. Neither is reachable from any session the
 * suite holds: 0008 revoked write grants on the log from `authenticated`, and
 * deleting an auth user needs the service role. So the suite cannot clean up
 * after itself from inside a test, and tests/rls-teardown.sql used to be a
 * manual second step -- which was forgotten on its first real use, leaving a
 * deactivated GS account in the customer's project.
 *
 * Running it here makes the purge part of the run rather than a thing to
 * remember. It shells out to the Supabase CLI because that is the only client
 * on this machine holding credentials able to delete an auth user.
 */
// Vitest has no `globalTeardown` option -- a globalSetup file exports `teardown`
// instead. Naming it wrongly is silently ignored, which is how the first
// attempt at this passed its own run while leaking an account.
export async function teardown() {
  const configured = Boolean(
    process.env.RLS_TEST_ADMIN_USERNAME && process.env.RLS_TEST_ADMIN_PASSWORD,
  )
  // Nothing ran against the live project, so there is nothing to purge -- and
  // shelling out to the CLI on an ordinary unit-test run would be a surprise.
  if (!configured) return

  // The CLI runs this against whatever project `supabase link` last pointed at,
  // and that is not always the test project: the owner links PROD to push
  // migrations. On 2026-09-04 a unit-test run purged the "fixtures" on the
  // customer's database that way. So the linked ref must equal the one the
  // test env names, or nothing runs -- a leaked fixture is recoverable, a
  // reset customer bay is not.
  const expected = process.env.RLS_TEST_PROJECT_REF
  const linked = (await readFile('supabase/.temp/project-ref', 'utf8').catch(() => '')).trim()
  if (!expected || linked !== expected) {
    throw new Error(
      `rls-teardown refused: the CLI is linked to "${linked || '(nothing)'}" but ` +
        `RLS_TEST_PROJECT_REF is "${expected ?? '(unset)'}". Relink with ` +
        '`npx supabase link --project-ref <dev ref>` before running the suite.',
    )
  }

  const { stdout } = await run(
    'npx',
    // JSON explicitly: since CLI 2.11x the default is a text table, which the
    // parse below cannot read.
    ['supabase', 'db', 'query', '--linked', '--output-format', 'json', '-f', 'tests/rls-teardown.sql'],
    { cwd: process.cwd(), timeout: 120_000 },
  )

  // The script asserts its own results. A silent failure here would put us back
  // to leaking accounts, so a non-PASS row fails the run loudly.
  const rows = parseQueryRows(stdout)
  const failures = rows.filter((r) => !JSON.stringify(r).includes('PASS'))
  if (failures.length > 0) {
    throw new Error(
      `rls-teardown.sql left ${failures.length} check(s) failing; the live project may hold residue:\n` +
        failures.map((f) => JSON.stringify(f)).join('\n'),
    )
  }
  console.log(`[rls-teardown] purged, ${rows.length} checks PASS`)
}
