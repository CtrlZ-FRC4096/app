/**
 * Keeps the app's own files on this device, so it opens with no connection
 * (venue Wi-Fi), and a tab opened before an update can still load its pages.
 *
 * The service worker, public/sw.js, does the keeping. The build writes the
 * list of the app's files into it (vite.config.ts and appFiles.ts), so each
 * new version of the app is a new worker, and the browser picks it up by
 * itself the next time the app is opened online.
 *
 * With no connection, the app opens as the last person signed in on this
 * device (session.ts), using the copy of the member list kept on the device
 * (keepOffline in table.ts).
 *
 * It only keeps the app's files from this site. It never touches anything
 * from the team database (Supabase): data, sign-in and live updates always
 * come fresh, and work offline only where a module saves on the device
 * itself, like Scouting.
 */
import { useSyncExternalStore } from 'react'

/** Whether this device has a connection, as far as the browser knows. (Venue Wi-Fi can say yes and still not work.) */
export function isOnline(): boolean {
  return globalThis.navigator?.onLine !== false
}

function subscribe(callback: () => void) {
  window.addEventListener('online', callback)
  window.addEventListener('offline', callback)
  return () => {
    window.removeEventListener('online', callback)
    window.removeEventListener('offline', callback)
  }
}

/** isOnline() for a component, which redraws when the connection comes or goes. */
export function useOnline(): boolean {
  return useSyncExternalStore(subscribe, isOnline, () => true)
}

/** Ask the browser to install the worker. Only on the built site: during `npm run dev` the files change with every save. */
export function registerOfflineWorker() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return
  // After the page has loaded, so it doesn't slow down opening the app.
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      // Not allowed here (like a private window): the app still works online.
    })
  })
}
