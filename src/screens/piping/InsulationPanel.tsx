import type { PipingPanelProps } from './panelProps'

/**
 * The Insulation tab of the Piping page. A seam for now: its content is a later
 * task of the Piping plan, built against `PipingPanelProps`.
 */
export function InsulationPanel(props: PipingPanelProps) {
  return <div data-testid="insulation-panel" data-project={props.projectId} />
}
