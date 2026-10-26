/**
 * Addresses look like app.team4096.org/#/inventory/INV-011.
 *
 * The first part after #/ is a module id, and anything after that belongs to
 * the module (Inventory uses it for the part a QR label points at). Using #
 * means GitHub Pages never has to find a page that doesn't exist as a file.
 */
import { useSyncExternalStore } from 'react'

function readHash(): string {
  return typeof location === 'undefined' ? '' : location.hash
}

function subscribe(callback: () => void) {
  window.addEventListener('hashchange', callback)
  return () => window.removeEventListener('hashchange', callback)
}

export interface Route {
  id: string
  rest: string[]
}

export function parseRoute(hash: string): Route {
  const parts = hash
    .replace(/^#\/?/, '')
    .split('/')
    .filter(Boolean)
    .map((part) => decodeURIComponent(part))
  return { id: parts[0] ?? '', rest: parts.slice(1) }
}

export function useRoute(): Route {
  return parseRoute(useSyncExternalStore(subscribe, readHash, () => ''))
}

/** The address of a module, or of something inside it. */
export function href(id: string, ...rest: string[]): string {
  return '#/' + [id, ...rest].filter(Boolean).map(encodeURIComponent).join('/')
}

export function navigate(id: string, ...rest: string[]) {
  location.hash = href(id, ...rest)
}
