import * as React from "react"

const MOBILE_BREAKPOINT = 768

const QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`

function subscribe(onChange: () => void) {
  const mql = window.matchMedia(QUERY)
  mql.addEventListener("change", onChange)
  return () => mql.removeEventListener("change", onChange)
}

/**
 * Below 768px — Tailwind's `md`, the nearest step to where the chat's frame begins, and
 * one pixel short of it: the frame is drawn from 769px (`styles/app/the-frame.css`), so
 * at exactly 768 the console is framed and a channel is not.
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
