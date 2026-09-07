import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createEmployee, listEmployees, updateEmployee } from './employeesApi'

const from = vi.hoisted(() => vi.fn())
vi.mock('./supabase', () => ({ supabase: { from } }))

/** The PostgREST builder shape: every method chains, awaiting resolves. */
function builder(result: { data?: unknown; error?: unknown }) {
  const b: Record<string, unknown> = {}
  for (const m of ['select', 'insert', 'update', 'eq', 'order', 'single']) b[m] = vi.fn(() => b)
  b.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data: result.data ?? null, error: result.error ?? null }).then(resolve)
  return b
}

const ROWS = [
  { id: 'e1', full_name: 'Lê Văn A', active: true },
  { id: 'e2', full_name: 'Trần Thị B', active: false },
]

beforeEach(() => {
  from.mockReset()
})

describe('listEmployees', () => {
  it('offers only the people still on the crew, by name', async () => {
    const b = builder({ data: [ROWS[0]] })
    from.mockReturnValue(b)

    const rows = await listEmployees()

    expect(from).toHaveBeenCalledWith('employees')
    expect(b.eq).toHaveBeenCalledWith('active', true)
    expect(b.order).toHaveBeenCalledWith('full_name')
    expect(rows).toEqual([{ id: 'e1', fullName: 'Lê Văn A', active: true }])
  })

  it('includes the retired ones for the admin\'s own screen', async () => {
    const b = builder({ data: ROWS })
    from.mockReturnValue(b)

    const rows = await listEmployees(true)

    expect(b.eq).not.toHaveBeenCalled()
    expect(rows.map((r) => r.active)).toEqual([true, false])
  })

  it('reports a failed read rather than an empty roster', async () => {
    from.mockReturnValue(builder({ error: { message: 'mất kết nối' } }))
    await expect(listEmployees()).rejects.toThrow('mất kết nối')
  })
})

describe('createEmployee', () => {
  it('trims the name and returns the new id', async () => {
    const b = builder({ data: { id: 'e9' } })
    from.mockReturnValue(b)

    expect(await createEmployee('  Nguyễn Văn C ')).toBe('e9')
    expect(b.insert).toHaveBeenCalledWith({ full_name: 'Nguyễn Văn C' })
  })

  it('refuses a blank name without asking the server', async () => {
    await expect(createEmployee('   ')).rejects.toThrow('không được để trống')
    expect(from).not.toHaveBeenCalled()
  })

  it('says who the duplicate is, not what the constraint is called', async () => {
    from.mockReturnValue(builder({ error: { code: '23505', message: 'duplicate key value violates unique constraint "employees_name_key"' } }))
    await expect(createEmployee('Lê Văn A')).rejects.toThrow('Đã có nhân viên tên "Lê Văn A".')
  })
})

describe('updateEmployee', () => {
  it('renames', async () => {
    const b = builder({})
    from.mockReturnValue(b)

    await updateEmployee('e1', { fullName: ' Lê Văn A2 ' })

    expect(b.update).toHaveBeenCalledWith({ full_name: 'Lê Văn A2' })
    expect(b.eq).toHaveBeenCalledWith('id', 'e1')
  })

  it('retires and brings back', async () => {
    const b = builder({})
    from.mockReturnValue(b)

    await updateEmployee('e1', { active: false })

    expect(b.update).toHaveBeenCalledWith({ active: false })
  })

  it('writes nothing when nothing was asked for', async () => {
    await updateEmployee('e1', {})
    expect(from).not.toHaveBeenCalled()
  })

  it('refuses a blank rename', async () => {
    await expect(updateEmployee('e1', { fullName: ' ' })).rejects.toThrow('không được để trống')
  })
})
