import { supabase } from './supabase'

/**
 * The shared staff list (Feedback Rv4, 0032): one roster for every project,
 * deck and coat, so a crew's hours add up instead of scattering across "Tổ 1",
 * "To 1" and "tổ1".
 *
 * The admin writes it; every signed-in session reads it, because a foreman
 * cannot record a bay without finding his own crew in the picker. What lands
 * on the event is the NAME, not a reference here: `cell_events.lead_name` is a
 * snapshot, like `work_name`, so retiring somebody never rewrites history.
 */

export interface Employee {
  id: string
  fullName: string
  active: boolean
}

interface EmployeeRow {
  id: string
  full_name: string
  active: boolean
}

const mapEmployee = (row: EmployeeRow): Employee => ({
  id: row.id,
  fullName: row.full_name,
  active: row.active,
})

/**
 * Everyone on the roster, by name.
 *
 * `includeRetired` is the admin's screen; the foreman's picker asks for the
 * active ones only. Ordered here rather than in each caller so the two lists
 * cannot disagree about where a name sits.
 */
export async function listEmployees(includeRetired = false): Promise<Employee[]> {
  let query = supabase.from('employees').select('id, full_name, active')
  if (!includeRetired) query = query.eq('active', true)
  const { data, error } = await query.order('full_name')
  if (error) throw new Error(error.message)
  return ((data ?? []) as unknown as EmployeeRow[]).map(mapEmployee)
}

/**
 * Adds one person. The unique index is on the folded name, so a duplicate
 * comes back as a constraint violation rather than a second row; it is
 * translated here because "duplicate key value violates unique constraint
 * employees_name_key" is not a sentence to put in front of an admin.
 */
export async function createEmployee(fullName: string): Promise<string> {
  const name = fullName.trim()
  if (name === '') throw new Error('Tên nhân viên không được để trống.')
  const { data, error } = await supabase
    .from('employees')
    .insert({ full_name: name })
    .select('id')
    .single()
  if (error) {
    if (error.code === '23505') throw new Error(`Đã có nhân viên tên "${name}".`)
    throw new Error(error.message)
  }
  return (data as { id: string }).id
}

/** Renames, retires or brings back one person. Absent keys are left alone. */
export async function updateEmployee(
  id: string,
  fields: Partial<{ fullName: string; active: boolean }>,
): Promise<void> {
  const patch: Record<string, unknown> = {}
  if ('fullName' in fields) {
    const name = (fields.fullName ?? '').trim()
    if (name === '') throw new Error('Tên nhân viên không được để trống.')
    patch.full_name = name
  }
  if ('active' in fields) patch.active = fields.active
  if (Object.keys(patch).length === 0) return

  const { error } = await supabase.from('employees').update(patch).eq('id', id)
  if (error) {
    if (error.code === '23505') throw new Error(`Đã có nhân viên tên "${patch.full_name as string}".`)
    throw new Error(error.message)
  }
}
