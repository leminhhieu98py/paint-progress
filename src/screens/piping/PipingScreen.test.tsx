import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ConfigProvider } from 'antd'
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effortDayKey } from '../../domain/effort'
import type { PipingSettings } from '../../domain/piping/types'
import { endSession } from '../../lib/sessionCache'
import { expectOneHeight } from '../../test/controls'
import { chooseOption } from '../../test/select'
import { renderApp } from '../../test/renderApp'
import { setViewport } from '../../test/viewport'
import { fieldTheme } from '../../theme'
import type { PipingPanelProps } from './panelProps'
import { PipingScreen } from './PipingScreen'

const api = vi.hoisted(() => ({
  getPipingSettings: vi.fn(),
  enablePiping: vi.fn(),
}))
// The settings read comes from its own module (pipingEnabled keeps the field chunks small).
vi.mock('../../lib/pipingApi/settings', () => ({
  getPipingSettings: (id: string) => api.getPipingSettings(id),
}))
vi.mock('../../lib/pipingApi', () => ({
  enablePiping: (id: string, input: unknown) => api.enablePiping(id, input),
}))
const listProjectNames = vi.hoisted(() => vi.fn())
vi.mock('../../lib/projectsApi', () => ({
  listProjectNames: () => listProjectNames(),
}))
const authRole = vi.hoisted(() => ({ value: 'admin' as 'admin' | 'gs' | 'viewer' }))
vi.mock('../../auth/AuthProvider', () => ({
  useAuth: () => ({
    profile: { id: 'u1', username: 'u1', fullName: 'Nguyễn Văn A', role: authRole.value, active: true },
    signOut: vi.fn(),
  }),
}))
// Cấu hình has its own suite; here whether it is offered (it is mounted while open) and what its callbacks do.
vi.mock('./PipingConfigModal', () => ({
  PipingConfigModal: ({ onChanged, onDisabled }: { onChanged: () => void; onDisabled: () => void }) => (
    <div>
      CẤU HÌNH MỞ
      <button type="button" onClick={onChanged}>đổi cấu hình</button>
      <button type="button" onClick={onDisabled}>đã tắt piping</button>
    </div>
  ),
}))

/** The three tab panels are later tasks' seams: the stand-ins print the props contract. */
const panel = vi.hoisted(() => (name: string) => (p: PipingPanelProps) => (
  <div data-testid={`${name}-panel`}>
    {JSON.stringify({
      projectId: p.projectId, enabled: p.settings.enabled, mode: p.mode, variant: p.variant, role: p.role,
      todayKey: p.todayKey, refreshKey: p.refreshKey,
    })}
  </div>
))
vi.mock('./ReinstatementPanel', () => ({ ReinstatementPanel: panel('reinstatement') }))
vi.mock('./ManpowerPanel', () => ({ ManpowerPanel: panel('manpower') }))
vi.mock('./InsulationPanel', () => ({ InsulationPanel: panel('insulation') }))

const settings = (over: Partial<PipingSettings> = {}): PipingSettings => ({
  projectId: 'p1', enabled: true, weekStartDate: '2026-09-07', totalTestPacks: 1022, lateThresholdDays: 7, ...over,
})

const props = (name: string) => JSON.parse(screen.getByTestId(`${name}-panel`).textContent ?? '{}')

function renderAdmin(path = '/admin/piping') {
  return renderApp(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/admin/piping" element={<PipingScreen variant="admin" />} />
      </Routes>
    </MemoryRouter>,
  )
}

function renderField(projectId = 'p1') {
  return renderApp(
    <ConfigProvider theme={fieldTheme}>
      <MemoryRouter initialEntries={[`/gs/${projectId}/piping`]}>
        <Routes>
          <Route path="/gs/:projectId/piping" element={<PipingScreen variant="gs" />} />
          <Route path="/gs/:projectId" element={<SanStandIn />} />
        </Routes>
      </MemoryRouter>
    </ConfigProvider>,
  )
}

/** The Sàn page a project switch lands on when the target has Piping off. */
function SanStandIn() {
  const { projectId } = useParams()
  return <div>SÀN của {projectId}</div>
}

const bar = () => screen.getAllByRole('search', { name: 'Bộ lọc' })[0]

beforeEach(() => {
  endSession()
  authRole.value = 'admin'
  api.getPipingSettings.mockReset()
  api.getPipingSettings.mockResolvedValue(settings())
  api.enablePiping.mockReset()
  api.enablePiping.mockResolvedValue(undefined)
  listProjectNames.mockReset()
  listProjectNames.mockResolvedValue([
    { id: 'p1', name: 'BlockB1_CPPTS', code: 'BB1' },
    { id: 'p2', name: 'Đại Hùng', code: 'DH' },
  ])
})

describe('PipingScreen admin: the page and its bar (spec §11)', () => {
  it('titles the page Piping and opens the first project, the project select first in the bar', async () => {
    renderAdmin()
    expect(screen.getByRole('heading', { level: 1, name: 'Piping' })).toBeInTheDocument()
    await waitFor(() => expect(api.getPipingSettings).toHaveBeenCalledWith('p1'))
    const controls = within(bar()).getAllByRole('combobox')
    expect(controls[0]).toHaveAccessibleName('Dự án')
  })

  it('opens the project named in ?project=', async () => {
    renderAdmin('/admin/piping?project=p2')
    await waitFor(() => expect(api.getPipingSettings).toHaveBeenCalledWith('p2'))
    expect(api.getPipingSettings).not.toHaveBeenCalledWith('p1')
  })

  it('shows the three navigation tabs, the Ngày | Tuần toggle, the export action and Cấu hình', async () => {
    renderAdmin()
    const tabs = await screen.findAllByRole('tab')
    expect(tabs.map((t) => t.textContent)).toEqual(['Reinstatement', 'Manpower', 'Insulation'])
    expect(within(bar()).getByText('Ngày')).toBeInTheDocument()
    expect(within(bar()).getByText('Tuần')).toBeInTheDocument()
    expect(within(bar()).getByRole('button', { name: 'Xuất báo cáo' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Cấu hình/ }))
    expect(screen.getByText('CẤU HÌNH MỞ')).toBeInTheDocument()
  })

  it('hands the panel the props contract, today read once at the page', async () => {
    renderAdmin()
    await screen.findByTestId('reinstatement-panel')
    expect(props('reinstatement')).toEqual({
      projectId: 'p1', enabled: true, mode: 'day', variant: 'admin', role: 'admin',
      todayKey: effortDayKey(new Date().toISOString()), refreshKey: 0,
    })
  })

  it('switches the view to Tuần for the panel, and the tab to Manpower and Insulation', async () => {
    renderAdmin()
    await screen.findByTestId('reinstatement-panel')
    await userEvent.click(within(bar()).getByText('Tuần'))
    expect(props('reinstatement').mode).toBe('week')
    await userEvent.click(screen.getByRole('tab', { name: 'Manpower' }))
    expect(props('manpower')).toMatchObject({ mode: 'week', projectId: 'p1' })
    await userEvent.click(screen.getByRole('tab', { name: 'Insulation' }))
    expect(props('insulation')).toMatchObject({ mode: 'week', projectId: 'p1' })
  })

  it('keeps every control of the bar at the theme\'s one height (CTL-02)', async () => {
    renderAdmin()
    await screen.findByTestId('reinstatement-panel')
    expectOneHeight(bar())
  })

  it('keeps the bar\'s controls in place, disabled, while another project\'s settings are read', async () => {
    renderAdmin()
    await screen.findByTestId('reinstatement-panel')
    let answer: (s: PipingSettings) => void = () => {}
    api.getPipingSettings.mockReturnValue(new Promise<PipingSettings>((resolve) => { answer = resolve }))
    await chooseOption('Dự án', 'Đại Hùng (DH)')
    expect(within(bar()).getByRole('button', { name: 'Xuất báo cáo' })).toBeDisabled()
    expect(within(bar()).getByText('Tuần').closest('.ant-segmented')).toHaveClass('ant-segmented-disabled')
    expect(screen.getByRole('button', { name: /Cấu hình/ })).toBeDisabled()
    answer(settings({ projectId: 'p2' }))
    expect(await screen.findByTestId('reinstatement-panel')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Cấu hình/ })).toBeEnabled()
  })

  it('reads the next project on a switch, keeping the tab and the view', async () => {
    renderAdmin()
    await screen.findByTestId('reinstatement-panel')
    await userEvent.click(within(bar()).getByText('Tuần'))
    await userEvent.click(screen.getByRole('tab', { name: 'Manpower' }))
    api.getPipingSettings.mockResolvedValue(settings({ projectId: 'p2' }))
    await chooseOption('Dự án', 'Đại Hùng (DH)')
    await waitFor(() => expect(props('manpower')).toMatchObject({ projectId: 'p2', mode: 'week' }))
    expect(api.getPipingSettings).toHaveBeenCalledWith('p2')
  })

  it('closes Cấu hình on a project switch', async () => {
    renderAdmin()
    await screen.findByTestId('reinstatement-panel')
    await userEvent.click(screen.getByRole('button', { name: /Cấu hình/ }))
    await chooseOption('Dự án', 'Đại Hùng (DH)')
    expect(screen.queryByText('CẤU HÌNH MỞ')).toBeNull()
  })

  it('raises refreshKey for the panels when Cấu hình changes something', async () => {
    renderAdmin()
    await screen.findByTestId('reinstatement-panel')
    await userEvent.click(screen.getByRole('button', { name: /Cấu hình/ }))
    await userEvent.click(screen.getByRole('button', { name: 'đổi cấu hình' }))
    await waitFor(() => expect(props('reinstatement').refreshKey).toBe(1))
    expect(screen.getByText('CẤU HÌNH MỞ')).toBeInTheDocument()
  })

  it('returns to the enable empty state when Cấu hình turns Piping off', async () => {
    renderAdmin()
    await screen.findByTestId('reinstatement-panel')
    await userEvent.click(screen.getByRole('button', { name: /Cấu hình/ }))
    api.getPipingSettings.mockResolvedValue(settings({ enabled: false }))
    await userEvent.click(screen.getByRole('button', { name: 'đã tắt piping' }))
    expect(await screen.findByText('Dự án này chưa bật Piping')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Bật Piping' })).toBeInTheDocument()
    expect(screen.queryByText('CẤU HÌNH MỞ')).toBeNull()
    expect(screen.queryByRole('tab')).toBeNull()
  })

  it('says when the settings could not be read, with a retry', async () => {
    api.getPipingSettings.mockRejectedValueOnce(new Error('mất mạng'))
    renderAdmin()
    expect(await screen.findByText('mất mạng')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Thử lại' }))
    expect(await screen.findByTestId('reinstatement-panel')).toBeInTheDocument()
  })
})

describe('PipingScreen admin: enabling (spec §2)', () => {
  beforeEach(() => {
    api.getPipingSettings.mockResolvedValue(null)
  })

  const dialog = () => screen.getByRole('dialog')
  const field = (label: string) => within(dialog()).getByLabelText(label)
  const submit = () => userEvent.click(within(dialog()).getByRole('button', { name: 'Bật Piping' }))

  it('offers Bật Piping on an empty state, with no tabs, toggle, export or Cấu hình', async () => {
    renderAdmin()
    expect(await screen.findByText('Dự án này chưa bật Piping')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Bật Piping' })).toBeInTheDocument()
    expect(screen.queryByRole('tab')).toBeNull()
    expect(screen.queryByText('Tuần')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Xuất báo cáo' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Cấu hình/ })).toBeNull()
  })

  it('requires the week start date (no default), then enables with the defaults and shows the tabs', async () => {
    renderAdmin()
    await userEvent.click(await screen.findByRole('button', { name: 'Bật Piping' }))
    expect(field('Ngày bắt đầu tuần')).toHaveValue('')
    expect(field('Ngưỡng trễ (ngày)')).toHaveValue('7')
    await submit()
    expect(await within(dialog()).findByText('Chọn ngày bắt đầu tuần')).toBeInTheDocument()
    expect(api.enablePiping).not.toHaveBeenCalled()

    await userEvent.type(field('Ngày bắt đầu tuần'), '07/09/2026{Enter}')
    await userEvent.type(field('Tổng Test Pack'), '1022')
    api.getPipingSettings.mockResolvedValue(settings())
    await submit()
    await waitFor(() => expect(api.enablePiping).toHaveBeenCalledWith('p1', {
      weekStartDate: '2026-09-07', totalTestPacks: 1022, lateThresholdDays: 7,
    }))
    expect(await screen.findByTestId('reinstatement-panel')).toBeInTheDocument()
    expect(screen.queryByText('Dự án này chưa bật Piping')).toBeNull()
  })

  it('leaves total Test Pack empty as not set', async () => {
    renderAdmin()
    await userEvent.click(await screen.findByRole('button', { name: 'Bật Piping' }))
    await userEvent.type(field('Ngày bắt đầu tuần'), '07/09/2026{Enter}')
    await submit()
    await waitFor(() => expect(api.enablePiping).toHaveBeenCalledWith('p1', {
      weekStartDate: '2026-09-07', totalTestPacks: null, lateThresholdDays: 7,
    }))
  })

  it('refuses a threshold outside 0..365 and a negative total', async () => {
    renderAdmin()
    await userEvent.click(await screen.findByRole('button', { name: 'Bật Piping' }))
    await userEvent.type(field('Ngày bắt đầu tuần'), '07/09/2026{Enter}')
    await userEvent.type(field('Tổng Test Pack'), '-5')
    await userEvent.clear(field('Ngưỡng trễ (ngày)'))
    await userEvent.type(field('Ngưỡng trễ (ngày)'), '366')
    await submit()
    expect(await within(dialog()).findByText('Ngưỡng trễ phải từ 0 đến 365 ngày')).toBeInTheDocument()
    expect(within(dialog()).getByText('Tổng Test Pack phải là số nguyên từ 0 trở lên')).toBeInTheDocument()
    expect(api.enablePiping).not.toHaveBeenCalled()
  })

  it('shows what the enable call refused, and keeps the dialog open', async () => {
    api.enablePiping.mockRejectedValue(new Error('Bạn không có quyền thực hiện thao tác này'))
    renderAdmin()
    await userEvent.click(await screen.findByRole('button', { name: 'Bật Piping' }))
    await userEvent.type(field('Ngày bắt đầu tuần'), '07/09/2026{Enter}')
    await submit()
    expect(await within(dialog()).findByText('Bạn không có quyền thực hiện thao tác này')).toBeInTheDocument()
  })

  it('re-enables a disabled project with its stored settings filled in', async () => {
    api.getPipingSettings.mockResolvedValue(settings({ enabled: false, totalTestPacks: 50, lateThresholdDays: 10 }))
    renderAdmin()
    await userEvent.click(await screen.findByRole('button', { name: 'Bật Piping' }))
    expect(field('Ngày bắt đầu tuần')).toHaveValue('07/09/2026')
    expect(field('Tổng Test Pack')).toHaveValue('50')
    expect(field('Ngưỡng trễ (ngày)')).toHaveValue('10')
  })
})

describe('PipingScreen field (gs, viewer): read the module, configure nothing', () => {
  let undoViewport = () => {}
  beforeEach(() => {
    undoViewport = setViewport(1024)
  })
  afterEach(() => undoViewport())

  it.each(['gs', 'viewer'] as const)('gives a %s the tabs and the toggle, its role to the panel, and no Cấu hình', async (role) => {
    authRole.value = role
    renderField()
    await screen.findByTestId('reinstatement-panel')
    expect(props('reinstatement')).toMatchObject({ projectId: 'p1', variant: 'gs', role, mode: 'day' })
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Reinstatement', 'Manpower', 'Insulation'])
    expect(screen.getByRole('combobox', { name: 'Dự án' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Xuất báo cáo' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Cấu hình/ })).toBeNull()
  })

  it.each([
    ['never enabled', null],
    ['disabled', settings({ enabled: false })],
  ])('tells the field the project has no Piping when it is %s, with no way to enable it', async (_case, answer) => {
    authRole.value = 'gs'
    api.getPipingSettings.mockResolvedValue(answer)
    renderField()
    expect(await screen.findByText('Dự án này chưa bật Piping')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Bật Piping' })).toBeNull()
    expect(screen.queryByRole('tab')).toBeNull()
    expect(screen.getByRole('combobox', { name: 'Dự án' })).toBeInTheDocument()
  })

  it('shows what is applied on a phone\'s one-line bar, the project and the view in the Bộ lọc sheet', async () => {
    undoViewport()
    undoViewport = setViewport(390)
    authRole.value = 'gs'
    renderField()
    await screen.findByTestId('reinstatement-panel')
    expect(await within(bar()).findByRole('button', { name: 'BB1 · Ngày' })).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'Dự án' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Xuất báo cáo' })).toBeInTheDocument()
    await userEvent.click(within(bar()).getByRole('button', { name: 'Bộ lọc' }))
    expect(await screen.findByRole('combobox', { name: 'Dự án' })).toBeInTheDocument()
    await userEvent.click(within(screen.getByRole('dialog')).getByText('Tuần'))
    expect(props('reinstatement').mode).toBe('week')
    expect(within(bar()).getByRole('button', { name: 'BB1 · Tuần' })).toBeInTheDocument()
  })

  it('keeps every control of the field bar at the field\'s one height (CTL-02)', async () => {
    renderField()
    await screen.findByTestId('reinstatement-panel')
    expectOneHeight(bar())
  })

  it('carries the view and the tab to another project with Piping on', async () => {
    renderField()
    await screen.findByTestId('reinstatement-panel')
    await userEvent.click(within(bar()).getByText('Tuần'))
    await userEvent.click(screen.getByRole('tab', { name: 'Insulation' }))
    api.getPipingSettings.mockResolvedValue(settings({ projectId: 'p2' }))
    await chooseOption('Dự án', 'Đại Hùng')
    await waitFor(() => expect(props('insulation')).toMatchObject({ projectId: 'p2', mode: 'week' }))
    expect(screen.getByRole('tab', { name: 'Insulation' })).toHaveAttribute('aria-selected', 'true')
  })

  it('lands on the Sàn page of a project whose Piping is off', async () => {
    renderField()
    await screen.findByTestId('reinstatement-panel')
    api.getPipingSettings.mockImplementation((id: string) => Promise.resolve(id === 'p2' ? null : settings()))
    await chooseOption('Dự án', 'Đại Hùng')
    expect(await screen.findByText('SÀN của p2')).toBeInTheDocument()
  })
})
