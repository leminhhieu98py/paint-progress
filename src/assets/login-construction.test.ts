import { describe, expect, it } from 'vitest'
import { bakePingpong } from '../../scripts/bake-lottie-pingpong.mjs'
import animation from './login-construction.json'

// The login animation is played by lottie-web's light build, which has no
// expressions engine: a property driven by an expression just holds its last
// keyframe. The published file drove eight properties with
// `loopOut('pingpong')`, which scripts/bake-lottie-pingpong.mjs has written
// out as plain keyframes. These tests sample those keyframes the way lottie
// interpolates them and compare with what the full build plays.

type Keyframe = {
  t: number
  s: number[]
  o?: { x: number | number[]; y: number | number[] }
  i?: { x: number | number[]; y: number | number[] }
  to?: number[]
  ti?: number[]
}
type Property = { a: number; k: Keyframe[]; x?: string }

const first = (v: number | number[]) => (Array.isArray(v) ? v[0] : v)

/** cubic-bezier(x1, y1, x2, y2) at progress x, as lottie's BezierFactory. */
function ease(x1: number, y1: number, x2: number, y2: number, x: number) {
  const at = (a: number, b: number, u: number) =>
    3 * a * u * (1 - u) ** 2 + 3 * b * u ** 2 * (1 - u) + u ** 3
  let lo = 0
  let hi = 1
  for (let n = 0; n < 60; n++) {
    const mid = (lo + hi) / 2
    if (at(x1, x2, mid) < x) lo = mid
    else hi = mid
  }
  return at(y1, y2, (lo + hi) / 2)
}

/**
 * One dimension of a keyframed property at a frame. The two spatial ones here
 * move along a straight vertical line (their tangents lie on it), so their
 * y is the eased fraction of the way along, as it is for a 1-D value.
 */
function sample(keyframes: Keyframe[], frame: number, dim: number) {
  if (frame <= keyframes[0].t) return keyframes[0].s[dim]
  for (let k = 0; k < keyframes.length - 1; k++) {
    const a = keyframes[k]
    const b = keyframes[k + 1]
    if (frame < b.t) {
      const progress = (frame - a.t) / (b.t - a.t)
      const e = ease(first(a.o!.x), first(a.o!.y), first(a.i!.x), first(a.i!.y), progress)
      return a.s[dim] + (b.s[dim] - a.s[dim]) * e
    }
  }
  return keyframes[keyframes.length - 1].s[dim]
}

/** What `loopOut('pingpong')` returns at a frame, over the first cycle only. */
function pingpong(cycle: Keyframe[], frame: number, dim: number) {
  const start = cycle[0].t
  const length = cycle[cycle.length - 1].t - start
  if (frame <= start + length) return sample(cycle, frame, dim)
  const into = (frame - start) % length
  const odd = Math.floor((frame - start) / length) % 2 !== 0
  return sample(cycle, odd ? start + length - into : start + into, dim)
}

const layers = (animation as unknown as { layers: { nm: string; ks: Record<string, Property> }[] })
  .layers

// Every property the published file looped, with the end of its first cycle
// (the published keyframes) and the dimension that moves.
const baked = [
  { layer: 0, prop: 'r', end: 61, dim: 0 },
  { layer: 5, prop: 'p', end: 25, dim: 1 },
  { layer: 17, prop: 'r', end: 61, dim: 0 },
  { layer: 23, prop: 'r', end: 51, dim: 0 },
  { layer: 30, prop: 'o', end: 175, dim: 0 },
  { layer: 30, prop: 'a', end: 61, dim: 1 },
  { layer: 31, prop: 'o', end: 61, dim: 0 },
  { layer: 31, prop: 'a', end: 61, dim: 1 },
]

describe('login-construction.json', () => {
  it('carries no expressions for the light build to ignore', () => {
    const found: string[] = []
    const walk = (node: unknown, path: string) => {
      if (!node || typeof node !== 'object') return
      const record = node as Record<string, unknown>
      if (typeof record.x === 'string') found.push(path)
      for (const [key, value] of Object.entries(record)) walk(value, `${path}.${key}`)
    }
    walk(animation, '$')
    expect(found).toEqual([])
  })

  it("swings Layer 3 back and forth as the full build plays it", () => {
    // The full build (lottie_svg.js), goToAndStop on the published file.
    const reference: [number, number][] = [
      [30, 21.6],
      [61, 44],
      [90, 23.1],
      [120, 1.4],
      [180, 41.8],
      [239, 3.6],
    ]
    const rotation = layers[0].ks.r.k
    for (const [frame, degrees] of reference) {
      expect(Math.abs(sample(rotation, frame, 0) - degrees), `frame ${frame}`).toBeLessThanOrEqual(0.5)
    }
  })

  it.each(baked)('plays layer $layer $prop as loopOut("pingpong") would, frame by frame', ({ layer, prop, end, dim }) => {
    const keyframes = layers[layer].ks[prop].k
    const cycle = keyframes.filter((k) => k.t <= end + 1e-3)
    expect(cycle[cycle.length - 1].t).toBeCloseTo(end, 3)
    for (let frame = 0; frame < 240; frame += 0.5) {
      expect(sample(keyframes, frame, dim), `frame ${frame}`).toBeCloseTo(pingpong(cycle, frame, dim), 6)
    }
    // Keyframed up to the end of the 240-frame loop, so nothing holds early.
    expect(keyframes[keyframes.length - 1].t).toBeGreaterThanOrEqual(animation.op)
  })

  it('leaves the non-moving dimensions of the spatial properties alone', () => {
    for (const { layer, prop } of baked.filter((b) => b.prop === 'p' || b.prop === 'a')) {
      const keyframes = layers[layer].ks[prop].k
      for (const k of keyframes) {
        expect([k.s[0], k.s[2]]).toEqual([keyframes[0].s[0], keyframes[0].s[2]])
      }
    }
  })
})

describe('bakePingpong', () => {
  // Asymmetric easing and a spatial tangent, which the animation's own
  // symmetric 0.167/0.833 easing could not tell apart from a wrong reversal.
  const property = (): Property => ({
    a: 1,
    k: [
      { t: 10, s: [0, 0], o: { x: 0.1, y: 0.6 }, i: { x: 0.7, y: 0.95 }, to: [2, 0], ti: [-1, 3] },
      { t: 30, s: [10, 5] },
    ],
    x: "var $bm_rt;\n$bm_rt = loopOut('pingpong');",
  })

  it('reverses the easing and the tangents on the way back', () => {
    const json = { op: 70, layers: [{ ks: { p: property() } }] }
    bakePingpong(json)
    const p = json.layers[0].ks.p as Property
    expect(p.x).toBeUndefined()
    expect(p.k.map((k) => k.t)).toEqual([10, 30, 50, 70])
    expect(p.k.map((k) => k.s)).toEqual([[0, 0], [10, 5], [0, 0], [10, 5]])
    // Back from 10 to 0: the out handle is the mirrored in handle, and so on.
    expect(p.k[1].o!.x).toBeCloseTo(0.3, 12)
    expect(p.k[1].o!.y).toBeCloseTo(0.05, 12)
    expect(p.k[1].i!.x).toBeCloseTo(0.9, 12)
    expect(p.k[1].i!.y).toBeCloseTo(0.4, 12)
    expect(p.k[1]).toMatchObject({ to: [-1, 3], ti: [2, 0] })
    expect(p.k[2]).toMatchObject({ o: { x: 0.1, y: 0.6 }, i: { x: 0.7, y: 0.95 }, to: [2, 0], ti: [-1, 3] })

    for (let frame = 0; frame <= 70; frame += 0.25) {
      for (const dim of [0, 1]) {
        expect(sample(p.k, frame, dim), `frame ${frame}`).toBeCloseTo(pingpong(property().k, frame, dim), 9)
      }
    }
  })

  it('holds the value before the first keyframe, as loopOut does', () => {
    const json = { op: 70, layers: [{ ks: { p: property() } }] }
    bakePingpong(json)
    expect((json.layers[0].ks.p as Property).k[0].t).toBe(10)
  })

  it('does nothing to a file it has already baked', () => {
    const json = { op: 70, layers: [{ ks: { p: property() } }] }
    bakePingpong(json)
    const once = JSON.stringify(json)
    bakePingpong(json)
    expect(JSON.stringify(json)).toBe(once)
  })

  it('refuses an expression it does not know how to bake', () => {
    const json = { op: 70, layers: [{ ks: { p: { ...property(), x: 'wiggle(2, 5)' } } }] }
    expect(() => bakePingpong(json)).toThrow(/wiggle/)
  })
})
