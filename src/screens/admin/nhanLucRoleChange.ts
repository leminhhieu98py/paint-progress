import type { ConsequenceItem, ConsequenceTone } from '../../components/ConsequenceModal'
import type { changeRole, StaffRole } from '../../lib/adminApi'
import { ROLE_LABEL, parkedAccountFor, type StaffRow } from './nhanLuc'
import type { ProjectOption } from './nhanLucForm'

export type RoleChangeRequest = Parameters<typeof changeRole>[0]

/** A confirmation: who it is about, then what happens, one item each (RUL-01). */
export interface Confirmation {
  tone: ConsequenceTone
  tag?: string
  title: string
  description: string
  items: ConsequenceItem[]
  consequences: string[]
}

/** What the change-role step needs from the form (NL-04). */
export interface RoleChangeValues {
  role: StaffRole
  username?: string
  password?: string
  projectId?: string
}

/**
 * "Đổi phân quyền" (NL-04), as the edit dialog runs it (NL-09): the request
 * the Edge Function takes, and the confirmation that says exactly what will
 * happen. Nhân viên → GS/Visitor carries a login and a password (only the
 * password when a hidden account of the same name is re-opened, ruling A1)
 * and a project for a GS. GS/Visitor → Nhân viên locks and hides the account.
 * Visitor → GS names every project the account will write to.
 */
export function planRoleChange(
  row: StaffRow, rows: StaffRow[], projects: ProjectOption[], values: RoleChangeValues,
): { request: RoleChangeRequest; confirmation: Confirmation } {
  const role = values.role
  const parked = row.kind === 'employee' && role !== 'employee' ? parkedAccountFor(rows, row.fullName) : null
  const needsProject = role === 'gs' && (row.kind === 'employee' || row.role === 'viewer')
  const request: RoleChangeRequest = { kind: row.kind, id: row.id, role }
  if (row.kind === 'employee' && role !== 'employee') {
    if (!parked) request.username = (values.username ?? '').trim().toLowerCase()
    request.password = values.password
  }
  if (needsProject) request.projectId = values.projectId
  const projectName = projects.find((p) => p.value === values.projectId)?.label ?? ''
  const scope = role === 'gs' ? projectName : 'Mọi dự án'

  if (row.kind === 'employee') {
    return {
      request,
      confirmation: parked
        ? {
            tone: 'warn',
            title: `Đổi ${row.fullName} thành ${ROLE_LABEL[role]}?`,
            description: 'Dòng nhân viên được thay bằng tài khoản đã ẩn cùng tên:',
            items: [{ label: `Mở lại tài khoản ${parked.username}`, meta: scope }],
            consequences: [
              'Tài khoản cũ mở khoá với mật khẩu mới',
              'Không còn trong ô chọn nhóm trưởng, thợ chính của GS',
              'Các lần cập nhật đã ghi vẫn giữ tên',
            ],
          }
        : {
            tone: 'warn',
            title: `Đổi ${row.fullName} thành ${ROLE_LABEL[role]}?`,
            description: 'Dòng nhân viên được thay bằng tài khoản:',
            items: [{ label: `Tài khoản mới ${request.username}`, meta: scope }],
            consequences: [
              'Đăng nhập được bằng tài khoản mới',
              'Không còn trong ô chọn nhóm trưởng, thợ chính của GS',
              'Các lần cập nhật đã ghi vẫn giữ tên',
            ],
          },
    }
  }
  const who = { label: row.fullName, meta: row.account.username }
  if (role === 'employee') {
    return {
      request,
      confirmation: {
        tone: 'danger',
        title: `Đổi ${row.account.username} thành Nhân viên?`,
        description: 'Tài khoản bị khoá và ẩn, không bị xoá:',
        items: [who],
        consequences: [
          // The same lock as Khoá: the change sets active = false (staff.ts).
          'Mất quyền truy cập ngay, cả máy tính bảng đang mở cũng ngừng ghi tiến độ',
          'Lịch sử ghi nhận vẫn mang tên người này',
          'Một nhân viên đang làm cùng tên được thêm vào ô chọn của GS',
          'Đổi lại thành GS hoặc Visitor là mở lại đúng tài khoản này',
        ],
      },
    }
  }
  if (role === 'viewer') {
    return {
      request,
      confirmation: {
        tone: 'warn',
        title: `Đổi ${row.account.username} thành Visitor?`,
        description: 'Phân quyền của tài khoản đổi thành Visitor:',
        items: [who],
        consequences: [
          'Xem được mọi dự án và công việc',
          'Không ghi được tiến độ nữa',
          // Memberships are kept across GS ↔ Visitor, unused while a Visitor.
          'Dự án đã gán được giữ lại, không dùng khi là Visitor',
        ],
      },
    }
  }
  // Memberships are kept across GS ↔ Visitor, so a Visitor becoming a GS
  // writes again to every project it ever held -- listed, not implied.
  const kept = row.account.projects
  return {
    request,
    confirmation: {
      tone: 'warn',
      title: `Đổi ${row.account.username} thành GS?`,
      description: 'Tài khoản thành GS, ghi được tiến độ ở các dự án này:',
      items: [
        ...(kept.some((p) => p.id === values.projectId) ? [] : [{ label: scope, meta: 'mới gán' }]),
        ...kept.map((p) => ({
          label: p.name,
          meta: p.allWorks ? 'giữ lại · mọi công việc' : `giữ lại · ${p.workIds.length}/${p.workCount} công việc`,
        })),
      ],
      consequences: [
        // A Visitor sees every project (0034); a GS only its own.
        'Không còn xem được dự án ngoài các dự án trên',
        'Bỏ bớt dự án ở mục «Dự án và công việc» của hộp Sửa sau khi đổi',
      ],
    },
  }
}

/** The toast after a role change. */
export function roleChangeMessage(row: StaffRow, request: RoleChangeRequest, result: { reactivated?: boolean; username?: string }): string {
  if (row.kind === 'employee') {
    return `${result.reactivated ? 'Đã mở lại tài khoản' : 'Đã tạo tài khoản'} ${result.username ?? ''}`.trim()
  }
  return request.role === 'employee' ? 'Đã chuyển thành nhân viên' : 'Đã đổi phân quyền'
}
