/**
 * When a new version of the app goes live, Deploy replaces the whole site:
 * each page's file gets a new name, and the old files are deleted. A tab or
 * Home Screen app opened before that is still running the old version, so
 * opening a page it hasn't loaded yet asks for a file that's gone, and fails
 * with "Failed to fetch dynamically imported module".
 *
 * Reloading gets the new version, so the app does that by itself, once.
 * It never reloads twice in a row (so it can't loop) and never with no
 * connection (a reload then would lose the app). If it can't reload, the
 * page's error screen says what's going on and offers a Reload button (see
 * ErrorBoundary.tsx). Anything saved on the device, like scouting entries,
 * stays saved through a reload.
 */

/** How long after reloading for an update this tab won't do it again. */
export const RELOAD_GAP_MS = 60 * 1000

const KEY = 'ctrlz-app:reloaded-for-update'

/** Whether an error means a file of the app is gone or couldn't be loaded. Each browser words it differently. */
export function isUpdateError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed|unable to preload css/i.test(message)
}

/** Whether to reload now, if the last reload for an update was at `last` (or never). */
export function shouldReload(last: number | null, now: number): boolean {
  return last === null || now - last > RELOAD_GAP_MS
}

/** Reload to get the new version, unless this tab just did or there's no connection. Gives back whether it's reloading. */
export function reloadForUpdate(): boolean {
  if (navigator.onLine === false) return false
  let last: number | null = null
  try {
    last = Number(sessionStorage.getItem(KEY)) || null
    if (!shouldReload(last, Date.now())) return false
    sessionStorage.setItem(KEY, String(Date.now()))
  } catch {
    // Without a record of having reloaded, a reload could repeat forever. Don't.
    return false
  }
  location.reload()
  return true
}

/** A module's page loader that reloads instead of failing when the page's file is gone because of an update. */
export function loadPage<T>(load: () => Promise<T>): () => Promise<T> {
  return () =>
    load().catch((error: unknown) => {
      // While the page reloads, wait: showing the error for a moment would only flash.
      if (isUpdateError(error) && reloadForUpdate()) return new Promise<T>(() => {})
      throw error
    })
}

/** Vite's own signal for the same thing: a file a page needs couldn't be loaded. */
export function watchForUpdates() {
  window.addEventListener('vite:preloadError', (event) => {
    if (reloadForUpdate()) event.preventDefault()
  })
}
