import '@testing-library/jest-dom/vitest'
import { vi } from 'vitest'

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
