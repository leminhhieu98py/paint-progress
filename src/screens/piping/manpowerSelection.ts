import { defaultGroupSelection } from '../../domain/piping/manpower'
import type { ManpowerGroup, ManpowerValue } from '../../domain/piping/types'

/**
 * The Manpower chart's Nhóm select as it is on screen (RV8-7), per project,
 * for the export: the report's Manpower picture draws the groups the tab
 * draws (spec §10). The tab keeps its selection in its own state and reports
 * a pick here while it is mounted; with no pick on screen, the export draws
 * the select's default, worked out from the same data as the tab does.
 */

const onScreen = new Map<string, ReadonlySet<string>>()

/** The tab reports its selection; the returned function withdraws it (an effect's cleanup). */
export function showManpowerSelection(projectId: string, selected: ReadonlySet<string>): () => void {
  onScreen.set(projectId, selected)
  return () => {
    if (onScreen.get(projectId) === selected) onScreen.delete(projectId)
  }
}

/** The groups the tab shows for the project: its pick, or the select's default. */
export function manpowerSelectionOnScreen(
  projectId: string,
  groups: ManpowerGroup[],
  plan: ManpowerValue[],
  actual: ManpowerValue[],
): ReadonlySet<string> {
  return onScreen.get(projectId) ?? new Set(defaultGroupSelection(groups, plan, actual))
}
