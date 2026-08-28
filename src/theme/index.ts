import type { ThemeConfig } from 'antd'

/**
 * The visual system, in one place.
 *
 * Every colour, radius and control height in this file comes from the two
 * approved prototypes in `claude-design/`. They are transcribed, not invented:
 * if a screen needs a shade that is not here, the prototype is the place to
 * look it up, and it gets added here rather than typed into a component.
 *
 * Two themes, because the two surfaces have opposite requirements. The admin
 * reads a lot of numbers on a laptop indoors and wants density. The foreman
 * taps bays through gloves in direct sun and wants size. They share the palette
 * so the product stays one product; they differ in scale.
 */

/** Raw values. Components import these for the things antd has no token for. */
export const palette = {
  accent: '#0A8175',
  accentHover: '#07655C',
  /** Tinted background behind a selected nav item, a badge, an accent chip. */
  accentTint: '#E8F6F3',
  /** Focus ring. Rendered as a 3px spread, never as a border. */
  accentRing: 'rgba(10, 129, 117, 0.18)',

  /** Reserved for "something happened just now" — a live dot, a note marker. */
  flame: '#F97316',

  text: '#16202B',
  textSecondary: '#4A5A6B',
  textTertiary: '#5F7183',
  textQuaternary: '#8698AA',

  bgApp: '#F8FAFC',
  /** Outside the app frame: the login page, the area around a device mock. */
  bgPage: '#F1F5F9',
  bgContainer: '#FFFFFF',
  /** A panel inside a card — table headers, footers, read-only rows. */
  bgSubtle: '#FCFDFE',
  bgSubtleAlt: '#F9FBFD',
  bgHover: '#F1F6FA',

  border: '#D5DFE9',
  borderCard: '#E8EEF4',
  borderSplit: '#F0F4F8',

  error: '#B42318',
  errorBg: '#FEF3F2',
  errorBorder: '#FECDCA',
  success: '#15803D',
  successBg: '#E7F8EF',
  warning: '#B45309',
  warningBg: '#FFFAEB',

  /** Tooltips and the "destructive" toggle, both near-black rather than black. */
  ink: '#1D2A38',

  /** The bar a progress track sits in. */
  track: '#E9EFF5',
} as const

/**
 * Field red is darker than admin red. On a tablet in sun the admin's #B42318
 * loses to the glare, and this is the colour on the button that walks a bay's
 * recorded progress backwards.
 */
export const fieldError = '#A50F0F'

export const fontFamily =
  "'Be Vietnam Pro', -apple-system, BlinkMacSystemFont, 'Helvetica Neue', Helvetica, Arial, sans-serif"

/**
 * Codes, timestamps and per-cell fractions only — never prose, and never a
 * number in a column that gets compared vertically (the UI font is already
 * tabular). Bay codes like R3C7 are read character by character off a drawing,
 * which is what this font is for.
 */
export const monoFamily = "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace"

/** Cards and panels. */
export const shadowCard = '0 1px 2px rgba(22, 32, 43, 0.04), 0 6px 18px -8px rgba(22, 32, 43, 0.08)'
/** Modals, popovers, toasts — anything that floats over the page. */
export const shadowPop = '0 28px 56px -18px rgba(22, 32, 43, 0.22), 0 4px 12px rgba(22, 32, 43, 0.05)'

const sharedTokens = {
  colorPrimary: palette.accent,
  colorInfo: palette.accent,
  colorSuccess: palette.success,
  colorWarning: palette.warning,
  colorError: palette.error,

  colorTextBase: palette.text,
  colorText: palette.text,
  colorTextSecondary: palette.textSecondary,
  colorTextTertiary: palette.textTertiary,
  colorTextQuaternary: palette.textQuaternary,

  colorBgLayout: palette.bgApp,
  colorBgContainer: palette.bgContainer,
  colorBgElevated: palette.bgContainer,

  colorBorder: palette.border,
  colorBorderSecondary: palette.borderCard,
  colorSplit: palette.borderSplit,

  fontFamily,
  boxShadow: shadowCard,
  boxShadowSecondary: shadowPop,

  // The prototypes use one weight for headings (600) and never go heavier than
  // 700, which is reserved for the two or three numbers per screen that are the
  // point of the screen.
  fontWeightStrong: 600,

  wireframe: false,
}

/**
 * Admin — laptop, indoors, dense.
 *
 * 13px base and 38px controls are what let A2 put two tables of different
 * weight on one screen, and A3.4 put two canvases and two tables in one panel.
 * Raising either one costs a column.
 */
export const adminTheme: ThemeConfig = {
  token: {
    ...sharedTokens,
    fontSize: 13,
    controlHeight: 38,
    borderRadius: 10,
    borderRadiusLG: 14,
    borderRadiusSM: 8,
    borderRadiusXS: 6,
    padding: 16,
    paddingLG: 20,
    margin: 16,
  },
  components: {
    Layout: {
      bodyBg: palette.bgApp,
      headerBg: palette.bgContainer,
      siderBg: palette.bgContainer,
      headerHeight: 48,
      headerPadding: '0 18px',
    },
    Menu: {
      itemBg: 'transparent',
      itemHeight: 40,
      itemBorderRadius: 10,
      itemMarginInline: 0,
      itemSelectedBg: palette.accentTint,
      itemSelectedColor: palette.accentHover,
      itemColor: palette.textTertiary,
      itemHoverBg: palette.bgHover,
      activeBarWidth: 0,
      activeBarBorderWidth: 0,
    },
    Table: {
      headerBg: palette.bgSubtleAlt,
      headerColor: palette.textTertiary,
      headerSplitColor: 'transparent',
      borderColor: palette.borderSplit,
      rowHoverBg: palette.bgApp,
      cellPaddingBlock: 13,
      cellPaddingInline: 12,
      headerBorderRadius: 0,
      footerBg: palette.bgSubtleAlt,
    },
    Card: {
      headerBg: 'transparent',
      headerFontSize: 15,
      paddingLG: 20,
      colorBorderSecondary: palette.borderCard,
    },
    Button: {
      // antd's default primary carries a coloured drop shadow. The prototypes
      // have none — depth comes from the card, not from every control on it.
      primaryShadow: 'none',
      defaultShadow: 'none',
      dangerShadow: 'none',
      fontWeight: 600,
    },
    Modal: {
      borderRadiusLG: 18,
      titleFontSize: 17,
      headerBg: palette.bgContainer,
      footerBg: palette.bgSubtle,
      contentBg: palette.bgContainer,
    },
    Input: { paddingBlock: 8, activeShadow: `0 0 0 3px ${palette.accentRing}` },
    InputNumber: { activeShadow: `0 0 0 3px ${palette.accentRing}` },
    Select: { optionSelectedBg: palette.accentTint },
    Segmented: {
      trackBg: palette.bgHover,
      itemSelectedBg: palette.bgContainer,
      itemSelectedColor: palette.text,
      trackPadding: 3,
      borderRadius: 10,
    },
    Tooltip: { colorBgSpotlight: palette.ink, borderRadius: 8 },
    Tabs: { horizontalItemPadding: '10px 0', cardBg: palette.bgSubtleAlt },
    Alert: { withDescriptionPadding: '14px 15px' },
    Progress: { defaultColor: palette.accent, remainingColor: palette.track },
    Tag: { defaultBg: palette.bgHover, defaultColor: palette.textSecondary },
    Collapse: { headerBg: 'transparent', contentBg: palette.bgContainer },
  },
}

/**
 * Field — tablet, gloves, sun.
 *
 * 48px is the floor for anything tappable; the confirm button on B2 is larger
 * still and set on the component. The larger base font is not decoration: this
 * screen is read at arm's length off a scaffold.
 */
export const fieldTheme: ThemeConfig = {
  token: {
    ...sharedTokens,
    colorError: fieldError,
    fontSize: 14,
    controlHeight: 48,
    controlHeightSM: 40,
    borderRadius: 12,
    borderRadiusLG: 14,
    borderRadiusSM: 10,
    padding: 16,
    paddingLG: 20,
  },
  components: {
    Layout: { bodyBg: palette.bgApp, headerBg: palette.bgContainer, headerHeight: 48 },
    Card: { headerBg: 'transparent', paddingLG: 20, colorBorderSecondary: palette.borderCard },
    Button: { primaryShadow: 'none', defaultShadow: 'none', dangerShadow: 'none', fontWeight: 600 },
    Modal: {
      borderRadiusLG: 18,
      titleFontSize: 17,
      headerBg: palette.bgContainer,
      footerBg: palette.bgSubtle,
      contentBg: palette.bgContainer,
    },
    Select: { optionSelectedBg: palette.accentTint, optionHeight: 48, optionPadding: '12px 13px' },
    Tabs: { horizontalItemPadding: '12px 0' },
    Table: {
      headerBg: palette.bgSubtleAlt,
      headerColor: palette.textTertiary,
      borderColor: palette.borderSplit,
      cellPaddingBlock: 14,
    },
    Progress: { defaultColor: palette.accent, remainingColor: palette.track },
    Tooltip: { colorBgSpotlight: palette.ink, borderRadius: 8 },
  },
}
