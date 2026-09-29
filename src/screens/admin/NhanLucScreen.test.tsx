import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderApp } from '../../test/renderApp'
import { NhanLucScreen } from './NhanLucScreen'
import { expectLeft } from '../../test/alignment'
import { weightOf } from '../../test/typography'
import { expectNoSpecIds, keyFactTexts, pageSubtitle } from '../../test/copy'
import { chooseOption, optionTitles } from '../../test/select'

const listGsUsers = vi.fn()
const revealPassword = vi.fn()
const setPassword = vi.fn()
const deactivateGsUser = vi.fn()
const createGsUser = vi.fn()
const reactivateUser = vi.fn()
const renameUser = vi.fn()
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
    listGsUsers, revealPassword, setPassword, deactivateGsUser, createGsUser, reactivateUser, renameUser,
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
    expect(shownNames()).toEqual(['GS Hai', 'GS Một', 'Lê Văn A'])
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
    expect(await screen.findByRole('tooltip')).toHaveTextContent('GS đăng nhập trên tablet và ghi tiến độ ở các dự án được gán.')
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
    expect(within(rowOf('Lê Văn A')).getByRole('switch').closest('td')).toHaveStyle({ textAlign: 'center' })
  })

  it('sets the person\'s name as body text: the row is not a heading (TYP-02)', async () => {
    renderScreen()
    const name = await screen.findByText('GS Một')
    expect(weightOf(name)).toBe(400)
    expect(name).toHaveStyle({ fontSize: '13px' })
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
    expect(search()).toHaveAttribute('placeholder', 'Tìm theo tên hoặc tên đăng nhập')
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
    expect(shownNames()).toEqual(['GS Hai', 'GS Một', 'Lê Văn A'])
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
    await userEvent.click(within(rowOf('GS Một')).getByRole('button', { name: 'Xem mật khẩu' }))
    await waitFor(() => expect(screen.getByText('s3cret')).toBeInTheDocument())
    expect(revealPassword).toHaveBeenCalledWith('u7')
    expect(revealPassword).not.toHaveBeenCalledWith('u9')
    expect(screen.queryByText('other-secret')).toBeNull()
    expect(screen.getByText(/Đã ghi log/)).toHaveTextContent('Nguyễn Thị Linh → gs1')
    expect(screen.queryByText(/Log chỉ ghi thêm/)).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Đã ghi nhận' }))
    await waitFor(() => expect(screen.queryByText('s3cret')).toBeNull())
  })

  it('shows an error when reveal fails', async () => {
    revealPassword.mockRejectedValue(new Error('No stored credential'))
    renderScreen()
    await screen.findByText('gs1')
    await userEvent.click(within(rowOf('GS Một')).getByRole('button', { name: 'Xem mật khẩu' }))
    expect(await screen.findByText('No stored credential')).toBeInTheDocument()
  })

  it('locks only after the consequences have been confirmed, and says so', async () => {
    renderScreen()
    await screen.findByText('gs1')
    await userEvent.click(within(rowOf('GS Một')).getByRole('button', { name: 'Khoá tài khoản' }))
    expect(deactivateGsUser).not.toHaveBeenCalled()
    expect(await screen.findByText(/mở khoá là dùng lại được/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Vẫn khoá/ }))
    await waitFor(() => expect(deactivateGsUser).toHaveBeenCalledWith('u7'))
    expect(await screen.findByText('Đã khoá tài khoản')).toBeInTheDocument()
  })

  it.each([
    ['Khoá tài khoản', /mở khoá là dùng lại được/],
    ['Ẩn tài khoản', /Trạng thái «Đã ẩn» để tìm lại/],
    ['Dự án và công việc', /Lưu quyền/],
    ['Đổi phân quyền', /Tiếp tục/],
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
    await userEvent.click(within(rowOf('GS Một')).getByRole('button', { name: 'Đổi mật khẩu' }))
    expect(screen.queryByText(/GS không đăng nhập được cho tới khi bạn giao mật khẩu mới/)).toBeNull()
    await userEvent.type(screen.getByLabelText('Mật khẩu mới'), 'Bh7@Deck2026')
    await userEvent.click(screen.getByRole('button', { name: 'Lưu' }))
    expect(await screen.findByText('Đổi mật khẩu cho gs1?')).toBeInTheDocument()
    expect(setPassword).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Vẫn đổi' }))
    await waitFor(() => expect(setPassword).toHaveBeenCalledWith('u7', 'Bh7@Deck2026'))
    expect(await screen.findByText('Bh7@Deck2026')).toBeInTheDocument()
    expect(await screen.findByText('Đã đặt lại mật khẩu')).toBeInTheDocument()
  })

  it('refuses a password too short to survive being guessed, and offers a generated one', async () => {
    renderScreen()
    await screen.findByText('gs1')
    await userEvent.click(within(rowOf('GS Một')).getByRole('button', { name: 'Đổi mật khẩu' }))
    await userEvent.type(screen.getByLabelText('Mật khẩu mới'), 'gs2024')
    await userEvent.click(screen.getByRole('button', { name: 'Lưu' }))
    expect(await screen.findByText(/Tối thiểu 12 ký tự/)).toBeInTheDocument()
    expect(setPassword).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Sinh mật khẩu' }))
    expect((screen.getByLabelText('Mật khẩu mới') as HTMLInputElement).value.length).toBeGreaterThanOrEqual(12)
  })

  it('renames a login from the pencil in the actions column', async () => {
    renderScreen()
    await screen.findByText('gs1')
    const rename = within(rowOf('GS Một')).getByRole('button', { name: 'Đổi tên đăng nhập' })
    expect(screen.getByText('GS Một').closest('td')).not.toContainElement(rename)
    await userEvent.hover(rename)
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Đổi tên đăng nhập')
    await userEvent.click(rename)
    const field = await screen.findByLabelText('Tên đăng nhập mới')
    await userEvent.clear(field)
    await userEvent.type(field, 'gs.moi')
    await userEvent.click(screen.getByRole('button', { name: 'Lưu' }))
    await waitFor(() => expect(renameUser).toHaveBeenCalledWith('u7', 'gs.moi'))
    expect(await screen.findByText('Đã đổi tên đăng nhập')).toBeInTheDocument()
  })

  it('hides an account after confirming, finds it under Đã ẩn, and brings it back', async () => {
    renderScreen()
    await screen.findByText('gs1')
    await userEvent.click(within(rowOf('GS Một')).getByRole('button', { name: 'Ẩn tài khoản' }))
    expect(hideUser).not.toHaveBeenCalled()
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

  it('saves project membership and the works within it from one dialog', async () => {
    listProjectNames.mockResolvedValue(PROJECTS)
    listWorks.mockImplementation((projectId: string) => Promise.resolve(
      projectId === 'p1' ? [{ id: 'w1', name: 'Sơn' }, { id: 'w2', name: 'Tháo giáo' }] : [{ id: 'w3', name: 'Chứng từ' }],
    ))
    renderScreen()
    await screen.findByText('gs1')
    await userEvent.click(within(rowOf('GS Một')).getByRole('button', { name: 'Dự án và công việc' }))
    // Named for what it edits: "Phân quyền" is the role, on this screen (review I-2).
    expect(await screen.findByRole('dialog', { name: 'Dự án và công việc · gs1' })).toBeInTheDocument()
    expect(screen.queryByText(/Tick dự án tài khoản được vào/)).toBeNull()
    await userEvent.click(await screen.findByRole('switch', { name: 'Tất cả công việc BB1' }))
    await userEvent.type(screen.getByRole('combobox', { name: 'Công việc BB1' }), 'Sơ')
    await screen.findByTitle('Sơn')
    expect(screen.queryByTitle('Tháo giáo')).toBeNull()
    await userEvent.click(screen.getByTitle('Sơn'))
    await userEvent.click(screen.getByRole('checkbox', { name: 'Thành viên BB2' }))
    await userEvent.click(screen.getByRole('button', { name: 'Lưu quyền' }))
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
    await userEvent.click(within(rowOf('GS Hai')).getByRole('button', { name: 'Dự án và công việc' }))
    expect(await screen.findByRole('dialog', { name: 'Dự án và công việc · gs2' })).toBeInTheDocument()
    expect(await screen.findByText('Tài khoản Visitor thấy mọi dự án và mọi công việc.')).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: 'Thành viên BB1' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Lưu quyền' })).toBeNull()
    expect(listWorks).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Đóng' }))
    await waitFor(() => expect(screen.queryByText('Tài khoản Visitor thấy mọi dự án và mọi công việc.')).toBeNull())
    expect(setMemberships).not.toHaveBeenCalled()
  })
})

describe('NhanLucScreen — employees, as before (Rv4, Rv5)', () => {
  it('retires and brings back from the Đang làm switch, without deleting anything', async () => {
    renderScreen()
    await screen.findByText('Lê Văn A')
    await userEvent.click(screen.getByRole('switch', { name: 'Đang làm · Lê Văn A' }))
    await waitFor(() => expect(updateEmployee).toHaveBeenCalledWith('e1', { active: false }))
    expect(await screen.findByText('Đã tắt khỏi danh sách chọn')).toBeInTheDocument()

    await chooseOption('Trạng thái', 'Đã nghỉ', bar())
    await apply()
    await userEvent.click(screen.getByRole('switch', { name: 'Đang làm · Trần Thị B' }))
    await waitFor(() => expect(updateEmployee).toHaveBeenCalledWith('e2', { active: true }))
  })

  it('renames one person', async () => {
    renderScreen()
    await screen.findByText('Lê Văn A')
    await userEvent.click(within(rowOf('Lê Văn A')).getByRole('button', { name: 'Sửa tên' }))
    const name = await screen.findByLabelText('Họ tên')
    await userEvent.clear(name)
    await userEvent.type(name, 'Lê Văn A2')
    await userEvent.click(screen.getByRole('button', { name: 'Lưu' }))
    await waitFor(() => expect(updateEmployee).toHaveBeenCalledWith('e1', { fullName: 'Lê Văn A2' }))
    expect(await screen.findByText('Đã đổi tên')).toBeInTheDocument()
  })

  it('refuses a rename onto a name already on the list, beside the field', async () => {
    renderScreen()
    await screen.findByText('Lê Văn A')
    await userEvent.click(within(rowOf('Lê Văn A')).getByRole('button', { name: 'Sửa tên' }))
    const name = await screen.findByLabelText('Họ tên')
    await userEvent.clear(name)
    await userEvent.type(name, 'gs một')
    await userEvent.click(screen.getByRole('button', { name: 'Lưu' }))
    expect(await screen.findByText('Đã có tài khoản GS/Visitor tên "gs một".')).toBeInTheDocument()
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
    expect(within(dialog).getByText('Nhân viên không đăng nhập; GS chọn họ làm nhóm trưởng hoặc thợ chính khi ghi tiến độ và không sửa được danh sách.')).toBeInTheDocument()
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
    expect(within(dialog).getByText('GS đăng nhập trên tablet và ghi tiến độ ở các dự án được gán.')).toBeInTheDocument()
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

describe('NhanLucScreen — Đổi phân quyền (NL-04)', () => {
  const openChange = async (name: string) => {
    await userEvent.click(within(rowOf(name)).getByRole('button', { name: 'Đổi phân quyền' }))
    return screen.findByRole('dialog', { name: `Đổi phân quyền · ${name}` })
  }
  const pickNew = async (dialog: HTMLElement, label: string) =>
    userEvent.click(within(within(dialog).getByRole('radiogroup', { name: 'Phân quyền mới' })).getByLabelText(label))
  const next = (dialog: HTMLElement) => userEvent.click(within(dialog).getByRole('button', { name: 'Tiếp tục' }))

  it('turns an employee into a GS after saying what happens, with a new login', async () => {
    listProjectNames.mockResolvedValue(PROJECTS)
    changeRole.mockResolvedValue({ userId: 'u5', username: 'gs.a', reactivated: false })
    renderScreen()
    await screen.findByText('Lê Văn A')
    const dialog = await openChange('Lê Văn A')
    expect(within(dialog).getByRole('radio', { name: 'Nhân viên' })).toBeChecked()
    expect(within(dialog).getByRole('button', { name: 'Tiếp tục' })).toBeDisabled()
    await pickNew(dialog, 'GS')
    await userEvent.type(within(dialog).getByLabelText('Tên đăng nhập'), 'gs.a')
    await userEvent.type(within(dialog).getByLabelText('Mật khẩu'), 'Bh7@Deck2026')
    await chooseOption('Dự án', 'BB1', dialog)
    await next(dialog)

    expect(await screen.findByText('Đổi Lê Văn A thành GS?')).toBeInTheDocument()
    expect(screen.getByText('Tài khoản mới gs.a')).toBeInTheDocument()
    expect(screen.getByText(/không còn trong ô chọn nhóm trưởng, thợ chính của GS/)).toBeInTheDocument()
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
    expect(screen.getByText(/không tạo tài khoản thứ hai/)).toBeInTheDocument()
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
    expect(await screen.findByText('Tài khoản sẽ bị khoá và ẩn, không bị xoá:')).toBeInTheDocument()
    expect(screen.getByText(/lịch sử ghi nhận vẫn mang tên người này/)).toBeInTheDocument()
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
    expect(await screen.findByText(/không ghi được tiến độ nữa/)).toBeInTheDocument()
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
    expect(within(confirm).getByText(/nút «Dự án và công việc»/)).toBeInTheDocument()
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
    expect(within(dialog).getByRole('button', { name: 'Tiếp tục' })).toBeDisabled()
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
    expect(await within(dialog).findByText('Tên đăng nhập này đã có người dùng')).toBeInTheDocument()
    expect(dialog).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Tiếp tục' })).toBeEnabled()
    expect(within(dialog).getByLabelText('Tên đăng nhập')).toHaveValue('da.co')
    expect(within(dialog).getByLabelText('Mật khẩu')).toHaveValue('Bh7@Deck2026')
  })
})

describe('NhanLucScreen — rules (RUL-01, CPY-05)', () => {
  it('states each role in the words the create dialog uses, and the list\'s own rules', async () => {
    renderScreen()
    await screen.findByText('gs1')
    expect(screen.queryByText(/GS đăng nhập trên tablet/)).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: /Quy tắc áp dụng/ }))
    for (const text of [
      'Nhân viên không đăng nhập; GS chọn họ làm nhóm trưởng hoặc thợ chính khi ghi tiến độ và không sửa được danh sách.',
      'GS đăng nhập trên tablet và ghi tiến độ ở các dự án được gán.',
      'Visitor đăng nhập, xem mọi dự án và mọi công việc, tải được báo cáo nhưng không ghi được gì.',
    ]) expect(screen.getByText(text)).toBeInTheDocument()
    expect(screen.getByText(/^Mỗi người chỉ có một dòng/)).toBeInTheDocument()
    expect(screen.getByText(/^Tắt Đang làm thì người đó không còn trong ô chọn của GS/)).toBeInTheDocument()
    expect(screen.getByText(/^Tài khoản chỉ bị khoá hoặc ẩn, không bị xoá/)).toBeInTheDocument()
    expectNoSpecIds()
  })
})
