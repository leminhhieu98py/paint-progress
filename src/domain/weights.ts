/**
 * The tolerance every weight sum in this app is held to. Weights are entered
 * as numerics with five decimals, so anything closer than this to 1 is the
 * admin's number and anything further is a hole in a billed figure.
 */
export const WEIGHT_EPSILON = 1e-5

/** True when the values add to 1 within WEIGHT_EPSILON. An empty list does not. */
export function sumsToOne(values: number[]): boolean {
  if (values.length === 0) return false
  const total = values.reduce((sum, v) => sum + v, 0)
  return Math.abs(total - 1) <= WEIGHT_EPSILON
}
