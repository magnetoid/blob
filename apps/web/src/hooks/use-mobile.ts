import * as React from "react"

const MOBILE_BREAKPOINT = 768

const QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`

function subscribe(onChange: () => void) {
  const mql = window.matchMedia(QUERY)
  mql.addEventListener("change", onChange)
  return () => mql.removeEventListener("change", onChange)
}

/**
 * Below 768px — Tailwind's `md`, which is where the chat's frame begins too
 * (`styles/app/the-frame.css`, `min-width: 768px`), so from 768 up a console and a
 * channel are both framed, and below it neither is.
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
