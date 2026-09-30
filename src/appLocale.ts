import viVN from 'antd/es/locale/vi_VN'

/**
 * The antd locale of the whole app: both ConfigProviders read it, the admin
 * one at the root (App.tsx) and the field theme's nested ones, which inherit
 * it. From antd's ES build: the CommonJS entry `antd/locale/vi_VN` reached
 * the production bundle wrapped as `{ default, __esModule }`, and the pager
 * fell back to English "10 / page" (AD3).
 */
export const appLocale = viVN
