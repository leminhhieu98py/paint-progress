import type { PipingPanelProps } from './panelProps'

/**
 * The Reinstatement tab of the Piping page. A seam for now: its content is a later
 * task of the Piping plan, built against `PipingPanelProps`.
 */
export function ReinstatementPanel(props: PipingPanelProps) {
  return <div data-testid="reinstatement-panel" data-project={props.projectId} />
}
