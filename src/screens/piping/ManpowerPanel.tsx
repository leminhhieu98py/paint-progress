import type { PipingPanelProps } from './panelProps'

/**
 * The Manpower tab of the Piping page. A seam for now: its content is a later
 * task of the Piping plan, built against `PipingPanelProps`.
 */
export function ManpowerPanel(props: PipingPanelProps) {
  return <div data-testid="manpower-panel" data-project={props.projectId} />
}
