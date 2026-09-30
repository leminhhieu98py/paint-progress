/**
 * Round a list of shares so that, printed, they add up to the printed total.
 *
 * The project ring's legend (RV6-40) lists each slice's contribution beside a
 * centre figure that is their exact sum. Rounded one by one to two decimals of
 * a percent, three slices of 12,655 / 12,025 / 0,435 print as 12,66 + 12,03 +
 * 0,44 = 25,13 under a centre of 25,12 -- and the reader this column exists for
 * checks it by adding it up. Largest-remainder rounding hands the steps lost
 * to flooring back to the shares that lost the most, so the column and the
 * centre agree to the last digit without any share moving by more than one step.
 *
 * `step` is the smallest printed unit as a ratio: 0.0001 is 0,01%. The result
 * is expressed in whole steps divided back out, so a formatter prints it
 * exactly. Pure; ties go to the earlier share.
 */
export function roundSharesToTotal(values: number[], total: number, step = 0.0001): number[] {
  const scale = Math.round(1 / step)
  // The epsilon absorbs binary noise such as 0.0007 * 10000 = 6.999999999999999,
  // which would otherwise floor a share that is exactly on a step down by one.
  const exact = values.map((v) => v * scale)
  const floors = exact.map((x) => Math.floor(x + 1e-9))
  const target = Math.round(total * scale)
  let missing = target - floors.reduce((s, f) => s + f, 0)

  const order = exact
    .map((x, i) => ({ i, remainder: x - floors[i] }))
    .sort((a, b) => b.remainder - a.remainder || a.i - b.i)
  const steps = [...floors]
  for (const { i } of order) {
    if (missing <= 0) break
    steps[i] += 1
    missing -= 1
  }
  return steps.map((s) => s / scale)
}
