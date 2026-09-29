import { beforeEach, describe, expect, it, vi } from 'vitest'
import { endSession } from '../../lib/sessionCache'
import {
  cachedProjectList, cachedProjectName, fieldProjectList, fieldProjectName, rememberProjectName,
} from './fieldProjects'

const listProjectNames = vi.hoisted(() => vi.fn())
vi.mock('../../lib/projectsApi', () => ({
  listProjectNames: () => listProjectNames(),
}))
const loadGsProjectIdentity = vi.hoisted(() => vi.fn())
vi.mock('../../lib/gsApi', () => ({
  loadGsProjectIdentity: (id: string) => loadGsProjectIdentity(id),
}))

const ROWS = [{ id: 'p1', name: 'Giàn A', code: 'GA' }, { id: 'p2', name: 'Giàn B', code: 'GB' }]

beforeEach(() => {
  endSession()
  listProjectNames.mockReset()
  listProjectNames.mockResolvedValue(ROWS)
  loadGsProjectIdentity.mockReset()
  loadGsProjectIdentity.mockResolvedValue({ code: 'GA', name: 'Giàn A' })
})

describe('the field\'s project names, once per session (M-1)', () => {
  it('reads the viewer\'s list once, however often it is asked for', async () => {
    expect(cachedProjectList()).toBeUndefined()
    await expect(fieldProjectList()).resolves.toEqual(ROWS)
    await fieldProjectList()
    await Promise.all([fieldProjectList(), fieldProjectList()])
    expect(listProjectNames).toHaveBeenCalledTimes(1)
    expect(cachedProjectList()).toEqual(ROWS)
  })

  it('shares one read between callers that ask at the same time', async () => {
    await Promise.all([fieldProjectList(), fieldProjectList()])
    expect(listProjectNames).toHaveBeenCalledTimes(1)
  })

  it('tries the list again after a failed read', async () => {
    listProjectNames.mockRejectedValueOnce(new Error('Failed to fetch'))
    await expect(fieldProjectList()).rejects.toThrow('Failed to fetch')
    await expect(fieldProjectList()).resolves.toEqual(ROWS)
    expect(listProjectNames).toHaveBeenCalledTimes(2)
  })

  it('knows every listed project\'s name without another read', async () => {
    await fieldProjectList()
    expect(cachedProjectName('p2')).toBe('Giàn B')
    await expect(fieldProjectName('p2')).resolves.toBe('Giàn B')
    expect(loadGsProjectIdentity).not.toHaveBeenCalled()
  })

  it('takes a name a screen already read, without a read of its own', async () => {
    rememberProjectName('p1', 'Giàn A')
    await expect(fieldProjectName('p1')).resolves.toBe('Giàn A')
    expect(loadGsProjectIdentity).not.toHaveBeenCalled()
  })

  it('reads a name it does not have once, then keeps it', async () => {
    await expect(fieldProjectName('p1')).resolves.toBe('Giàn A')
    await fieldProjectName('p1')
    expect(loadGsProjectIdentity).toHaveBeenCalledTimes(1)
    expect(cachedProjectName('p1')).toBe('Giàn A')
  })

  it('forgets everything when the session ends, so the next account reads its own', async () => {
    await fieldProjectList()
    rememberProjectName('p9', 'Giàn Z')
    endSession()
    expect(cachedProjectList()).toBeUndefined()
    expect(cachedProjectName('p9')).toBeUndefined()
    await fieldProjectList()
    expect(listProjectNames).toHaveBeenCalledTimes(2)
  })

  it('does not let a read that was in flight when the session ended land in the next one', async () => {
    let release: (rows: typeof ROWS) => void = () => {}
    listProjectNames.mockReturnValueOnce(new Promise((r) => { release = r }))
    const stale = fieldProjectList()
    endSession()
    release(ROWS)
    await stale
    expect(cachedProjectList()).toBeUndefined()
    expect(cachedProjectName('p1')).toBeUndefined()
  })
})
