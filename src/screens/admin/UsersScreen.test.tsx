import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderApp } from '../../test/renderApp'
import { UsersScreen } from './UsersScreen'

const listGsUsers = vi.fn()
const revealPassword = vi.fn()
const setPassword = vi.fn()
const deactivateGsUser = vi.fn()
const listProjectNames = vi.fn()

vi.mock('../../lib/adminApi', () => ({
  listGsUsers: () => listGsUsers(),
  revealPassword: (id: string) => revealPassword(id),
  createGsUser: vi.fn(),
  setPassword: (id: string, pw: string) => setPassword(id, pw),
  deactivateGsUser: (id: string) => deactivateGsUser(id),
}))

vi.mock('../../lib/projectsApi', () => ({
  listProjectNames: () => listProjectNames(),
}))

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
  // Two rows so a reveal-the-wrong-row bug in the per-row `revealed[user.id]`
  // keying would actually show up in a test, instead of being masked by a
  // fixture with only one row to get right. Ids deliberately do not coincide
  // with the rows' array indices (0/1): if `revealed` (or any future per-row
  // state) were ever keyed by index instead of user.id, a fixture using '0'/'1'
  // -shaped ids like 'u1'/'u2' would still pass by accident.
  listGsUsers.mockResolvedValue([
    {
      id: 'u7', username: 'gs1', fullName: 'GS Một', active: true,
      projects: [{ id: 'p1', name: 'BB1' }],
    },
    {
      id: 'u9', username: 'gs2', fullName: 'GS Hai', active: true,
      projects: [{ id: 'p2', name: 'BB2' }],
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
        id: 'u7', username: 'gs1', fullName: 'GS Một', active: true,
        projects: [
          { id: 'p1', name: 'Bạch Hổ BH-7' },
          { id: 'p2', name: 'Rạng Đông RD-2' },
          { id: 'p3', name: 'Đại Hùng DH-1' },
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
      { id: 'u7', username: 'gs1', fullName: 'GS Một', active: true, projects: [] },
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

  it('deactivates only after the consequences have been confirmed', async () => {
    // Pressing the row action must not call the API. Someone "simplifying" the
    // dialog away would skip the only step that tells the admin the account
    // cannot be switched back on in this version.
    renderApp(<UsersScreen />)
    await screen.findByText('gs1')

    await userEvent.click(screen.getAllByRole('button', { name: 'Tắt tài khoản' })[0])
    expect(deactivateGsUser).not.toHaveBeenCalled()
    expect(await screen.findByText(/chưa bật lại được/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /Vẫn tắt/ }))
    await waitFor(() => expect(deactivateGsUser).toHaveBeenCalledWith('u7'))
  })

  it('offers no deactivate action on an account that is already off', async () => {
    listGsUsers.mockResolvedValue([
      { id: 'u9', username: 'gs2', fullName: 'GS Hai', active: false, projects: [] },
    ])
    renderApp(<UsersScreen />)
    await screen.findByText('gs2')
    expect(screen.getByText('Đã tắt')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Tắt tài khoản' })).toBeNull()
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

  it('says the account was switched off, so the row going grey is not the only signal', async () => {
    renderApp(<UsersScreen />)
    await screen.findByText('gs1')
    await userEvent.click(screen.getAllByRole('button', { name: 'Tắt tài khoản' })[0])
    await userEvent.click(await screen.findByRole('button', { name: 'Vẫn tắt' }))

    await waitFor(() => expect(deactivateGsUser).toHaveBeenCalled())
    expect(await screen.findByText('Đã tắt tài khoản')).toBeInTheDocument()
  })
})
