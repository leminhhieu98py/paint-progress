import '@testing-library/jest-dom/vitest'
import { afterEach, vi } from 'vitest'

// jsdom does not implement matchMedia; antd's responsive Grid hook (used
// internally by Card/Form) calls it on mount. Guarded so it never clobbers a
// real implementation, and left configurable so an individual test can still
// override it per-case.
if (typeof window.matchMedia !== 'function') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  })
}

// jsdom's getComputedStyle() logs a "Not implemented" notice through its
// virtual console (which vitest/jsdom wire straight to a jsdom-internal
// console reference, not one a console.error override in this file can
// intercept) whenever it is called with a pseudo-element argument — which
// antd's rc-motion does on every Modal/Switch mount. jsdom's own
// implementation ignores that argument when computing the returned style
// either way (see getComputedStyleDeclaration in jsdom's Window.js), so
// dropping it before the call changes nothing observable and simply avoids
// triggering jsdom's not-implemented branch in the first place. Guarded like
// the matchMedia polyfill above so a real pseudo-element implementation, if
// jsdom ever adds one, is not silently defeated.
const originalGetComputedStyle = window.getComputedStyle.bind(window)
window.getComputedStyle = ((elt: Element, pseudoElt?: string | null) =>
  pseudoElt ? originalGetComputedStyle(elt) : originalGetComputedStyle(elt, pseudoElt)) as typeof window.getComputedStyle

// jsdom has no SVG layout, so no getBBox. rc-trigger (antd Tooltip) observes
// its anchor with resize-observer-polyfill, which calls getBBox on an SVG
// anchor -- the Donut's slices -- and threw an uncaught TypeError whenever a
// slice's tooltip opened in a test. An empty box is what jsdom's layout would
// give; guarded like the shims above so a real implementation wins.
if (typeof SVGElement !== 'undefined' && !('getBBox' in SVGElement.prototype)) {
  Object.defineProperty(SVGElement.prototype, 'getBBox', {
    configurable: true,
    writable: true,
    value: () => ({ x: 0, y: 0, width: 0, height: 0 }),
  })
}

// The login screen loads lottie-web on mount (LoginIllustration), and every
// test that shows the login screen would otherwise run the real player in
// jsdom, which has no canvas or layout for it (it probes a canvas context as
// it loads). A player that draws nothing stands in everywhere, its methods
// recording their calls; LoginIllustration.test.tsx replaces it with one it
// inspects more closely.
//
// Strict on purpose: touching a member the stub does not have throws, and the
// test that did it fails below. The throw alone would not be enough -- the
// component catches a failed player and quietly shows its drawing instead, so
// a new player call would otherwise pass every test and never be exercised.
const lottieStub = vi.hoisted(() => ({ missing: [] as string[] }))

vi.mock('lottie-web/build/player/lottie_light', () => {
  // Probed by module interop and promise resolution, not by the component.
  const probes = new Set<PropertyKey>(['then', '__esModule', 'default', 'toJSON'])
  const strict = <T extends object>(name: string, members: T): T =>
    new Proxy(members, {
      get(target, key, receiver) {
        if (key in target || typeof key === 'symbol' || probes.has(key)) {
          return Reflect.get(target, key, receiver)
        }
        const member = `${name}.${String(key)}`
        lottieStub.missing.push(member)
        throw new Error(`lottie-web test stub has no ${member}; add it in src/test-setup.ts`)
      },
    })
  const animation = () =>
    strict('AnimationItem', {
      addEventListener: vi.fn(),
      play: vi.fn(),
      pause: vi.fn(),
      goToAndStop: vi.fn(),
      destroy: vi.fn(),
    })
  return { default: strict('lottie', { loadAnimation: vi.fn(animation) }) }
})

afterEach(() => {
  const missing = lottieStub.missing.splice(0)
  if (missing.length > 0) {
    throw new Error(`lottie-web test stub was asked for ${missing.join(', ')}; add it in src/test-setup.ts`)
  }
})
