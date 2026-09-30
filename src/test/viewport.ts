/**
 * A viewport of `width` px for antd's breakpoints and the app's own width
 * queries, as FieldHeader.test sets one: jsdom answers no media query by
 * itself, which every field screen reads as a phone. Returns the undo.
 */
export function setViewport(width: number): () => void {
  const original = window.matchMedia
  window.matchMedia = ((query: string) => {
    const min = /min-width:\s*([\d.]+)px/.exec(query)
    const max = /max-width:\s*([\d.]+)px/.exec(query)
    return {
      matches: (!min || width >= Number(min[1])) && (!max || width <= Number(max[1])),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }
  }) as typeof window.matchMedia
  return () => {
    window.matchMedia = original
  }
}
