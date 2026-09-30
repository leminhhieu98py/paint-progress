import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderApp } from '../../test/renderApp'
import { palette } from '../../theme'
import { NhanLucScreen } from './NhanLucScreen'
import { expectLeft } from '../../test/alignment'
import { weightOf } from '../../test/typography'
import { consequenceItems, expectHelperText, expectNoSpecIds, keyFactTexts, pageSubtitle, ruleTexts } from '../../test/copy'
import { chooseOption, optionTitles } from '../../test/select'

const listGsUsers = vi.fn()
const revealPassword = vi.fn()
const setPassword = vi.fn()
const deactivateGsUser = vi.fn()
const createGsUser = vi.fn()
const reactivateUser = vi.fn()
const renameUser = vi.fn()
const renameAccount = vi.fn()
const hideUser = vi.fn()
const unhideUser = vi.fn()
const setMemberships = vi.fn()
const changeRole = vi.fn()
const listProjectNames = vi.fn()
const listWorks = vi.fn()
const listEmployees = vi.fn()
const createEmployee = vi.fn()
const updateEmployee = vi.fn()
const buildEmployeesXlsx = vi.fn()
const downloadWorkbook = vi.fn()

vi.mock('../../lib/adminApi', () => ({
  listGsUsers: (includeHidden?: boolean) => listGsUsers(includeHidden),
  revealPassword: (id: string) => revealPassword(id),
  createGsUser: (input: unknown) => createGsUser(input),
  setPassword: (id: string, pw: string) => setPassword(id, pw),
  deactivateGsUser: (id: string) => deactivateGsUser(id),
  reactivateUser: (id: string) => reactivateUser(id),
  renameUser: (id: string, name: string) => renameUser(id, name),
  renameAccount: (id: string, name: string) => renameAccount(id, name),
  hideUser: (id: string) => hideUser(id),
  unhideUser: (id: string) => unhideUser(id),
  setMemberships: (id: string, rows: unknown) => setMemberships(id, rows),
  changeRole: (input: unknown) => changeRole(input),
}))

vi.mock('../../lib/employeesApi', () => ({
  listEmployees: (includeRetired: boolean) => listEmployees(includeRetired),
  createEmployee: (name: string) => createEmployee(name),
  updateEmployee: (id: string, fields: unknown) => updateEmployee(id, fields),
}))

vi.mock('../../lib/employeesXlsx', () => ({
  buildEmployeesXlsx: (rows: unknown) => buildEmployeesXlsx(rows),
  employeesFileName: (today: string) => `nhan-vien-${today}.xlsx`,
}))

vi.mock('../../lib/projectReport', () => ({
  downloadWorkbook: (blob: unknown, name: string) => downloadWorkbook(blob, name),
}))

vi.mock('../../lib/projectsApi', () => ({
  listProjectNames: () => listProjectNames(),
}))

vi.mock('../../lib/worksApi', () => ({
  listWorks: (projectId: string) => listWorks(projectId),
}))

vi.mock('../../auth/AuthProvider', () => ({
  useAuth: () => ({
    profile: { id: 'a1', username: 'admin.linh', fullName: 'Nguyễn Thị Linh', role: 'admin', active: true },
  }),
}))

/** A membership as listGsUsers returns it since 0028: every work, unless said otherwise. */
const member = (id: string, name: string, over: Partial<{ allWorks: boolean; workIds: string[]; workCount: number }> = {}) =>
  ({ id, name, allWorks: true, workIds: [], workCount: 2, ...over })

const account = (over: Record<string, unknown>) => ({
  id: 'u7', username: 'gs1', fullName: 'GS Một', active: true, role: 'gs', hidden: false, projects: [], ...over,
})

// Ids deliberately do not coincide with the rows' positions: per-row state
// keyed by index instead of id would show up here.
const ACCOUNTS = [
  account({ id: 'u7', username: 'gs1', fullName: 'GS Một', role: 'gs', projects: [member('p1', 'BB1')] }),
  account({ id: 'u9', username: 'gs2', fullName: 'GS Hai', role: 'viewer', projects: [member('p2', 'BB2')] }),
]
const EMPLOYEES = [
  { id: 'e1', fullName: 'Lê Văn A', active: true },
  { id: 'e2', fullName: 'Trần Thị B', active: false },
]
const PROJECTS = [{ id: 'p1', name: 'BB1', code: 'BB1' }, { id: 'p2', name: 'BB2', code: 'BB2' }]

const renderScreen = () => renderApp(<NhanLucScreen />)
/** The table row of the person with this name. */
const rowOf = (name: string) =>
  screen.getAllByText(name).map((el) => el.closest('tr.ant-table-row')).find(Boolean) as HTMLElement
/** The row's Sửa dialog (NL-09), open. */
const openEdit = async (name: string) => {
  await userEvent.click(within(rowOf(name)).getByRole('button', { name: 'Sửa' }))
  return screen.findByRole('dialog', { name: `Sửa · ${name}` })
}
const bar = () => screen.getByRole('search', { name: 'Bộ lọc' })
const search = () => within(bar()).getByRole('textbox', { name: 'Tìm nhân lực' })
const apply = () => userEvent.click(within(bar()).getByRole('button', { name: /Tìm/ }))
/** The names on screen, in order. */
const shownNames = () =>
  [...document.querySelectorAll('.ant-table-tbody .ant-table-row')].map((tr) => tr.querySelector('td div > div')?.textContent)
/** The validation messages a form shows, in order. */
const errorsIn = (root: HTMLElement) =>
  [...root.querySelectorAll('.ant-form-item-explain-error')].map((e) => e.textContent)

beforeEach(() => {
  for (const m of [
    listGsUsers, revealPassword, setPassword, deactivateGsUser, createGsUser, reactivateUser, renameUser, renameAccount,
    hideUser, unhideUser, setMemberships, changeRole, listProjectNames, listWorks, listEmployees,
    createEmployee, updateEmployee, buildEmployeesXlsx, downloadWorkbook,
  ]) {
    m.mockReset()
    m.mockResolvedValue(undefined)
  }
  listGsUsers.mockResolvedValue(ACCOUNTS)
  listEmployees.mockResolvedValue(EMPLOYEES)
  listProjectNames.mockResolvedValue([])
  listWorks.mockResolvedValue([])
  createGsUser.mockResolvedValue('u-new')
  createEmployee.mockResolvedValue('e9')
  buildEmployeesXlsx.mockResolvedValue(new Blob(['x']))
})

describe('NhanLucScreen — one list (NL-01)', () => {
  it('lists accounts and employees together, by name, with hidden accounts and retired employees behind the filter', async () => {
    renderScreen()
    expect(await screen.findByRole('heading', { level: 1, name: 'Nhân lực' })).toBeInTheDocument()
    await screen.findByText('gs1')
    expect(listGsUsers).toHaveBeenCalledWith(true)
    expect(listEmployees).toHaveBeenCalledWith(true)
    expect(shownNames()).toEqual(['GS Một', 'GS Hai', 'Lê Văn A'])
    expect(screen.queryByText('Trần Thị B')).toBeNull()
  })

  it('counts what is on screen beside the title as KeyFacts, with no subtitle line (HLT-01)', async () => {
    listEmployees.mockReturnValue(new Promise(() => {}))
    const { unmount } = renderScreen()
    // Nothing yet, and no line held under the title: the facts sit on its line.
    expect(keyFactTexts()).toEqual([])
    expect(pageSubtitle()).toBeNull()
    unmount()

    listEmployees.mockResolvedValue(EMPLOYEES)
    renderScreen()
    await screen.findByText('gs1')
    const titleLine = screen.getByRole('heading', { level: 1, name: 'Nhân lực' }).parentElement as HTMLElement
    expect(keyFactTexts(titleLine)).toEqual(['2 tài khoản', '1 nhân viên'])
    expect(pageSubtitle()).toBeNull()
  })

  it('names each row\'s Phân quyền, and puts "-" where an employee has no data', async () => {
    renderScreen()
    await screen.findByText('gs1')
    expect(within(rowOf('GS Một')).getByText('GS')).toBeInTheDocument()
    expect(within(rowOf('GS Một')).queryByRole('button', { name: 'Phân quyền' })).toBeNull()
    expect(within(rowOf('GS Hai')).getByText('Visitor')).toBeInTheDocument()
    const employee = rowOf('Lê Văn A')
    expect(within(employee).getByText('Nhân viên')).toBeInTheDocument()
    // The badge says what the role means, in the dialogs' own words (NL-01 amendment).
    await userEvent.hover(within(rowOf('GS Một')).getByText('GS'))
    expect(await screen.findByRole('tooltip')).toHaveTextContent('GS đăng nhập trên máy tính bảng và ghi tiến độ ở các dự án được gán.')
    expect(within(employee).getAllByText('-')).toHaveLength(2)
    expect(within(employee).getByText('Đang làm')).toBeInTheDocument()
  })

  it('shows either read failing as an error with a retry', async () => {
    listEmployees.mockRejectedValueOnce(new Error('mất kết nối'))
    renderScreen()
    expect(await screen.findByText('mất kết nối')).toBeInTheDocument()
    expect(screen.getByText('Không tải được danh sách nhân lực')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Thử lại' }))
    expect(await screen.findByText('Lê Văn A')).toBeInTheDocument()
  })

  it('shows a failed account read too', async () => {
    listGsUsers.mockRejectedValueOnce(new Error('hết hạn phiên'))
    renderScreen()
    expect(await screen.findByText('hết hạn phiên')).toBeInTheDocument()
  })

  it('lists the columns in order, the actions pinned right on a sideways-scrolling table', async () => {
    renderScreen()
    await screen.findByText('gs1')
    expect(screen.getAllByRole('columnheader').map((th) => th.textContent))
      .toEqual(['Họ tên', 'Tên đăng nhập', 'Phân quyền', 'Dự án', 'Trạng thái', 'Thao tác'])
    const actions = screen.getByRole('columnheader', { name: 'Thao tác' })
    expect(actions).toHaveClass('ant-table-cell-fix-right')
    expect(actions.closest('table')).toHaveStyle({ width: 'max-content' })
  })

  it('keeps typed text left and centres everything else, header included (UI-03, UI-06)', async () => {
    renderScreen()
    await screen.findByText('GS Một')
    const th = (label: string) => screen.getByRole('columnheader', { name: label })
    for (const label of ['Họ tên', 'Tên đăng nhập', 'Dự án']) expectLeft(th(label))
    expectLeft(screen.getByText('gs1').closest('td'))
    expectLeft(screen.getByText('Lê Văn A').closest('td'))
    for (const label of ['Phân quyền', 'Trạng thái', 'Thao tác']) {
      expect(th(label)).toHaveStyle({ textAlign: 'center' })
    }
    expect(screen.getAllByText('Đang dùng')[0].closest('td')).toHaveStyle({ textAlign: 'center' })
    expect(within(rowOf('Lê Văn A')).getByRole('button', { name: 'Sửa' }).closest('td')).toHaveStyle({ textAlign: 'center' })
  })

  it('sets the person\'s name as body text: the row is not a heading (TYP-02)', async () => {
    renderScreen()
    const name = await screen.findByText('GS Một')
    expect(weightOf(name)).toBe(400)
    expect(name).toHaveStyle({ fontSize: '13px' })
  })

  it('sets an active account\'s projects in the text colour of every other name (AD5, UI-06)', async () => {
    renderScreen()
    await screen.findByText('GS Một')
    expect(within(rowOf('GS Một')).getByText('BB1')).toHaveStyle({ color: palette.text })
  })

  it('gives the project list a fixed 280 px column, so a long list wraps (UI-06)', async () => {
    renderScreen()
    await screen.findByText('GS Một')
    const header = screen.getByRole('columnheader', { name: 'Dự án' })
    const index = [...(header.parentElement as HTMLElement).children].indexOf(header)
    const col = header.closest('table')?.querySelectorAll('colgroup col')[index] as HTMLElement
    expect(col).toHaveStyle({ width: '280px' })
  })
})

describe('NhanLucScreen — filter bar (FLT-01, FLT-02, FLT-08)', () => {
  it('holds a search, Phân quyền and Trạng thái, with Đặt lại and Tìm, under the title', async () => {
    renderScreen()
    await screen.findByText('gs1')
    // Short enough to read whole in its 260 px (M18).
    expect(search()).toHaveAttribute('placeholder', 'Tìm tên, tên đăng nhập')
    expect(within(bar()).getByRole('combobox', { name: 'Phân quyền' })).toBeInTheDocument()
    expect(within(bar()).getByRole('combobox', { name: 'Trạng thái' })).toBeInTheDocument()
    expect(within(bar()).getByRole('button', { name: 'Đặt lại' })).toBeInTheDocument()
    expect(within(bar()).queryByRole('button', { name: /Thêm nhân lực|Xuất danh sách/ })).toBeNull()
    expect(await optionTitles('Phân quyền', bar())).toEqual(['Tất cả phân quyền', 'Nhân viên', 'GS', 'Visitor'])
    expect(await optionTitles('Trạng thái', bar()))
      .toEqual(['Trừ đã ẩn, đã nghỉ', 'Tất cả trạng thái', 'Đang dùng', 'Đang làm', 'Đã khoá', 'Đã nghỉ', 'Đã ẩn'])
  })

  it('applies a typed search only on Tìm, then counts the match against the whole list', async () => {
    renderScreen()
    await screen.findByText('gs1')
    await userEvent.type(search(), 'le van')
    expect(shownNames()).toHaveLength(3)
    await apply()
    expect(shownNames()).toEqual(['Lê Văn A'])
    expect(keyFactTexts()).toEqual(['1/4 dòng khớp bộ lọc'])
  })

  it('applies on Enter in the search box, and matches the login as well as the name', async () => {
    renderScreen()
    await screen.findByText('gs1')
    await userEvent.type(search(), 'GS2{Enter}')
    expect(shownNames()).toEqual(['GS Hai'])
  })

  it('reaches a name behind đ, ignoring case and tones', async () => {
    listEmployees.mockResolvedValue([{ id: 'e3', fullName: 'MC005594 - Đoàn Công Linh', active: true }])
    renderScreen()
    await screen.findByText('gs1')
    await userEvent.type(search(), 'doan cong{Enter}')
    expect(shownNames()).toEqual(['MC005594 - Đoàn Công Linh'])
    // The roster stores the code and the name as one string: the code matches too.
    await userEvent.clear(search())
    await userEvent.type(search(), '005594{Enter}')
    expect(shownNames()).toEqual(['MC005594 - Đoàn Công Linh'])
  })

  it('narrows by Phân quyền and finds retired employees and hidden accounts by Trạng thái', async () => {
    listGsUsers.mockResolvedValue([...ACCOUNTS, account({ id: 'u5', username: 'cu', fullName: 'Cũ Ẩn', active: false, hidden: true })])
    renderScreen()
    await screen.findByText('gs1')
    await chooseOption('Phân quyền', 'Nhân viên', bar())
    await apply()
    expect(shownNames()).toEqual(['Lê Văn A'])

    await chooseOption('Phân quyền', 'Tất cả phân quyền', bar())
    await chooseOption('Trạng thái', 'Đã nghỉ', bar())
    await apply()
    expect(shownNames()).toEqual(['Trần Thị B'])
    expect(within(rowOf('Trần Thị B')).getByText('Đã nghỉ')).toBeInTheDocument()

    await chooseOption('Trạng thái', 'Đã ẩn', bar())
    await apply()
    expect(shownNames()).toEqual(['Cũ Ẩn'])

    await userEvent.click(within(bar()).getByRole('button', { name: 'Đặt lại' }))
    expect(shownNames()).toEqual(['GS Một', 'GS Hai', 'Lê Văn A'])
  })

  it('says when the filter matches nobody, rather than looking like an empty list', async () => {
    renderScreen()
    await screen.findByText('gs1')
    await userEvent.type(search(), 'zzz{Enter}')
    expect(screen.getByText('Không có dòng nào khớp bộ lọc')).toBeInTheDocument()
  })

  it('tells the admin an empty list blocks the foreman', async () => {
    listGsUsers.mockResolvedValue([])
    listEmployees.mockResolvedValue([])
    renderScreen()
    expect(await screen.findByText('Chưa có ai trong danh sách. Thêm nhân viên để GS ghi được tiến độ.')).toBeInTheDocument()
  })
})

describe('NhanLucScreen — pagination (UI-05, UI-06)', () => {
  it('shows no pager under a short list', async () => {
    renderScreen()
    await screen.findByText('GS Một')
    expect(document.querySelector('.ant-pagination')).toBeNull()
  })

  it('pages ten at a time from the eleventh row, with a size changer', async () => {
    listGsUsers.mockResolvedValue(Array.from({ length: 11 }, (_, i) => account({
      id: `u${i + 20}`, username: `gs${i + 20}`, fullName: `GS ${i + 20}`, projects: [member('p1', 'BB1')],
    })))
    listEmployees.mockResolvedValue([])
    renderScreen()
    await screen.findByText('GS 20')
    expect(document.querySelectorAll('.ant-table-tbody .ant-table-row')).toHaveLength(10)
    expect(screen.queryByText('GS 30')).not.toBeInTheDocument()
    expect(document.querySelector('.ant-pagination-options')).not.toBeNull()
  })

  it('goes back to page 1 when a filter is applied, so the first matches are not hidden', async () => {
    listGsUsers.mockResolvedValue([])
    listEmployees.mockResolvedValue(Array.from({ length: 30 }, (_, i) => ({
      id: `e${i}`, fullName: `NV${String(i).padStart(2, '0')} - ${i < 12 ? 'Cao Minh Hải' : 'Trần Văn Bình'}`, active: true,
    })))
    renderScreen()
    await screen.findByText('NV00 - Cao Minh Hải')
    await userEvent.click(screen.getByTitle('3'))
    expect(await screen.findByText('NV20 - Trần Văn Bình')).toBeInTheDocument()

    await userEvent.type(search(), 'hai{Enter}')
    await waitFor(() => expect(shownNames()[0]).toBe('NV00 - Cao Minh Hải'))
    expect(shownNames()).toHaveLength(10)
    expect(screen.getByTitle('1')).toHaveClass('ant-pagination-item-active')
  })
})

describe('NhanLucScreen — accounts, as before (USR)', () => {
  it('lists every project a GS covers as plain text, the whole list, no chips (UI-06)', async () => {
    listGsUsers.mockResolvedValue([account({
      projects: [member('p1', 'Bạch Hổ BH-7'), member('p2', 'Rạng Đông RD-2'), member('p3', 'Đại Hùng DH-1')],
    })])
    renderScreen()
    const list = await screen.findByText('Bạch Hổ BH-7, Rạng Đông RD-2, Đại Hùng DH-1')
    expect(screen.queryByText('+1')).toBeNull()
    const cell = list.closest('td') as HTMLElement
    expectLeft(cell)
    expect(cell.querySelectorAll('span, div').length).toBeLessThanOrEqual(1)
    expect(list.style.background).toBe('')
    expect(list.style.padding).toBe('')
  })

  it('puts "-" in the project cell of an unassigned GS', async () => {
    listGsUsers.mockResolvedValue([account({ projects: [] })])
    listEmployees.mockResolvedValue([])
    renderScreen()
    await screen.findByText('gs1')
    expect(within(rowOf('GS Một')).getByText('-')).toBeInTheDocument()
  })

  it('names a restricted membership\'s work count, and shows a Visitor as Mọi dự án (QA F5)', async () => {
    listGsUsers.mockResolvedValue([
      account({ projects: [member('p1', 'BB1', { allWorks: false, workIds: ['w1'], workCount: 3 })] }),
      account({ id: 'u9', username: 'boss', fullName: 'Sếp', role: 'viewer', projects: [member('p2', 'BB2', { allWorks: false, workIds: ['w1'], workCount: 1 })] }),
    ])
    renderScreen()
    await screen.findByText('gs1')
    expect(screen.getByText('BB1 · 1/3 công việc')).toBeInTheDocument()
    const all = screen.getByText('Mọi dự án')
    expect(all.style.background).toBe('')
    expect(screen.queryByText('BB2 · 1/1 công việc')).toBeNull()
  })

  it('does not render any password before it is requested', async () => {
    revealPassword.mockResolvedValue('s3cret')
    renderScreen()
    await screen.findByText('gs1')
    expect(screen.queryByText('s3cret')).toBeNull()
    expect(revealPassword).not.toHaveBeenCalled()
  })

  it('reveals a password only for the row that was clicked, names who saw it, and takes it off screen on close', async () => {
    revealPassword.mockImplementation((id: string) => Promise.resolve(id === 'u7' ? 's3cret' : 'other-secret'))
    renderScreen()
    await screen.findByText('gs1')
    // In the Sửa dialog (NL-09), and only when Xem is clicked.
    const dialog = await openEdit('GS Một')
    expect(revealPassword).not.toHaveBeenCalled()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Xem mật khẩu' }))
    await waitFor(() => expect(within(dialog).getByText('s3cret')).toBeInTheDocument())
    expect(revealPassword).toHaveBeenCalledWith('u7')
    expect(revealPassword).not.toHaveBeenCalledWith('u9')
    expect(screen.queryByText('other-secret')).toBeNull()
    expect(within(dialog).getByText(/Đã ghi log/)).toHaveTextContent('Nguyễn Thị Linh → gs1')
    // The one date-time form (M12): HH:mm DD/MM/YYYY.
    expect(within(dialog).getByText(/Đã ghi log/)).toHaveTextContent(/^Đã ghi log · \d{2}:\d{2} \d{2}\/\d{2}\/\d{4} · /)

    await userEvent.click(within(dialog).getByRole('button', { name: 'Huỷ' }))
    await waitFor(() => expect(screen.queryByText('s3cret')).toBeNull())
  })

  it('shows an error when reveal fails', async () => {
    revealPassword.mockRejectedValue(new Error('No stored credential'))
    renderScreen()
    await screen.findByText('gs1')
    const dialog = await openEdit('GS Một')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Xem mật khẩu' }))
    expect(await within(dialog).findByText('No stored credential')).toBeInTheDocument()
  })

  it('locks only after the consequences have been confirmed, and says so', async () => {
    renderScreen()
    await screen.findByText('gs1')
    await userEvent.click(within(rowOf('GS Một')).getByRole('button', { name: 'Khoá tài khoản' }))
    expect(deactivateGsUser).not.toHaveBeenCalled()
    // Each consequence its own item, not prose (RUL-01).
    expect(await screen.findByText('Mất quyền truy cập ngay, cả máy tính bảng đang mở cũng ngừng ghi tiến độ')).toBeInTheDocument()
    expect(consequenceItems()).toEqual([
      'Mất quyền truy cập ngay, cả máy tính bảng đang mở cũng ngừng ghi tiến độ',
      'Dự án và công việc đã gán giữ nguyên cho lần mở khoá',
      'Lịch sử ghi nhận vẫn mang tên người này',
    ])
    expect(screen.getByText('Dự án và công việc đã gán giữ nguyên cho lần mở khoá')).toBeInTheDocument()
    expect(screen.getByText('Lịch sử ghi nhận vẫn mang tên người này')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Vẫn khoá/ }))
    await waitFor(() => expect(deactivateGsUser).toHaveBeenCalledWith('u7'))
    expect(await screen.findByText('Đã khoá tài khoản')).toBeInTheDocument()
  })

  it.each([
    ['Khoá tài khoản', /cho lần mở khoá/],
    ['Ẩn tài khoản', /Tìm lại bằng Trạng thái «Đã ẩn»/],
    ['Sửa', /Phân quyền/],
  ])('names no spec id in the %s dialog (CPY-04)', async (action, marker) => {
    renderScreen()
    await screen.findByText('gs1')
    await userEvent.click(within(rowOf('GS Một')).getByRole('button', { name: action }))
    expect((await screen.findAllByText(marker)).length).toBeGreaterThan(0)
    expectNoSpecIds()
  })

  it('offers unlock, not lock, on a locked account', async () => {
    listGsUsers.mockResolvedValue([account({ id: 'u9', username: 'gs2', fullName: 'GS Hai', active: false })])
    renderScreen()
    await screen.findByText('gs2')
    expect(screen.getByText('Đã khoá')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Khoá tài khoản' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Mở khoá' }))
    await waitFor(() => expect(reactivateUser).toHaveBeenCalledWith('u9'))
    expect(await screen.findByText('Đã mở khoá tài khoản')).toBeInTheDocument()
  })

  it('warns before a reset, then hands the new password straight to the reveal dialog', async () => {
    renderScreen()
    await screen.findByText('gs1')
    // A new password typed in the Sửa dialog (NL-09), behind the same warning.
    const dialog = await openEdit('GS Một')
    expect(screen.queryByText(/GS không đăng nhập được cho tới khi bạn giao mật khẩu mới/)).toBeNull()
    await userEvent.type(within(dialog).getByLabelText('Mật khẩu'), 'Bh7@Deck2026')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Lưu' }))
    expect(await screen.findByText('Đổi mật khẩu cho gs1?')).toBeInTheDocument()
    expect(consequenceItems()).toEqual(['Người dùng không nhận được thông báo nào', 'Anh tự giao mật khẩu mới, hiện ra ngay sau bước này'])
    expect(screen.getByText('Anh tự giao mật khẩu mới, hiện ra ngay sau bước này')).toBeInTheDocument()
    expect(setPassword).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Vẫn đổi' }))
    await waitFor(() => expect(setPassword).toHaveBeenCalledWith('u7', 'Bh7@Deck2026'))
    expect(await screen.findByText('Bh7@Deck2026')).toBeInTheDocument()
    expect(await screen.findByText('Đã đổi mật khẩu')).toBeInTheDocument()
  })

  it('refuses a password too short to survive being guessed, and offers a generated one', async () => {
    renderScreen()
    await screen.findByText('gs1')
    const dialog = await openEdit('GS Một')
    await userEvent.type(within(dialog).getByLabelText('Mật khẩu'), 'gs2024')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Lưu' }))
    expect(await within(dialog).findByText(/Tối thiểu 12 ký tự/)).toBeInTheDocument()
    expect(setPassword).not.toHaveBeenCalled()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Sinh mật khẩu' }))
    expect((within(dialog).getByLabelText('Mật khẩu') as HTMLInputElement).value.length).toBeGreaterThanOrEqual(12)
  })

  it('renames a login from the Sửa dialog, prefilled with the current one (NL-09)', async () => {
    renderScreen()
    await screen.findByText('gs1')
    const edit = within(rowOf('GS Một')).getByRole('button', { name: 'Sửa' })
    expect(screen.getByText('GS Một').closest('td')).not.toContainElement(edit)
    const dialog = await openEdit('GS Một')
    const field = within(dialog).getByLabelText('Tên đăng nhập')
    expect(field).toHaveValue('gs1')
    await userEvent.clear(field)
    await userEvent.type(field, 'gs.moi')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Lưu' }))
    await waitFor(() => expect(renameUser).toHaveBeenCalledWith('u7', 'gs.moi'))
    expect(await screen.findByText('Đã đổi tên đăng nhập')).toBeInTheDocument()
  })

  it('hides an account after confirming, finds it under Đã ẩn, and brings it back', async () => {
    renderScreen()
    await screen.findByText('gs1')
    await userEvent.click(within(rowOf('GS Một')).getByRole('button', { name: 'Ẩn tài khoản' }))
    expect(hideUser).not.toHaveBeenCalled()
    expect(await screen.findByText('Tìm lại bằng Trạng thái «Đã ẩn»')).toBeInTheDocument()
    expect(screen.getByText('Mất quyền truy cập ngay, cả máy tính bảng đang mở cũng ngừng ghi tiến độ')).toBeInTheDocument()
    expect(screen.getByText('Lịch sử ghi nhận vẫn mang tên người này')).toBeInTheDocument()
    listGsUsers.mockResolvedValue([account({ active: false, hidden: true })])
    await userEvent.click(await screen.findByRole('button', { name: 'Vẫn ẩn' }))
    await waitFor(() => expect(hideUser).toHaveBeenCalledWith('u7'))
    await waitFor(() => expect(screen.queryByText('gs1')).toBeNull())

    await chooseOption('Trạng thái', 'Đã ẩn', bar())
    await apply()
    expect(await screen.findByText('Đã ẩn', { selector: '.ant-table-cell *' })).toBeInTheDocument()
    await userEvent.click(within(rowOf('GS Một')).getByRole('button', { name: 'Hiện lại' }))
    await waitFor(() => expect(unhideUser).toHaveBeenCalledWith('u7'))
  })

  it('saves project membership and the works within it from the Sửa dialog (NL-09)', async () => {
    listProjectNames.mockResolvedValue(PROJECTS)
    listWorks.mockImplementation((projectId: string) => Promise.resolve(
      projectId === 'p1' ? [{ id: 'w1', name: 'Sơn' }, { id: 'w2', name: 'Tháo giáo' }] : [{ id: 'w3', name: 'Chứng từ' }],
    ))
    renderScreen()
    await screen.findByText('gs1')
    const dialog = await openEdit('GS Một')
    // "Dự án và công việc" names the section: "Phân quyền" is the role, on this screen (review I-2).
    expect(within(dialog).getByText('Dự án và công việc')).toBeInTheDocument()
    expect(screen.queryByText(/Tick dự án tài khoản được vào/)).toBeNull()
    await userEvent.click(await within(dialog).findByRole('switch', { name: 'Tất cả công việc BB1' }))
    await userEvent.type(within(dialog).getByRole('combobox', { name: 'Công việc BB1' }), 'Sơ')
    await screen.findByTitle('Sơn')
    expect(screen.queryByTitle('Tháo giáo')).toBeNull()
    await userEvent.click(screen.getByTitle('Sơn'))
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Thành viên BB2' }))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Lưu' }))
    await waitFor(() => expect(setMemberships).toHaveBeenCalledWith('u7', [
      { projectId: 'p1', allWorks: false, workIds: ['w1'] },
      { projectId: 'p2', allWorks: true, workIds: [] },
    ]))
    expect(await screen.findByText('Đã cập nhật quyền')).toBeInTheDocument()
  })

  it('tells the admin a Visitor sees everything, and offers no matrix to save (RV6-25)', async () => {
    listProjectNames.mockResolvedValue(PROJECTS)
    renderScreen()
    await screen.findByText('gs2')
    const dialog = await openEdit('GS Hai')
    expect(await within(dialog).findByText('Tài khoản Visitor thấy mọi dự án và mọi công việc.')).toBeInTheDocument()
    expect(within(dialog).queryByRole('checkbox', { name: 'Thành viên BB1' })).toBeNull()
    // Nothing changed, nothing to save.
    expect(within(dialog).getByRole('button', { name: 'Lưu' })).toBeDisabled()
    expect(listWorks).not.toHaveBeenCalled()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Huỷ' }))
    await waitFor(() => expect(screen.queryByText('Tài khoản Visitor thấy mọi dự án và mọi công việc.')).toBeNull())
    expect(setMemberships).not.toHaveBeenCalled()
  })
})

describe('NhanLucScreen — employees, as before (Rv4, Rv5)', () => {
  it('locks an employee after confirming and brings one back with Mở khoá, deleting nothing (NL-09 amendment)', async () => {
    renderScreen()
    await screen.findByText('Lê Văn A')
    // No Đang làm switch any more: Khoá/Mở khoá, like an account's.
    expect(screen.queryByRole('switch', { name: /^Đang làm/ })).toBeNull()
    await userEvent.click(within(rowOf('Lê Văn A')).getByRole('button', { name: 'Khoá nhân viên' }))
    const dialog = (await screen.findByText('Khoá nhân viên Lê Văn A?')).closest('.ant-modal') as HTMLElement
    expect(consequenceItems(dialog)).toEqual([
      'Không còn trong ô chọn nhóm trưởng, thợ chính của GS',
      'Các lần cập nhật đã ghi vẫn giữ tên',
      'Mở khoá là đưa lại vào ô chọn',
    ])
    expect(updateEmployee).not.toHaveBeenCalled()
    await userEvent.click(within(dialog).getByRole('button', { name: /Vẫn khoá/ }))
    await waitFor(() => expect(updateEmployee).toHaveBeenCalledWith('e1', { active: false }))
    expect(await screen.findByText('Đã khoá nhân viên')).toBeInTheDocument()

    await chooseOption('Trạng thái', 'Đã nghỉ', bar())
    await apply()
    await userEvent.click(within(rowOf('Trần Thị B')).getByRole('button', { name: 'Mở khoá' }))
    await waitFor(() => expect(updateEmployee).toHaveBeenCalledWith('e2', { active: true }))
    expect(await screen.findByText('Đã mở khoá nhân viên')).toBeInTheDocument()
  })

  it('renames one person', async () => {
    renderScreen()
    await screen.findByText('Lê Văn A')
    const dialog = await openEdit('Lê Văn A')
    const name = within(dialog).getByLabelText('Họ tên')
    await userEvent.clear(name)
    await userEvent.type(name, 'Lê Văn A2')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Lưu' }))
    await waitFor(() => expect(updateEmployee).toHaveBeenCalledWith('e1', { fullName: 'Lê Văn A2' }))
    expect(await screen.findByText('Đã đổi tên')).toBeInTheDocument()
  })

  it('refuses a rename onto a name already on the list, beside the field', async () => {
    renderScreen()
    await screen.findByText('Lê Văn A')
    const dialog = await openEdit('Lê Văn A')
    const name = within(dialog).getByLabelText('Họ tên')
    await userEvent.clear(name)
    await userEvent.type(name, 'gs một')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Lưu' }))
    expect(await within(dialog).findByText('Đã có tài khoản GS/Visitor tên "gs một".')).toBeInTheDocument()
    expect(updateEmployee).not.toHaveBeenCalled()
  })

  it('exports every employee, retired included, whatever the filter shows (RV5-08)', async () => {
    renderScreen()
    await screen.findByText('Lê Văn A')
    await userEvent.type(search(), 'le{Enter}')
    await userEvent.hover(screen.getByRole('button', { name: /Xuất danh sách/ }))
    expect(await screen.findByText(/cả người đã nghỉ/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Xuất danh sách/ }))
    await waitFor(() => expect(buildEmployeesXlsx).toHaveBeenCalledWith(EMPLOYEES))
    await waitFor(() => expect(downloadWorkbook).toHaveBeenCalledWith(
      expect.any(Blob), expect.stringMatching(/^nhan-vien-\d{4}-\d{2}-\d{2}\.xlsx$/),
    ))
  })

  it('surfaces a failed export instead of leaving the button spinning', async () => {
    buildEmployeesXlsx.mockRejectedValue(new Error('hết bộ nhớ'))
    renderScreen()
    await screen.findByText('Lê Văn A')
    await userEvent.click(screen.getByRole('button', { name: /Xuất danh sách/ }))
    expect((await screen.findAllByText('hết bộ nhớ')).length).toBeGreaterThan(0)
  })
})

describe('NhanLucScreen — Thêm nhân lực (NL-02)', () => {
  const open = async () => {
    await screen.findByText('gs1')
    await userEvent.click(screen.getByRole('button', { name: 'Thêm nhân lực' }))
    return screen.findByRole('dialog', { name: 'Thêm nhân lực' })
  }
  const pick = async (label: string) => userEvent.click(within(screen.getByRole('radiogroup', { name: 'Phân quyền' })).getByLabelText(label))

  it('starts on Nhân viên, asks only the name, and says what the role means', async () => {
    renderScreen()
    const dialog = await open()
    expect(within(dialog).getByRole('radio', { name: 'Nhân viên' })).toBeChecked()
    expect(within(dialog).getByLabelText('Họ tên')).toBeInTheDocument()
    expect(within(dialog).queryByLabelText('Tên đăng nhập')).toBeNull()
    expect(within(dialog).queryByLabelText('Mật khẩu')).toBeNull()
    expect(within(dialog).queryByRole('combobox', { name: 'Dự án' })).toBeNull()
    expect(within(dialog).getByText('Nhân viên không đăng nhập và được GS chọn làm nhóm trưởng hoặc thợ chính khi ghi tiến độ.')).toBeInTheDocument()
  })

  it('adds an employee and re-reads the list', async () => {
    renderScreen()
    const dialog = await open()
    await userEvent.type(within(dialog).getByLabelText('Họ tên'), 'Nguyễn Văn C')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Thêm' }))
    await waitFor(() => expect(createEmployee).toHaveBeenCalledWith('Nguyễn Văn C'))
    await waitFor(() => expect(listEmployees).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('Đã thêm nhân viên')).toBeInTheDocument()
    expect(createGsUser).not.toHaveBeenCalled()
  })

  it('refuses a name already on the list before asking the server, for either list', async () => {
    renderScreen()
    const dialog = await open()
    await userEvent.type(within(dialog).getByLabelText('Họ tên'), ' lê văn a ')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Thêm' }))
    expect(await within(dialog).findByText('Đã có nhân viên tên "lê văn a".')).toBeInTheDocument()

    await userEvent.clear(within(dialog).getByLabelText('Họ tên'))
    await userEvent.type(within(dialog).getByLabelText('Họ tên'), 'GS Hai')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Thêm' }))
    expect(await within(dialog).findByText('Đã có tài khoản GS/Visitor tên "GS Hai".')).toBeInTheDocument()
    expect(createEmployee).not.toHaveBeenCalled()
  })

  it('shows the server\'s refusal inside the dialog', async () => {
    createEmployee.mockRejectedValue(new Error('Đã có tài khoản GS/Visitor tên "Người Ẩn".'))
    renderScreen()
    const dialog = await open()
    await userEvent.type(within(dialog).getByLabelText('Họ tên'), 'Người Ẩn')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Thêm' }))
    expect(await within(dialog).findByText('Đã có tài khoản GS/Visitor tên "Người Ẩn".')).toBeInTheDocument()
  })

  it('creates a GS with a login, a password and a project', async () => {
    listProjectNames.mockResolvedValue(PROJECTS)
    renderScreen()
    const dialog = await open()
    await pick('GS')
    expect(within(dialog).getByText('GS đăng nhập trên máy tính bảng và ghi tiến độ ở các dự án được gán.')).toBeInTheDocument()
    await userEvent.type(within(dialog).getByLabelText('Họ tên'), 'Lê Trung Hiếu')
    await userEvent.type(within(dialog).getByLabelText('Tên đăng nhập'), 'gs.hieu')
    await userEvent.type(within(dialog).getByLabelText('Mật khẩu'), 'Bh7@Deck2026')
    await chooseOption('Dự án', 'BB1', dialog)
    await userEvent.click(within(dialog).getByRole('button', { name: 'Thêm' }))
    await waitFor(() => expect(createGsUser).toHaveBeenCalledWith({
      username: 'gs.hieu', fullName: 'Lê Trung Hiếu', password: 'Bh7@Deck2026', role: 'gs', projectId: 'p1',
    }))
    expect(await screen.findByText('Đã tạo tài khoản')).toBeInTheDocument()
  })

  it('needs the login, the password and the project of a GS', async () => {
    renderScreen()
    const dialog = await open()
    await pick('GS')
    await userEvent.type(within(dialog).getByLabelText('Họ tên'), 'Lê Trung Hiếu')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Thêm' }))
    expect(await within(dialog).findByText('Nhập tên đăng nhập')).toBeInTheDocument()
    expect(errorsIn(dialog)).toEqual(['Nhập tên đăng nhập', 'Nhập mật khẩu', 'Chọn dự án'])
    expect(createGsUser).not.toHaveBeenCalled()
  })

  it('creates a Visitor with no project field and sends no project (NL-05)', async () => {
    renderScreen()
    const dialog = await open()
    await pick('Visitor')
    expect(within(dialog).queryByRole('combobox', { name: 'Dự án' })).toBeNull()
    expect(within(dialog).getByText('Visitor đăng nhập, xem mọi dự án và mọi công việc, tải được báo cáo nhưng không ghi được gì.')).toBeInTheDocument()
    await userEvent.type(within(dialog).getByLabelText('Họ tên'), 'Sếp A')
    await userEvent.type(within(dialog).getByLabelText('Tên đăng nhập'), 'Sep.A')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Sinh mật khẩu' }))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Thêm' }))
    await waitFor(() => expect(createGsUser).toHaveBeenCalledTimes(1))
    const sent = createGsUser.mock.calls[0][0] as Record<string, unknown>
    expect(sent).toMatchObject({ username: 'sep.a', fullName: 'Sếp A', role: 'viewer' })
    expect(sent.projectId).toBeUndefined()
    expect(String(sent.password).length).toBeGreaterThanOrEqual(12)
  })

  it('drops a name error that no longer applies when the role changes (review minor 5)', async () => {
    listGsUsers.mockResolvedValue([...ACCOUNTS, account({ id: 'u5', username: 'an.cu', fullName: 'Người Ẩn', role: 'viewer', active: false, hidden: true })])
    renderScreen()
    const dialog = await open()
    await pick('GS')
    await userEvent.type(within(dialog).getByLabelText('Họ tên'), 'người ẩn')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Thêm' }))
    expect(await within(dialog).findByText('Đã có tài khoản GS/Visitor tên "người ẩn" (đã ẩn; chọn Trạng thái «Đã ẩn» để thấy).')).toBeInTheDocument()
    // An employee may share a hidden account's name (A1): the error goes.
    await pick('Nhân viên')
    await waitFor(() => expect(within(dialog).queryByText(/Đã có tài khoản GS\/Visitor tên "người ẩn"/)).toBeNull())
  })

  it('refuses a login or a name an account already has', async () => {
    renderScreen()
    const dialog = await open()
    await pick('Visitor')
    await userEvent.type(within(dialog).getByLabelText('Họ tên'), 'lê văn a')
    await userEvent.type(within(dialog).getByLabelText('Tên đăng nhập'), 'GS1')
    await userEvent.type(within(dialog).getByLabelText('Mật khẩu'), 'Bh7@Deck2026')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Thêm' }))
    expect(await within(dialog).findByText('Tên đăng nhập này đã có người dùng')).toBeInTheDocument()
    expect(within(dialog).getByText('Đã có nhân viên tên "lê văn a".')).toBeInTheDocument()
    expect(createGsUser).not.toHaveBeenCalled()
  })
})

describe('NhanLucScreen — Đổi phân quyền, from the Sửa dialog (NL-04, NL-09)', () => {
  // The role is the Sửa dialog's first field; Lưu runs the change-role flow.
  const openChange = openEdit
  const pickNew = async (dialog: HTMLElement, label: string) =>
    userEvent.click(within(within(dialog).getByRole('radiogroup', { name: 'Phân quyền' })).getByLabelText(label))
  const next = (dialog: HTMLElement) => userEvent.click(within(dialog).getByRole('button', { name: 'Lưu' }))

  it('turns an employee into a GS after saying what happens, with a new login', async () => {
    listProjectNames.mockResolvedValue(PROJECTS)
    changeRole.mockResolvedValue({ userId: 'u5', username: 'gs.a', reactivated: false })
    renderScreen()
    await screen.findByText('Lê Văn A')
    const dialog = await openChange('Lê Văn A')
    expect(within(dialog).getByRole('radio', { name: 'Nhân viên' })).toBeChecked()
    expect(within(dialog).getByRole('button', { name: 'Lưu' })).toBeDisabled()
    await pickNew(dialog, 'GS')
    await userEvent.type(within(dialog).getByLabelText('Tên đăng nhập'), 'gs.a')
    await userEvent.type(within(dialog).getByLabelText('Mật khẩu'), 'Bh7@Deck2026')
    await chooseOption('Dự án', 'BB1', dialog)
    await next(dialog)

    expect(await screen.findByText('Đổi Lê Văn A thành GS?')).toBeInTheDocument()
    expect(screen.getByText('Tài khoản mới gs.a')).toBeInTheDocument()
    expect(screen.getByText('Đăng nhập được bằng tài khoản mới')).toBeInTheDocument()
    expect(screen.getByText('Không còn trong ô chọn nhóm trưởng, thợ chính của GS')).toBeInTheDocument()
    expect(screen.getByText('Các lần cập nhật đã ghi vẫn giữ tên')).toBeInTheDocument()
    expect(changeRole).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Vẫn đổi' }))
    await waitFor(() => expect(changeRole).toHaveBeenCalledWith({
      kind: 'employee', id: 'e1', role: 'gs', username: 'gs.a', password: 'Bh7@Deck2026', projectId: 'p1',
    }))
    expect(await screen.findByText('Đã tạo tài khoản gs.a')).toBeInTheDocument()
    await waitFor(() => expect(listGsUsers).toHaveBeenCalledTimes(2))
  })

  it('re-opens the hidden account of the same name instead of asking for a login (A1)', async () => {
    listGsUsers.mockResolvedValue([...ACCOUNTS, account({ id: 'u3', username: 'a.cu', fullName: 'lê văn a', role: 'viewer', active: false, hidden: true })])
    changeRole.mockResolvedValue({ userId: 'u3', username: 'a.cu', reactivated: true })
    renderScreen()
    await screen.findByText('Lê Văn A')
    const dialog = await openChange('Lê Văn A')
    await pickNew(dialog, 'Visitor')
    expect(within(dialog).getByText('Mở lại tài khoản đã ẩn a.cu')).toBeInTheDocument()
    expect(within(dialog).queryByLabelText('Tên đăng nhập')).toBeNull()
    await userEvent.type(within(dialog).getByLabelText('Mật khẩu'), 'Bh7@Deck2026')
    await next(dialog)
    expect(await screen.findByText('Mở lại tài khoản a.cu')).toBeInTheDocument()
    expect(screen.getByText('Tài khoản cũ mở khoá với mật khẩu mới')).toBeInTheDocument()
    expect(screen.getByText('Không còn trong ô chọn nhóm trưởng, thợ chính của GS')).toBeInTheDocument()
    expect(screen.getByText('Các lần cập nhật đã ghi vẫn giữ tên')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Vẫn đổi' }))
    await waitFor(() => expect(changeRole).toHaveBeenCalledWith({
      kind: 'employee', id: 'e1', role: 'viewer', password: 'Bh7@Deck2026',
    }))
    expect(await screen.findByText('Đã mở lại tài khoản a.cu')).toBeInTheDocument()
  })

  it('turns a GS into an employee: locked and hidden, never deleted', async () => {
    changeRole.mockResolvedValue({ employeeId: 'e9' })
    renderScreen()
    await screen.findByText('gs1')
    const dialog = await openChange('GS Một')
    await pickNew(dialog, 'Nhân viên')
    expect(within(dialog).queryByLabelText('Mật khẩu')).toBeNull()
    await next(dialog)
    expect(await screen.findByText('Tài khoản bị khoá và ẩn, không bị xoá:')).toBeInTheDocument()
    // The same lock as Khoá: access ends at once (staff.ts sets active = false).
    expect(consequenceItems()).toEqual([
      'Mất quyền truy cập ngay, cả máy tính bảng đang mở cũng ngừng ghi tiến độ',
      'Lịch sử ghi nhận vẫn mang tên người này',
      'Một nhân viên đang làm cùng tên được thêm vào ô chọn của GS',
      'Đổi lại thành GS hoặc Visitor là mở lại đúng tài khoản này',
    ])
    await userEvent.click(screen.getByRole('button', { name: 'Vẫn đổi' }))
    await waitFor(() => expect(changeRole).toHaveBeenCalledWith({ kind: 'account', id: 'u7', role: 'employee' }))
    expect(await screen.findByText('Đã chuyển thành nhân viên')).toBeInTheDocument()
  })

  it('turns a GS into a Visitor with no field to fill', async () => {
    changeRole.mockResolvedValue({ ok: true })
    renderScreen()
    await screen.findByText('gs1')
    const dialog = await openChange('GS Một')
    await pickNew(dialog, 'Visitor')
    await next(dialog)
    expect(await screen.findByText('Xem được mọi dự án và công việc')).toBeInTheDocument()
    expect(screen.getByText('Không ghi được tiến độ nữa')).toBeInTheDocument()
    expect(screen.getByText('Dự án đã gán được giữ lại, không dùng khi là Visitor')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Vẫn đổi' }))
    await waitFor(() => expect(changeRole).toHaveBeenCalledWith({ kind: 'account', id: 'u7', role: 'viewer' }))
    expect(await screen.findByText('Đã đổi phân quyền')).toBeInTheDocument()
  })

  it('needs a project to turn a Visitor into a GS', async () => {
    listProjectNames.mockResolvedValue(PROJECTS)
    changeRole.mockResolvedValue({ ok: true })
    renderScreen()
    await screen.findByText('gs2')
    const dialog = await openChange('GS Hai')
    await pickNew(dialog, 'GS')
    await next(dialog)
    await waitFor(() => expect(errorsIn(dialog)).toEqual(['Chọn dự án']))
    await chooseOption('Dự án', 'BB1', dialog)
    await next(dialog)
    // Every project the account will write to is named, the kept ones too (review minor 2).
    const confirm = (await screen.findByText('Tài khoản thành GS, ghi được tiến độ ở các dự án này:')).closest('.ant-modal') as HTMLElement
    expect(within(confirm).getByText('Đổi gs2 thành GS?')).toBeInTheDocument()
    expect(within(confirm).getByText('BB1')).toBeInTheDocument()
    expect(within(confirm).getByText('mới gán')).toBeInTheDocument()
    expect(within(confirm).getByText('BB2')).toBeInTheDocument()
    expect(within(confirm).getByText('giữ lại · mọi công việc')).toBeInTheDocument()
    expect(within(confirm).getByText('Không còn xem được dự án ngoài các dự án trên')).toBeInTheDocument()
    expect(within(confirm).getByText('Bỏ bớt dự án ở mục «Dự án và công việc» của hộp Sửa sau khi đổi')).toBeInTheDocument()
    await userEvent.click(within(confirm).getByRole('button', { name: 'Vẫn đổi' }))
    await waitFor(() => expect(changeRole).toHaveBeenCalledWith({ kind: 'account', id: 'u9', role: 'gs', projectId: 'p1' }))
  })

  it('refuses turning a hidden account into an employee whose name is taken, before asking the server (review minor 3)', async () => {
    listGsUsers.mockResolvedValue([...ACCOUNTS, account({ id: 'u5', username: 'b.cu', fullName: 'trần thị b', role: 'viewer', active: false, hidden: true })])
    renderScreen()
    await screen.findByText('gs1')
    await chooseOption('Trạng thái', 'Đã ẩn', bar())
    await apply()
    const dialog = await openChange('trần thị b')
    await pickNew(dialog, 'Nhân viên')
    expect(within(dialog).getByText('Đã có nhân viên tên "trần thị b" (đã nghỉ; chọn Trạng thái «Đã nghỉ» để thấy).')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Lưu' })).toBeDisabled()
    expect(changeRole).not.toHaveBeenCalled()
  })

  it('shows the server\'s refusal inside the dialog, which stays open with what was typed (review minor 4)', async () => {
    changeRole.mockRejectedValue(new Error('Tên đăng nhập này đã có người dùng'))
    renderScreen()
    await screen.findByText('Lê Văn A')
    const dialog = await openChange('Lê Văn A')
    await pickNew(dialog, 'Visitor')
    await userEvent.type(within(dialog).getByLabelText('Tên đăng nhập'), 'da.co')
    await userEvent.type(within(dialog).getByLabelText('Mật khẩu'), 'Bh7@Deck2026')
    await next(dialog)
    await userEvent.click(await screen.findByRole('button', { name: 'Vẫn đổi' }))
    // Says what was not saved, and why (NL-09).
    expect(await within(dialog).findByText(/Chưa lưu: Phân quyền -- Tên đăng nhập này đã có người dùng/)).toBeInTheDocument()
    expect(dialog).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Lưu' })).toBeEnabled()
    expect(within(dialog).getByLabelText('Tên đăng nhập')).toHaveValue('da.co')
    expect(within(dialog).getByLabelText('Mật khẩu')).toHaveValue('Bh7@Deck2026')
  })
})

describe('NhanLucScreen — rules (RUL-01, CPY-05)', () => {
  it('states each role in the words the create dialog uses, and the list\'s own rules', async () => {
    renderScreen()
    await screen.findByText('gs1')
    expect(screen.queryByText(/GS đăng nhập trên máy tính bảng/)).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: /Quy tắc áp dụng/ }))
    for (const text of [
      'Nhân viên không đăng nhập và được GS chọn làm nhóm trưởng hoặc thợ chính khi ghi tiến độ.',
      'GS đăng nhập trên máy tính bảng và ghi tiến độ ở các dự án được gán.',
      'Visitor đăng nhập, xem mọi dự án và mọi công việc, tải được báo cáo nhưng không ghi được gì.',
    ]) expect(screen.getByText(text)).toBeInTheDocument()
    // Every entry one present-tense helper sentence (RUL-01).
    expect(ruleTexts().slice(3)).toEqual([
      'Họ tên và tên đăng nhập không trùng với người đã có trong danh sách.',
      'Tài khoản chỉ khoá hoặc ẩn được, không xoá được.',
      'Đổi tài khoản thành nhân viên thì tài khoản bị khoá và ẩn.',
      'Đổi nhân viên đó lại thành GS hoặc Visitor thì mở lại đúng tài khoản cũ.',
      'Mỗi lần xem mật khẩu đều được ghi vào nhật ký, kèm người xem, tài khoản và thời điểm.',
      'Giới hạn công việc chỉ ẩn tiến độ của công việc không được gán và không ẩn sàn nào.',
      'Người đã tắt Đang làm không còn trong ô chọn của GS nhưng vẫn giữ tên trên các lần cập nhật đã ghi.',
    ])
    expectHelperText(ruleTexts())
    expectNoSpecIds()
  })
})

describe('NhanLucScreen — actions and dialogs (M7, M8, M9, NL-09)', () => {
  const dialogOf = async (title: string) => (await screen.findByText(title)).closest('.ant-modal') as HTMLElement
  const actionsOf = (name: string) => within(rowOf(name)).getByRole('button', { name: 'Sửa' }).closest('td')!.firstElementChild as HTMLElement

  it('keeps every row to Sửa, Khoá/Mở khoá and Ẩn/Hiện lại in one slot order, right-aligned (M7, NL-09)', async () => {
    listGsUsers.mockResolvedValue([
      ...ACCOUNTS,
      account({ id: 'u3', username: 'gs3', fullName: 'GS Ba', active: false, hidden: true }),
    ])
    renderScreen()
    await screen.findByText('gs1')
    const names = (el: HTMLElement) => within(el).queryAllByRole('button').map((b) => b.getAttribute('aria-label'))
    expect(names(actionsOf('GS Một'))).toEqual(['Sửa', 'Khoá tài khoản', 'Ẩn tài khoản'])
    // An employee: Sửa and Khoá, the hide slot kept empty so the columns line up.
    expect(names(actionsOf('Lê Văn A'))).toEqual(['Sửa', 'Khoá nhân viên'])
    for (const name of ['GS Một', 'Lê Văn A']) {
      expect(actionsOf(name)).toHaveStyle({ justifyContent: 'flex-end' })
      expect(actionsOf(name).children).toHaveLength(3)
    }
    // The old five row icons are in the Sửa dialog now.
    for (const gone of ['Đổi tên đăng nhập', 'Dự án và công việc', 'Đổi mật khẩu', 'Xem mật khẩu', 'Đổi phân quyền']) {
      expect(within(rowOf('GS Một')).queryByRole('button', { name: gone })).toBeNull()
    }
    await chooseOption('Trạng thái', 'Đã ẩn', bar())
    await apply()
    await screen.findByText('gs3')
    // A hidden account has no lock: its slot is kept empty rather than closed up.
    const hidden = actionsOf('GS Ba')
    expect(hidden).toHaveStyle({ justifyContent: 'flex-end' })
    expect(hidden.children).toHaveLength(3)
  })

  it('brings a hidden account back from an icon button like the rest (M7)', async () => {
    listGsUsers.mockResolvedValue([account({ active: false, hidden: true })])
    renderScreen()
    await chooseOption('Trạng thái', 'Đã ẩn', bar())
    await apply()
    const back = await within(await waitFor(() => rowOf('GS Một'))).findByRole('button', { name: 'Hiện lại' })
    expect(back).toHaveClass('ant-btn-icon-only')
    expect(back).toHaveTextContent('')
  })

  it('titles the Sửa dialog with "·", and says "Đổi mật khẩu" on the confirmation and the toast (M7)', async () => {
    renderScreen()
    await screen.findByText('gs1')
    const dialog = await openEdit('GS Một')
    expect(within(dialog).getByText('Sửa · GS Một')).toBeInTheDocument()
    await userEvent.type(within(dialog).getByLabelText('Mật khẩu'), 'Bh7@Deck2026')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Lưu' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Vẫn đổi' }))
    expect(await screen.findByText('Đã đổi mật khẩu')).toBeInTheDocument()
  })

  it('spins the password change while it writes, and says a refusal in the Sửa dialog (M8, NL-09)', async () => {
    let fail: (e: Error) => void = () => {}
    setPassword.mockReturnValue(new Promise((_res, rej) => { fail = rej }))
    renderScreen()
    await screen.findByText('gs1')
    const edit = await openEdit('GS Một')
    await userEvent.type(within(edit).getByLabelText('Mật khẩu'), 'Bh7@Deck2026')
    await userEvent.click(within(edit).getByRole('button', { name: 'Lưu' }))
    const confirm = await dialogOf('Đổi mật khẩu cho gs1?')
    await userEvent.click(within(confirm).getByRole('button', { name: /Vẫn đổi/ }))
    await waitFor(() => expect(within(confirm).getByRole('button', { name: /Vẫn đổi/ })).toHaveClass('ant-btn-loading'))
    fail(new Error('Mật khẩu bị từ chối'))
    expect(await within(edit).findByText(/Chưa lưu: Mật khẩu -- Mật khẩu bị từ chối/)).toBeInTheDocument()
  })

  it('keeps a refused login rename inside the Sửa dialog, which stays open (M8, NL-09)', async () => {
    renameUser.mockRejectedValue(new Error('Tên đăng nhập này đã có người dùng'))
    renderScreen()
    await screen.findByText('gs1')
    const dialog = await openEdit('GS Một')
    const field = within(dialog).getByLabelText('Tên đăng nhập')
    await userEvent.clear(field)
    await userEvent.type(field, 'gs.moi')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Lưu' }))
    expect(await within(dialog).findByText(/Tên đăng nhập này đã có người dùng/)).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Tên đăng nhập')).toHaveValue('gs.moi')
  })

  it('keeps a refused permissions save inside the Sửa dialog (M8, NL-09)', async () => {
    listProjectNames.mockResolvedValue(PROJECTS)
    setMemberships.mockRejectedValue(new Error('Không lưu được quyền'))
    renderScreen()
    await screen.findByText('gs1')
    const dialog = await openEdit('GS Một')
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Thành viên BB2' }))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Lưu' }))
    expect(await within(dialog).findByText(/Chưa lưu: Dự án và công việc -- Không lưu được quyền/)).toBeInTheDocument()
  })

  it('saves only what changed, in order, and stops at a refusal saying what was saved (NL-09)', async () => {
    listProjectNames.mockResolvedValue(PROJECTS)
    setPassword.mockRejectedValue(new Error('Mật khẩu bị từ chối'))
    renderScreen()
    await screen.findByText('gs1')
    const dialog = await openEdit('GS Một')
    const login = within(dialog).getByLabelText('Tên đăng nhập')
    await userEvent.clear(login)
    await userEvent.type(login, 'gs.moi')
    await userEvent.type(within(dialog).getByLabelText('Mật khẩu'), 'Bh7@Deck2026')
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Thành viên BB2' }))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Lưu' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Vẫn đổi' }))
    expect(await within(dialog).findByText(
      /Đã lưu: Tên đăng nhập\. Chưa lưu: Mật khẩu, Dự án và công việc -- Mật khẩu bị từ chối/,
    )).toBeInTheDocument()
    expect(renameUser).toHaveBeenCalledWith('u7', 'gs.moi')
    expect(setMemberships).not.toHaveBeenCalled()
    // What was saved is re-read; the dialog keeps what was typed.
    await waitFor(() => expect(listGsUsers).toHaveBeenCalledTimes(2))
    expect(within(dialog).getByLabelText('Mật khẩu')).toHaveValue('Bh7@Deck2026')
  })

  it('renames an account\'s full name from the Sửa dialog (NL-09)', async () => {
    renderScreen()
    await screen.findByText('gs1')
    const dialog = await openEdit('GS Một')
    const name = within(dialog).getByLabelText('Họ tên')
    expect(name).toHaveValue('GS Một')
    await userEvent.clear(name)
    await userEvent.type(name, 'GS Một Mới')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Lưu' }))
    await waitFor(() => expect(renameAccount).toHaveBeenCalledWith('u7', 'GS Một Mới'))
    expect(await screen.findByText('Đã đổi tên')).toBeInTheDocument()
    expect(setPassword).not.toHaveBeenCalled()
    expect(renameUser).not.toHaveBeenCalled()
  })

  it('says "Mọi dự án" for a Visitor in the lock, hide and password dialogs, and names no GS (M9)', async () => {
    renderScreen()
    await screen.findByText('gs2')
    await userEvent.click(within(rowOf('GS Hai')).getByRole('button', { name: 'Khoá tài khoản' }))
    let dialog = await dialogOf('Khoá tài khoản gs2?')
    expect(within(dialog).getByText('Mọi dự án')).toBeInTheDocument()
    expect(within(dialog).queryByText('BB2')).toBeNull()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Huỷ' }))

    await userEvent.click(within(rowOf('GS Hai')).getByRole('button', { name: 'Ẩn tài khoản' }))
    dialog = await dialogOf('Ẩn tài khoản gs2?')
    expect(within(dialog).getByText('Mọi dự án')).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Huỷ' }))

    await userEvent.click(within(rowOf('GS Hai')).getByRole('button', { name: 'Sửa' }))
    // By its title: the two closed confirmations are still leaving the DOM in jsdom.
    const edit = await dialogOf('Sửa · GS Hai')
    await userEvent.type(within(edit).getByLabelText('Mật khẩu'), 'Bh7@Deck2026')
    await userEvent.click(within(edit).getByRole('button', { name: 'Lưu' }))
    dialog = await dialogOf('Đổi mật khẩu cho gs2?')
    expect(within(dialog).getByText('Mọi dự án')).toBeInTheDocument()
    expect(consequenceItems(dialog)).toEqual(['Người dùng không nhận được thông báo nào', 'Anh tự giao mật khẩu mới, hiện ra ngay sau bước này'])
  })
})
