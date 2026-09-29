import { MIN_PASSWORD_LENGTH } from '../../lib/passwordGen'
import { ROLE_LABEL } from './nhanLuc'

/** The form pieces the two Nhân lực dialogs share (NL-02, NL-04). */

export interface ProjectOption {
  value: string
  label: string
}

export const ROLE_RADIOS = (['employee', 'gs', 'viewer'] as const).map((value) => ({ value, label: ROLE_LABEL[value] }))

/** The login rule the Edge Function enforces, said before the round trip. */
export const USERNAME_RULES = [
  { required: true, message: 'Nhập tên đăng nhập' },
  { pattern: /^[a-z0-9._-]{3,32}$/i, message: 'Chỉ chữ, số, dấu chấm, gạch ngang, gạch dưới (3-32 ký tự)' },
]

export const PASSWORD_RULES = [
  { required: true, message: 'Nhập mật khẩu' },
  { min: MIN_PASSWORD_LENGTH, message: `Tối thiểu ${MIN_PASSWORD_LENGTH} ký tự` },
]

/** A form rule from one of nhanLuc.ts's checks: the message it returns, or pass. */
export const clashRule = (check: (value: string) => string | null) => ({
  validator: (_: unknown, value: unknown) => {
    const problem = typeof value === 'string' ? check(value) : null
    return problem ? Promise.reject(new Error(problem)) : Promise.resolve()
  },
})

/**
 * antd's Radio.Group renders a plain div: without a role, a screen reader
 * hears three radios and no question. It forwards `role` to that div (rc-util
 * pickAttrs) but does not type it, hence a spread rather than an attribute.
 */
export const RADIOGROUP = { role: 'radiogroup' }
