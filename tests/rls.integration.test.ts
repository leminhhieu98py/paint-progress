import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { beforeAll, describe, expect, it } from 'vitest'
import { toAuthEmail } from '../src/config'

const url = process.env.VITE_SUPABASE_URL
const anon = process.env.VITE_SUPABASE_ANON_KEY
const username = process.env.RLS_TEST_GS_USERNAME
const password = process.env.RLS_TEST_GS_PASSWORD

const configured = Boolean(url && anon && username && password)

describe.skipIf(!configured)('RLS as a GS session', () => {
  let gs: SupabaseClient

  beforeAll(async () => {
    gs = createClient(url!, anon!, { auth: { persistSession: false } })
    const { error } = await gs.auth.signInWithPassword({
      email: toAuthEmail(username!),
      password: password!,
    })
    expect(error).toBeNull()
  })

  it('sees only the project it is a member of', async () => {
    const { data } = await gs.from('projects').select('code')
    expect(data?.map((p) => p.code)).toEqual(['RLSA'])
  })

  it('sees only the decks of that project', async () => {
    const { data } = await gs.from('decks').select('code')
    expect(data?.map((d) => d.code)).toEqual(['AD'])
  })

  it('cannot read gs_credentials at all', async () => {
    const { data, error } = await gs.from('gs_credentials').select('user_id')
    // RLS with no policy returns an empty set rather than an error
    expect(error?.code ?? null).not.toBe('PGRST301')
    expect(data ?? []).toEqual([])
  })

  it('cannot read the credential access log', async () => {
    const { data } = await gs.from('credential_access_log').select('id')
    expect(data ?? []).toEqual([])
  })

  it('can advance the stage of a cell in its own project', async () => {
    const { data: stage } = await gs.from('project_stages').select('id').single()
    const { data: cell } = await gs.from('cells').select('id').single()
    const { error } = await gs
      .from('cells')
      .update({ stage_id: stage!.id })
      .eq('id', cell!.id)
    expect(error).toBeNull()
  })

  it('cannot change a cell geometry column', async () => {
    const { data: cell } = await gs.from('cells').select('id').single()
    const { error } = await gs.from('cells').update({ area_m2: 1 }).eq('id', cell!.id)
    expect(error).not.toBeNull()
  })

  it('cannot create a project', async () => {
    const { error } = await gs.from('projects').insert({ name: 'X', code: 'XXX' })
    expect(error).not.toBeNull()
  })

  it('cannot read another user profile', async () => {
    const { data } = await gs.from('profiles').select('username')
    expect(data?.map((p) => p.username)).toEqual(['rlstest-gs'])
  })
})
