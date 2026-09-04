import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderApp } from '../../test/renderApp'
import { UsersScreen } from './UsersScreen'

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
const listProjectNames = vi.fn()
const listWorks = vi.fn()

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
}))

vi.mock('../../lib/projectsApi', () => ({
  listProjectNames: () => listProjectNames(),
}))

vi.mock('../../lib/worksApi', () => ({
  listWorks: (projectId: string) => listWorks(projectId),
}))

/** A membership as listGsUsers returns it since 0028: every work, unless said otherwise. */
const member = (id: string, name: string, over: Partial<{ allWorks: boolean; workIds: string[]; workCount: number }> = {}) =>
  ({ id, name, allWorks: true, workIds: [], workCount: 2, ...over })

vi.mock('../../auth/AuthProvider', () => ({
  useAuth: () => ({
    profile: { id: 'a1', username: 'admin.linh', fullName: 'Nguyễn Thị Linh', role: 'admin', active: true },
  }),
}))

beforeEach(() => {
  listGsUsers.mockReset()
  revealPassword.mockReset()
  setPassword.mockReset()
  setPassword.mockResolvedValue(undefined)
  deactivateGsUser.mockReset()
  listProjectNames.mockReset()
  deactivateGsUser.mockResolvedValue(undefined)
  listProjectNames.mockResolvedValue([])
  for (const m of [createGsUser, reactivateUser, renameUser, hideUser, unhideUser, setMemberships, listWorks]) {
    m.mockReset()
    m.mockResolvedValue(undefined)
  }
  createGsUser.mockResolvedValue('u-new')
  listWorks.mockResolvedValue([])
  // Two rows so a reveal-the-wrong-row bug in the per-row `revealed[user.id]`
  // keying would actually show up in a test, instead of being masked by a
  // fixture with only one row to get right. Ids deliberately do not coincide
  // with the rows' array indices (0/1): if `revealed` (or any future per-row
  // state) were ever keyed by index instead of user.id, a fixture using '0'/'1'
  // -shaped ids like 'u1'/'u2' would still pass by accident.
  listGsUsers.mockResolvedValue([
    {
      id: 'u7', username: 'gs1', fullName: 'GS Một', active: true, role: 'gs', hidden: false,
      projects: [member('p1', 'BB1')],
    },
    {
      id: 'u9', username: 'gs2', fullName: 'GS Hai', active: true, role: 'viewer', hidden: false,
      projects: [member('p2', 'BB2')],
    },
  ])
})

describe('UsersScreen', () => {
  it('lists GS accounts', async () => {
    renderApp(<UsersScreen />)
    expect(await screen.findByText('gs1')).toBeInTheDocument()
    expect(screen.getByText('GS Một')).toBeInTheDocument()
    expect(screen.getByText('BB1')).toBeInTheDocument()
  })

  it('shows every project a GS covers, collapsing the tail into a count', async () => {
    listGsUsers.mockResolvedValue([
      {
        id: 'u7', username: 'gs1', fullName: 'GS Một', active: true, role: 'gs', hidden: false,
        projects: [
          member('p1', 'Bạch Hổ BH-7'),
          member('p2', 'Rạng Đông RD-2'),
          member('p3', 'Đại Hùng DH-1'),
        ],
      },
    ])
    renderApp(<UsersScreen />)
    expect(await screen.findByText('Bạch Hổ BH-7')).toBeInTheDocument()
    expect(screen.getByText('Rạng Đông RD-2')).toBeInTheDocument()
    expect(screen.getByText('+1')).toBeInTheDocument()
  })

  it('says so rather than rendering an empty cell for an unassigned account', async () => {
    listGsUsers.mockResolvedValue([
      { id: 'u7', username: 'gs1', fullName: 'GS Một', active: true, role: 'gs', hidden: false, projects: [] },
    ])
    renderApp(<UsersScreen />)
    await screen.findByText('gs1')
    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('does not render any password before it is requested', async () => {
    revealPassword.mockResolvedValue('s3cret')
    renderApp(<UsersScreen />)
    await screen.findByText('gs1')
    expect(screen.queryByText('s3cret')).toBeNull()
    expect(revealPassword).not.toHaveBeenCalled()
  })

  it('reveals a password only for the row that was clicked', async () => {
    revealPassword.mockImplementation((id: string) =>
      Promise.resolve(id === 'u7' ? 's3cret' : 'other-secret'),
    )
    renderApp(<UsersScreen />)
    await screen.findByText('gs1')

    await userEvent.click(screen.getAllByRole('button', { name: 'Xem mật khẩu' })[0])

    await waitFor(() => expect(screen.getByText('s3cret')).toBeInTheDocument())
    expect(revealPassword).toHaveBeenCalledWith('u7')
    expect(revealPassword).not.toHaveBeenCalledWith('u9')
    expect(screen.queryByText('other-secret')).toBeNull()
  })

  it('names the account, the admin and the moment beside the revealed password', async () => {
    // The screen claims the reveal was logged. It has to show the same facts
    // the log row holds, or the claim is decoration.
    revealPassword.mockResolvedValue('s3cret')
    renderApp(<UsersScreen />)
    await screen.findByText('gs1')
    await userEvent.click(screen.getAllByRole('button', { name: 'Xem mật khẩu' })[0])

    expect(await screen.findByText(/Đã ghi log/)).toHaveTextContent('Nguyễn Thị Linh → gs1')
  })

  it('takes the revealed password off screen when the dialog is closed', async () => {
    // It used to sit in a table cell for the rest of the mount. This screen is
    // used with the customer's own staff in the room.
    //
    // Asserted with no waitFor on purpose: the point is that the secret leaves
    // the DOM on the same tick, not once a fade-out has finished.
    revealPassword.mockResolvedValue('s3cret')
    renderApp(<UsersScreen />)
    await screen.findByText('gs1')

    await userEvent.click(screen.getAllByRole('button', { name: 'Xem mật khẩu' })[0])
    await waitFor(() => expect(screen.getByText('s3cret')).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: 'Đã ghi nhận' }))

    // eslint-disable-next-line no-console
    await waitFor(() => expect(screen.queryByText('s3cret')).toBeNull())
  })

  it('shows an error when reveal fails', async () => {
    revealPassword.mockRejectedValue(new Error('No stored credential'))
    renderApp(<UsersScreen />)
    await screen.findByText('gs1')

    await userEvent.click(screen.getAllByRole('button', { name: 'Xem mật khẩu' })[0])

    expect(await screen.findByText('No stored credential')).toBeInTheDocument()
  })

  it('locks only after the consequences have been confirmed', async () => {
    // Pressing the row action must not call the API. Someone "simplifying" the
    // dialog away would skip the step that tells the admin what a lock does.
    renderApp(<UsersScreen />)
    await screen.findByText('gs1')

    await userEvent.click(screen.getAllByRole('button', { name: 'Khoá tài khoản' })[0])
    expect(deactivateGsUser).not.toHaveBeenCalled()
    expect(await screen.findByText(/mở khoá là dùng lại được/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /Vẫn khoá/ }))
    await waitFor(() => expect(deactivateGsUser).toHaveBeenCalledWith('u7'))
  })

  it('offers unlock, not lock, on a locked account', async () => {
    listGsUsers.mockResolvedValue([
      { id: 'u9', username: 'gs2', fullName: 'GS Hai', active: false, role: 'gs', hidden: false, projects: [] },
    ])
    renderApp(<UsersScreen />)
    await screen.findByText('gs2')
    expect(screen.getByText('Đã khoá')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Khoá tài khoản' })).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Mở khoá' }))
    await waitFor(() => expect(reactivateUser).toHaveBeenCalledWith('u9'))
    expect(await screen.findByText('Đã mở khoá tài khoản')).toBeInTheDocument()
  })

  it('hands the new password straight to the reveal dialog after a reset', async () => {
    // The admin has to read the value out to the foreman. Setting it and then
    // showing nothing leaves them with a password nobody knows.
    renderApp(<UsersScreen />)
    await screen.findByText('gs1')

    await userEvent.click(screen.getAllByRole('button', { name: 'Đổi mật khẩu' })[0])
    await userEvent.type(screen.getByLabelText('Mật khẩu mới'), 'Bh7@Deck2026')
    await userEvent.click(screen.getByRole('button', { name: 'Lưu' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Vẫn đổi' }))

    await waitFor(() => expect(setPassword).toHaveBeenCalledWith('u7', 'Bh7@Deck2026'))
    expect(await screen.findByText('Bh7@Deck2026')).toBeInTheDocument()
  })

  it('refuses a password too short to survive being guessed', async () => {
    // The admin types this by hand to hand to a foreman, and with nothing but
    // "required" in front of them what actually appears is 123456 or the site
    // name. A GS account that is guessed can write cells.stage_id -- the
    // numbers the customer is billed against.
    renderApp(<UsersScreen />)
    await screen.findByText('gs1')
    await userEvent.click(screen.getAllByRole('button', { name: 'Đổi mật khẩu' })[0])
    await userEvent.type(screen.getByLabelText('Mật khẩu mới'), 'gs2024')
    await userEvent.click(screen.getByRole('button', { name: 'Lưu' }))

    expect(await screen.findByText(/Tối thiểu 12 ký tự/)).toBeInTheDocument()
    expect(setPassword).not.toHaveBeenCalled()
  })

  it('offers a generated password, so nobody has to invent one', async () => {
    // The real fix for weak passwords is not a rule the admin fights -- it is
    // not asking them to think of one. Four random words are long, typo-proof
    // over a radio, and nothing like the site name.
    renderApp(<UsersScreen />)
    await screen.findByText('gs1')
    await userEvent.click(screen.getAllByRole('button', { name: 'Đổi mật khẩu' })[0])
    await userEvent.click(screen.getByRole('button', { name: 'Sinh mật khẩu' }))

    const field = screen.getByLabelText('Mật khẩu mới') as HTMLInputElement
    expect(field.value.length).toBeGreaterThanOrEqual(12)
  })

  it('warns that a reset locks the GS out before it writes the new password', async () => {
    // The foreman is on a platform with the old password in his pocket. The
    // reset takes effect the instant it is written, and nothing tells him --
    // so the admin has to be told, before the write, not after.
    renderApp(<UsersScreen />)
    await screen.findByText('gs1')

    await userEvent.click(screen.getAllByRole('button', { name: 'Đổi mật khẩu' })[0])
    await userEvent.type(screen.getByLabelText('Mật khẩu mới'), 'Bh7@Deck2026')
    await userEvent.click(screen.getByRole('button', { name: 'Lưu' }))

    expect(await screen.findByText('Đổi mật khẩu cho gs1?')).toBeInTheDocument()
    expect(setPassword).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Vẫn đổi' }))
    await waitFor(() => expect(setPassword).toHaveBeenCalledWith('u7', 'Bh7@Deck2026'))
  })

  it('says the reset landed, not only that a password appeared', async () => {
    renderApp(<UsersScreen />)
    await screen.findByText('gs1')
    await userEvent.click(screen.getAllByRole('button', { name: 'Đổi mật khẩu' })[0])
    await userEvent.type(screen.getByLabelText('Mật khẩu mới'), 'Bh7@Deck2026')
    await userEvent.click(screen.getByRole('button', { name: 'Lưu' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Vẫn đổi' }))

    expect(await screen.findByText('Đã đặt lại mật khẩu')).toBeInTheDocument()
  })

  it('says the account was locked, so the row going grey is not the only signal', async () => {
    renderApp(<UsersScreen />)
    await screen.findByText('gs1')
    await userEvent.click(screen.getAllByRole('button', { name: 'Khoá tài khoản' })[0])
    await userEvent.click(await screen.findByRole('button', { name: 'Vẫn khoá' }))

    await waitFor(() => expect(deactivateGsUser).toHaveBeenCalled())
    expect(await screen.findByText('Đã khoá tài khoản')).toBeInTheDocument()
  })
})

describe('UsersScreen — Feedback Rv2 (0028)', () => {
  it('names each account\'s type, and a restricted membership\'s work count', async () => {
    listGsUsers.mockResolvedValue([
      {
        id: 'u7', username: 'gs1', fullName: 'GS Một', active: true, role: 'gs', hidden: false,
        projects: [member('p1', 'BB1', { allWorks: false, workIds: ['w1'], workCount: 3 })],
      },
      {
        id: 'u9', username: 'boss', fullName: 'Sếp', active: true, role: 'viewer', hidden: false,
        projects: [member('p2', 'BB2')],
      },
    ])
    renderApp(<UsersScreen />)
    await screen.findByText('gs1')
    expect(screen.getByText('GS')).toBeInTheDocument()
    expect(screen.getByText('Chỉ xem')).toBeInTheDocument()
    expect(screen.getByText('BB1 · 1/3 công việc')).toBeInTheDocument()
    expect(screen.getByText('BB2')).toBeInTheDocument()
  })

  it('creates a viewer when the admin picks Chỉ xem', async () => {
    listProjectNames.mockResolvedValue([{ id: 'p1', name: 'BB1', code: 'BB1' }])
    renderApp(<UsersScreen />)
    await screen.findByText('gs1')
    await userEvent.click(screen.getByRole('button', { name: 'Tạo tài khoản' }))
    await userEvent.click(await screen.findByText('Chỉ xem', { selector: '.ant-segmented-item-label' }))
    await userEvent.type(screen.getByLabelText('Tên đăng nhập'), 'sep.a')
    await userEvent.type(screen.getByLabelText('Họ tên'), 'Sếp A')
    await userEvent.type(screen.getByLabelText('Mật khẩu'), 'Bh7@Deck2026')
    await userEvent.click(screen.getByRole('combobox', { name: 'Dự án' }))
    await userEvent.click(await screen.findByTitle('BB1'))
    await userEvent.click(screen.getByRole('button', { name: 'Tạo' }))

    await waitFor(() => expect(createGsUser).toHaveBeenCalledWith(expect.objectContaining({
      username: 'sep.a', fullName: 'Sếp A', projectId: 'p1', role: 'viewer',
    })))
  })

  it('renames a login from the pencil beside it', async () => {
    renderApp(<UsersScreen />)
    await screen.findByText('gs1')
    await userEvent.click(screen.getAllByRole('button', { name: 'Đổi tên đăng nhập' })[0])
    const field = await screen.findByLabelText('Tên đăng nhập mới')
    await userEvent.clear(field)
    await userEvent.type(field, 'gs.moi')
    await userEvent.click(screen.getByRole('button', { name: 'Lưu' }))

    await waitFor(() => expect(renameUser).toHaveBeenCalledWith('u7', 'gs.moi'))
    expect(await screen.findByText('Đã đổi tên đăng nhập')).toBeInTheDocument()
  })

  it('hides an account after confirming, and shows hidden ones on request', async () => {
    renderApp(<UsersScreen />)
    await screen.findByText('gs1')
    await userEvent.click(screen.getAllByRole('button', { name: 'Ẩn tài khoản' })[0])
    expect(hideUser).not.toHaveBeenCalled()
    await userEvent.click(await screen.findByRole('button', { name: 'Vẫn ẩn' }))
    await waitFor(() => expect(hideUser).toHaveBeenCalledWith('u7'))

    listGsUsers.mockResolvedValue([
      { id: 'u7', username: 'gs1', fullName: 'GS Một', active: false, role: 'gs', hidden: true, projects: [] },
    ])
    await userEvent.click(screen.getByRole('switch', { name: 'Hiện tài khoản đã ẩn' }))
    await waitFor(() => expect(listGsUsers).toHaveBeenLastCalledWith(true))
    expect(await screen.findByText('Đã ẩn')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Hiện lại' }))
    await waitFor(() => expect(unhideUser).toHaveBeenCalledWith('u7'))
  })

  it('saves project membership and the works within it from one dialog', async () => {
    listProjectNames.mockResolvedValue([
      { id: 'p1', name: 'BB1', code: 'BB1' }, { id: 'p2', name: 'BB2', code: 'BB2' },
    ])
    listWorks.mockImplementation((projectId: string) => Promise.resolve(
      projectId === 'p1'
        ? [{ id: 'w1', name: 'Sơn' }, { id: 'w2', name: 'Tháo giáo' }]
        : [{ id: 'w3', name: 'Chứng từ' }],
    ))
    renderApp(<UsersScreen />)
    await screen.findByText('gs1')
    await userEvent.click(screen.getAllByRole('button', { name: 'Phân quyền' })[0])

    // gs1 is in BB1 with every work: restrict it to Sơn, and add BB2 whole.
    await userEvent.click(await screen.findByRole('switch', { name: 'Tất cả công việc BB1' }))
    await userEvent.click(screen.getByRole('combobox', { name: 'Công việc BB1' }))
    await userEvent.click(await screen.findByTitle('Sơn'))
    await userEvent.click(screen.getByRole('checkbox', { name: 'Thành viên BB2' }))
    await userEvent.click(screen.getByRole('button', { name: 'Lưu quyền' }))

    await waitFor(() => expect(setMemberships).toHaveBeenCalledWith('u7', [
      { projectId: 'p1', allWorks: false, workIds: ['w1'] },
      { projectId: 'p2', allWorks: true, workIds: [] },
    ]))
    expect(await screen.findByText('Đã cập nhật quyền')).toBeInTheDocument()
  })
})
