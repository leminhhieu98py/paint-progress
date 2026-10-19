import { defaultGroupSelection } from '../../domain/piping/manpower'
import type { ManpowerGroup } from '../../domain/piping/types'

/**
 * The Manpower chart's Nhóm select as it is on screen (RV8-7), per project,
 * for the export: the report's Manpower picture draws the groups the tab
 * draws (spec §10). The tab keeps its selection in its own state and reports
 * it here while it is mounted; with the tab not on screen, the export draws
 * the select's default, the groups the tab would open on.
 */

const onScreen = new Map<string, ReadonlySet<string>>()

/** The tab reports its selection; the returned function withdraws it (an effect's cleanup). */
export function showManpowerSelection(projectId: string, selected: ReadonlySet<string>): () => void {
  onScreen.set(projectId, selected)
  return () => {
    if (onScreen.get(projectId) === selected) onScreen.delete(projectId)
  }
}

/** The groups the tab shows for the project, or the select's default for `groups`. */
export function manpowerSelectionOnScreen(projectId: string, groups: ManpowerGroup[]): ReadonlySet<string> {
  return onScreen.get(projectId) ?? new Set(defaultGroupSelection(groups))
}
