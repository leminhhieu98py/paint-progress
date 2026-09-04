import { FunctionsHttpError } from '@supabase/supabase-js'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createGsUser, deactivateGsUser, hideUser, listGsUsers, reactivateUser, renameUser,
  revealPassword, setMemberships, setPassword, unhideUser,
} from './adminApi'

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

/** The PostgREST builder shape: every method chains, and awaiting resolves to
 *  `{ data, error }` -- postgrest-js reports failure as a value, never a throw. */
function builder(result: { data?: unknown; error?: unknown } = {}) {
  const b: Record<string, unknown> = {}
  for (const m of ['select', 'insert', 'upsert', 'update', 'delete', 'eq', 'in', 'order', 'limit', 'single']) {
    b[m] = vi.fn(() => b)
  }
  b.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data: result.data ?? null, error: result.error ?? null }).then(resolve)
  return b
}

/** listGsUsers reads profiles, then works. */
function listReads(profiles: unknown[], works: unknown[] = []) {
  from
    .mockImplementationOnce(() => builder({ data: profiles }))
    .mockImplementationOnce(() => builder({ data: works }))
}

describe('adminApi', () => {
  it('calls the create action and returns the new user id', async () => {
    invoke.mockResolvedValue({ data: { userId: 'u1' }, error: null })

    const id = await createGsUser({
      username: 'gs1',
      fullName: 'GS Một',
      password: 'pw',
      projectId: 'p1',
      role: 'viewer',
    })

    expect(id).toBe('u1')
    expect(invoke).toHaveBeenCalledWith('admin-users', {
      body: { action: 'create', username: 'gs1', fullName: 'GS Một', password: 'pw', projectId: 'p1', role: 'viewer' },
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

  it('maps the 0028 account actions onto the function', async () => {
    invoke.mockResolvedValue({ data: { ok: true }, error: null })
    await reactivateUser('u1')
    await renameUser('u1', 'gs.moi')
    await hideUser('u1')
    await unhideUser('u1')
    expect(invoke.mock.calls.map((c) => c[1].body)).toEqual([
      { action: 'reactivate', userId: 'u1' },
      { action: 'rename', userId: 'u1', username: 'gs.moi' },
      { action: 'hide', userId: 'u1' },
      { action: 'unhide', userId: 'u1' },
    ])
  })
})

describe('setMemberships', () => {
  const WORKS = [
    { id: 'w1', project_id: 'p1' }, { id: 'w2', project_id: 'p1' }, { id: 'w3', project_id: 'p2' },
  ]

  it('upserts the memberships and grants exactly the listed works of a restricted project', async () => {
    const pmUpsert = builder()
    const wmInsert = builder()
    from
      .mockImplementationOnce(() => builder({ data: WORKS }))            // works
      .mockImplementationOnce(() => builder({ data: [] }))               // current memberships
      .mockImplementationOnce(() => pmUpsert)                            // upsert memberships
      .mockImplementationOnce(() => builder({ data: [] }))               // held grants
      .mockImplementationOnce(() => wmInsert)                            // insert grants

    await setMemberships('u1', [
      { projectId: 'p1', allWorks: false, workIds: ['w1', 'w3'] },   // w3 is p2's: dropped
      { projectId: 'p2', allWorks: true, workIds: ['w3'] },          // all works: no grant rows
    ])

    expect(pmUpsert.upsert).toHaveBeenCalledWith(
      [
        { project_id: 'p1', user_id: 'u1', all_works: false },
        { project_id: 'p2', user_id: 'u1', all_works: true },
      ],
      { onConflict: 'project_id,user_id' },
    )
    expect(wmInsert.insert).toHaveBeenCalledWith([{ work_id: 'w1', user_id: 'u1' }])
  })

  it('removes a project the account is no longer in, with its work grants', async () => {
    const pmDelete = builder()
    const wmDeleteOrphans = builder()
    const wmDeleteStale = builder()
    from
      .mockImplementationOnce(() => builder({ data: WORKS }))
      .mockImplementationOnce(() => builder({ data: [{ project_id: 'p1' }, { project_id: 'p2' }] }))
      .mockImplementationOnce(() => pmDelete)
      .mockImplementationOnce(() => wmDeleteOrphans)
      .mockImplementationOnce(() => builder())                           // upsert p1
      .mockImplementationOnce(() => builder({ data: [{ work_id: 'w1' }] })) // held: w1 stale now
      .mockImplementationOnce(() => wmDeleteStale)

    await setMemberships('u1', [{ projectId: 'p1', allWorks: true, workIds: [] }])

    expect(pmDelete.delete).toHaveBeenCalled()
    expect(pmDelete.in).toHaveBeenCalledWith('project_id', ['p2'])
    expect(wmDeleteOrphans.in).toHaveBeenCalledWith('work_id', ['w3'])
    expect(wmDeleteStale.in).toHaveBeenCalledWith('work_id', ['w1'])
    expect(from).toHaveBeenCalledTimes(7)
  })
})

describe('listGsUsers', () => {
  it('returns every project a GS can reach, with its work scope', async () => {
    // project_members is many-to-many and always was; the mapper took [0] and
    // threw the rest away, so an account added to a second platform still
    // looked single-project on the only screen that shows it.
    listReads(
      [
        {
          id: 'u1', username: 'gs1', full_name: 'GS Một', active: true, role: 'gs', hidden: false,
          project_members: [
            { project_id: 'p1', all_works: true, projects: { name: 'Bạch Hổ BH-7' } },
            { project_id: 'p2', all_works: false, projects: { name: 'Rạng Đông RD-2' } },
          ],
          work_members: [{ work_id: 'w3' }],
        },
      ],
      [{ id: 'w1', project_id: 'p1' }, { id: 'w3', project_id: 'p2' }, { id: 'w4', project_id: 'p2' }],
    )

    const users = await listGsUsers()

    expect(from).toHaveBeenCalledWith('profiles')
    expect(users).toEqual([
      {
        id: 'u1', username: 'gs1', fullName: 'GS Một', active: true, role: 'gs', hidden: false,
        projects: [
          { id: 'p1', name: 'Bạch Hổ BH-7', allWorks: true, workIds: [], workCount: 1 },
          { id: 'p2', name: 'Rạng Đông RD-2', allWorks: false, workIds: ['w3'], workCount: 2 },
        ],
      },
    ])
  })

  it('leaves hidden accounts out unless asked, and asks the database, not the client', async () => {
    listReads([])
    await listGsUsers()
    const profiles = from.mock.results[0].value as { eq: ReturnType<typeof vi.fn>; in: ReturnType<typeof vi.fn> }
    expect(profiles.in).toHaveBeenCalledWith('role', ['gs', 'viewer'])
    expect(profiles.eq).toHaveBeenCalledWith('hidden', false)

    from.mockReset()
    listReads([])
    await listGsUsers(true)
    const all = from.mock.results[0].value as { eq: ReturnType<typeof vi.fn> }
    expect(all.eq).not.toHaveBeenCalled()
  })

  it('yields an empty list for a GS with no membership, rather than throwing', async () => {
    listReads([
      { id: 'u2', username: 'gs2', full_name: 'GS Hai', active: true, role: 'gs', hidden: false, project_members: [], work_members: [] },
    ])

    await expect(listGsUsers()).resolves.toEqual([
      { id: 'u2', username: 'gs2', fullName: 'GS Hai', active: true, role: 'gs', hidden: false, projects: [] },
    ])
  })

  it('drops a membership whose project row did not come back', async () => {
    // The embed is nullable: a project deleted between the two halves of the
    // read leaves { project_id, projects: null }. A chip labelled "undefined"
    // is worse than one fewer chip.
    listReads([
      {
        id: 'u3', username: 'gs3', full_name: 'GS Ba', active: false, role: 'viewer', hidden: true,
        project_members: [
          { project_id: 'p1', all_works: true, projects: null },
          { project_id: 'p2', all_works: true, projects: { name: 'Rạng Đông RD-2' } },
        ],
        work_members: [],
      },
    ])

    const [user] = await listGsUsers(true)
    expect(user.projects).toEqual([{ id: 'p2', name: 'Rạng Đông RD-2', allWorks: true, workIds: [], workCount: 0 }])
    expect(user.role).toBe('viewer')
    expect(user.hidden).toBe(true)
  })
})
