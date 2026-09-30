import { beforeEach, describe, expect, it, vi } from 'vitest'
import { endSession } from '../../lib/sessionCache'
import {
  cachedProjectCode, cachedProjectList, cachedProjectName, fieldProjectList, projectListFor,
  rememberProjectName, seedProjectList,
} from './fieldProjects'

const listProjectNames = vi.hoisted(() => vi.fn())
vi.mock('../../lib/projectsApi', () => ({
  listProjectNames: () => listProjectNames(),
}))

const ROWS = [{ id: 'p1', name: 'Giàn A', code: 'GA' }, { id: 'p2', name: 'Giàn B', code: 'GB' }]

beforeEach(() => {
  endSession()
  listProjectNames.mockReset()
  listProjectNames.mockResolvedValue(ROWS)
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
  })

  it('takes a name a screen already read, without a read of its own', () => {
    rememberProjectName('p1', 'Giàn A')
    expect(cachedProjectName('p1')).toBe('Giàn A')
    expect(listProjectNames).not.toHaveBeenCalled()
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

describe('keeping the viewer\'s list fresh (M-1b)', () => {
  it('takes the picker\'s fresh read as the list, with no read of its own', async () => {
    seedProjectList([{ id: 'p9', name: 'Giàn mới', code: 'GM' }])
    expect(cachedProjectList()).toEqual([{ id: 'p9', name: 'Giàn mới', code: 'GM' }])
    expect(cachedProjectName('p9')).toBe('Giàn mới')
    await fieldProjectList()
    expect(listProjectNames).not.toHaveBeenCalled()
  })

  it('answers from the cache when it holds the project on screen', async () => {
    await fieldProjectList()
    await expect(projectListFor('p2')).resolves.toEqual(ROWS)
    expect(listProjectNames).toHaveBeenCalledTimes(1)
  })

  it('re-reads once when the project on screen is not in the cache, then stops asking', async () => {
    await fieldProjectList()
    const fresh = [...ROWS, { id: 'p9', name: 'Giàn mới', code: 'GM' }]
    listProjectNames.mockResolvedValue(fresh)
    await expect(projectListFor('p9')).resolves.toEqual(fresh)
    expect(cachedProjectName('p9')).toBe('Giàn mới')
    expect(listProjectNames).toHaveBeenCalledTimes(2)

    // An id the fresh list does not have either (deleted, mistyped): one
    // refresh per session, not one per mount.
    await projectListFor('gone')
    await projectListFor('gone')
    expect(listProjectNames).toHaveBeenCalledTimes(3)
  })

  it('reads once, not twice, when nothing is cached yet', async () => {
    await projectListFor('p1')
    expect(listProjectNames).toHaveBeenCalledTimes(1)
  })
})

describe('a project\'s code, for the phone\'s one-line summary (M2)', () => {
  it('is unknown until the list is read, then the list\'s code', async () => {
    rememberProjectName('p2', 'Giàn B')
    expect(cachedProjectCode('p2')).toBeUndefined()
    await fieldProjectList()
    expect(cachedProjectCode('p2')).toBe('GB')
    expect(cachedProjectCode('gone')).toBeUndefined()
  })
})
