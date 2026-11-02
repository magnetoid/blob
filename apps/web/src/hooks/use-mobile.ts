import * as React from "react"

const MOBILE_BREAKPOINT = 768

const QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`

function subscribe(onChange: () => void) {
  const mql = window.matchMedia(QUERY)
  mql.addEventListener("change", onChange)
  return () => mql.removeEventListener("change", onChange)
}

/**
 * Below 768px — Tailwind's `md`, and where the chat's frame begins.
 *
 * Asked of the media query, and on the first render. The generated hook read
 * `innerWidth` in an effect, so a phone drew the desktop sidebar for a frame before
 * swapping in the sheet.
 */
export function useIsMobile() {
  return React.useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false
  )
}
