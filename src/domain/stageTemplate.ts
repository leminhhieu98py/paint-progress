export interface StageTemplateEntry {
  seq: number
  name: string
  /** Hex, e.g. '#fadb14'. */
  color: string
  weight: number
}

/**
 * The stage list a new project is seeded with, taken from the source workbook.
 *
 * Deliberately separate from WORKBOOK_STAGES in fixtures.ts: that one carries
 * string ids ('coat1') for use as test data, which are not uuids and cannot be
 * inserted into deck_stages.id. This one has no id at all, so it is
 * insertable exactly as written.
 */
export const DEFAULT_STAGE_TEMPLATE: StageTemplateEntry[] = [
  { seq: 1, name: 'Blast + Coat 1', color: '#fadb14', weight: 0.25 },
  { seq: 2, name: 'Coat 2', color: '#bfbfbf', weight: 0.15 },
  { seq: 3, name: 'Coat 3', color: '#52c41a', weight: 0.35 },
  { seq: 4, name: 'Coat 4', color: '#1677ff', weight: 0.15 },
  { seq: 5, name: 'Tháo giáo', color: '#722ed1', weight: 0.1 },
]
