#!/usr/bin/env node
/**
 * Writes a Lottie file's `loopOut('pingpong')` expressions out as plain
 * keyframes, so that lottie-web's light build -- which has no expressions
 * engine and simply holds a property at its last keyframe -- plays the file
 * as the full build does.
 *
 *   node scripts/bake-lottie-pingpong.mjs src/assets/login-construction.json
 *
 * Rewrites the file in place and touches nothing but the looped properties:
 * each one's first cycle (its published keyframes) is repeated forwards and
 * backwards up to the animation's out point, exactly as lottie-web's
 * loopOut('pingpong') samples it, and its `x` field is removed. Running it on
 * a file it has already baked changes nothing. Any other expression is
 * refused rather than dropped.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const PINGPONG = /^\s*var \$bm_rt;\s*\$bm_rt = loopOut\((['"])pingpong\1\);?\s*$/
const KEYFRAME_FIELDS = new Set(['t', 's', 'i', 'o', 'to', 'ti'])

/** 1 - v, per element; rounded so 1 - 0.833 is written 0.167. */
function mirror(v) {
  const one = (n) => Number((1 - n).toFixed(10))
  return Array.isArray(v) ? v.map(one) : one(v)
}

const copy = (v) => (v === undefined ? undefined : structuredClone(v))

/**
 * The easing and spatial tangents of a segment played backwards: the bezier
 * easing mirrored through (0.5, 0.5), so the out handle becomes the mirrored
 * in handle and the in handle the mirrored out handle, and the spatial path
 * reversed, so the tangents swap.
 */
function reversed(from) {
  const out = {
    o: { x: mirror(from.i.x), y: mirror(from.i.y) },
    i: { x: mirror(from.o.x), y: mirror(from.o.y) },
  }
  if (from.to) {
    out.to = copy(from.ti)
    out.ti = copy(from.to)
  }
  return out
}

function forward(from) {
  const out = { o: copy(from.o), i: copy(from.i) }
  if (from.to) {
    out.to = copy(from.to)
    out.ti = copy(from.ti)
  }
  return out
}

function bakeProperty(property, end, where) {
  const cycle = property.k
  if (!Array.isArray(cycle) || cycle.length < 2 || typeof cycle[0] !== 'object') {
    throw new Error(`${where}: loopOut on a property with fewer than two keyframes`)
  }
  for (const keyframe of cycle) {
    for (const field of Object.keys(keyframe)) {
      if (!KEYFRAME_FIELDS.has(field)) throw new Error(`${where}: keyframe field "${field}" is not handled`)
    }
  }
  const segments = cycle.length - 1
  for (let k = 0; k < segments; k++) {
    if (!cycle[k].o || !cycle[k].i) throw new Error(`${where}: keyframe ${k} has no easing`)
  }

  const start = cycle[0].t
  const length = cycle[segments].t - start
  const keyframes = cycle.map((keyframe) => structuredClone(keyframe))

  // Cycle m starts at start + m * length. Times are computed from the
  // published ones each cycle rather than accumulated, so they never drift.
  for (let m = 1; start + m * length < end; m++) {
    const base = start + m * length
    const back = m % 2 === 1
    for (let step = 0; step < segments; step++) {
      // Forwards: segment k from keyframe k to k + 1. Backwards: the same
      // segments last first, each from keyframe k + 1 back to keyframe k.
      const k = back ? segments - 1 - step : step
      const to = back ? cycle[k] : cycle[k + 1]
      Object.assign(keyframes[keyframes.length - 1], back ? reversed(cycle[k]) : forward(cycle[k]))
      keyframes.push({
        t: base + (back ? cycle[segments].t - to.t : to.t - start),
        s: structuredClone(to.s),
      })
    }
  }

  property.k = keyframes
  delete property.x
}

/** Bakes every loopOut('pingpong') in `animation`, in place. Returns how many. */
export function bakePingpong(animation) {
  const end = animation.op
  let baked = 0
  const visit = (node, where) => {
    if (!node || typeof node !== 'object') return
    if (typeof node.x === 'string') {
      if (!PINGPONG.test(node.x)) throw new Error(`${where}: expression not handled: ${node.x}`)
      bakeProperty(node, end, where)
      baked += 1
    }
    for (const [key, value] of Object.entries(node)) visit(value, `${where}.${key}`)
  }
  visit(animation, '$')
  return baked
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = process.argv[2]
  if (!file) {
    console.error('usage: node scripts/bake-lottie-pingpong.mjs <animation.json>')
    process.exit(1)
  }
  const raw = readFileSync(file, 'utf8')
  const animation = JSON.parse(raw)
  const baked = bakePingpong(animation)
  writeFileSync(file, JSON.stringify(animation) + (raw.endsWith('\n') ? '\n' : ''))
  console.log(`${file}: baked ${baked} loopOut('pingpong') expression(s)`)
}
