import { FunctionsHttpError } from '@supabase/supabase-js'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createGsUser, deactivateGsUser, listGsUsers, revealPassword, setPassword } from './adminApi'

// vi.mock factories are hoisted above the whole file, so a plain `const invoke =
// vi.fn()` here would still be in its temporal dead zone when the factory below
// runs. vi.hoisted() hoists the declaration itself alongside the mock call.
const invoke = vi.hoisted(() => vi.fn())
const from = vi.hoisted(() => vi.fn())

vi.mock('./supabase', () => ({
  supabase: { functions: { invoke }, from },
}))

beforeEach(() => {
  invoke.mockReset()
  from.mockReset()
})

/** Minimal PostgREST builder stub matching listGsUsers' own chain shape. */
function selectChain(result: { data?: unknown; error?: unknown }) {
  return {
    select: () => ({
      eq: () => ({
        order: () => Promise.resolve({ data: result.data ?? null, error: result.error ?? null }),
      }),
    }),
  }
}

describe('adminApi', () => {
  it('calls the create action and returns the new user id', async () => {
    invoke.mockResolvedValue({ data: { userId: 'u1' }, error: null })

    const id = await createGsUser({
      username: 'gs1',
      fullName: 'GS Một',
      password: 'pw',
      projectId: 'p1',
    })

    expect(id).toBe('u1')
    expect(invoke).toHaveBeenCalledWith('admin-users', {
      body: { action: 'create', username: 'gs1', fullName: 'GS Một', password: 'pw', projectId: 'p1' },
    })
  })

  it('surfaces a function-level error as a thrown Error', async () => {
    invoke.mockResolvedValue({ data: null, error: { message: 'boom' } })
    await expect(revealPassword('u1')).rejects.toThrow('boom')
  })

  it('surfaces an application error returned in the body', async () => {
    invoke.mockResolvedValue({ data: { error: 'No stored credential' }, error: null })
    await expect(revealPassword('u1')).rejects.toThrow('No stored credential')
  })

  // supabase-js converts any non-2xx invoke response into a FunctionsHttpError
  // whose own `.message` is a generic "non-2xx status code" -- the function's
  // real `{ error: string }` body only lives on `.context`, the raw Response.
  it('reads the real error message out of a FunctionsHttpError context', async () => {
    const context = new Response(JSON.stringify({ error: 'No stored credential' }), { status: 404 })
    invoke.mockResolvedValue({ data: null, error: new FunctionsHttpError(context) })
    await expect(revealPassword('u1')).rejects.toThrow('No stored credential')
  })

  it('falls back to the generic message when the context body is not usable JSON', async () => {
    const context = new Response('not json', { status: 500 })
    const error = new FunctionsHttpError(context)
    invoke.mockResolvedValue({ data: null, error })
    await expect(revealPassword('u1')).rejects.toThrow(error.message)
  })

  it('returns the revealed password', async () => {
    invoke.mockResolvedValue({ data: { password: 's3cret' }, error: null })
    await expect(revealPassword('u1')).resolves.toBe('s3cret')
  })

  it('calls the set-password action with the user id and new password', async () => {
    invoke.mockResolvedValue({ data: { ok: true }, error: null })
    await setPassword('u1', 'newpw')
    expect(invoke).toHaveBeenCalledWith('admin-users', {
      body: { action: 'set-password', userId: 'u1', password: 'newpw' },
    })
  })

  it('calls the deactivate action with the user id', async () => {
    invoke.mockResolvedValue({ data: { ok: true }, error: null })
    await deactivateGsUser('u1')
    expect(invoke).toHaveBeenCalledWith('admin-users', {
      body: { action: 'deactivate', userId: 'u1' },
    })
  })
})

describe('listGsUsers', () => {
  it('maps the nested project_members(project_id, projects(name)) embed to projectId/projectName', async () => {
    from.mockReturnValue(
      selectChain({
        data: [
          {
            id: 'u1',
            username: 'gs1',
            full_name: 'GS Một',
            active: true,
            project_members: [{ project_id: 'p1', projects: { name: 'BB1' } }],
          },
        ],
      }),
    )

    const users = await listGsUsers()

    expect(from).toHaveBeenCalledWith('profiles')
    expect(users).toEqual([
      { id: 'u1', username: 'gs1', fullName: 'GS Một', active: true, projectId: 'p1', projectName: 'BB1' },
    ])
  })

  it('yields null for both projectId and projectName when a GS has no membership, rather than throwing', async () => {
    from.mockReturnValue(
      selectChain({
        data: [
          { id: 'u2', username: 'gs2', full_name: 'GS Hai', active: true, project_members: [] },
        ],
      }),
    )

    const users = await listGsUsers()

    expect(users).toEqual([
      { id: 'u2', username: 'gs2', fullName: 'GS Hai', active: true, projectId: null, projectName: null },
    ])
  })
})
