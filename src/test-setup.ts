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
