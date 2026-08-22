import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createGsUser, revealPassword } from './adminApi'

// vi.mock factories are hoisted above the whole file, so a plain `const invoke =
// vi.fn()` here would still be in its temporal dead zone when the factory below
// runs. vi.hoisted() hoists the declaration itself alongside the mock call.
const invoke = vi.hoisted(() => vi.fn())

vi.mock('./supabase', () => ({
  supabase: { functions: { invoke } },
}))

beforeEach(() => invoke.mockReset())

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

  it('returns the revealed password', async () => {
    invoke.mockResolvedValue({ data: { password: 's3cret' }, error: null })
    await expect(revealPassword('u1')).resolves.toBe('s3cret')
  })
})
