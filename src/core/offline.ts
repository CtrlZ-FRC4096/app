/**
 * Keeps the app's own files on this device, so it opens with no connection
 * (venue Wi-Fi), and a tab opened before an update can still load its pages.
 *
 * The service worker, public/sw.js, does the keeping. The build writes the
 * list of the app's files into it (vite.config.ts and appFiles.ts), so each
 * new version of the app is a new worker, and the browser picks it up by
 * itself the next time the app is opened online.
 *
 * It only keeps the app's files from this site. It never touches anything
 * from the team database (Supabase): data, sign-in and live updates always
 * come fresh, and work offline only where a module saves on the device
 * itself, like Scouting.
 */

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
