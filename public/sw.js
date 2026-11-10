// The team app's service worker. It does two things:
//
// 1. Keeps the app's own files on this device (src/core/offline.ts), so the
//    app opens with no connection, and a tab opened before an update can
//    still load its pages. It never touches requests to other sites, like the
//    team database (Supabase): those always go straight to the network.
// 2. Shows phone notifications (Web Push): see src/core/push.ts, and
//    supabase/functions/push/, which sends them.

// ---------------------------------------------------------------------------
// The app's files.

// After each build, vite.config.ts writes this version's name and the list of
// its files here (src/core/appFiles.ts). Keep these two lines as they are.
const VERSION = 'dev' // The build fills this in.
const APP_FILES = [] // The build fills this in.

// One store of files for each version of the app. The one before is kept
// too, so a tab still running it can open its pages; older ones are deleted.
const PREFIX = 'ctrlz-app-'
const CACHE = PREFIX + VERSION

// How long to wait for the site before using the saved copy instead. Venue
// Wi-Fi often looks connected when nothing gets through.
const NETWORK_WAIT_MS = 4000

const fileUrl = (file) => new URL(file, self.registration.scope).href

// Look up a saved file by its address alone. Sites can mark files as varying
// by how they're asked for (Vary), and a page asks for its scripts slightly
// differently from how they were saved, so a strict match would miss them.
// These files never vary, so the address is enough.
const MATCH = { ignoreVary: true }

// A new version: save all its files, then start straight away rather than
// waiting for every tab to close. If saving fails (the connection dropped),
// the old version carries on and this is tried again next time.
self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      if (APP_FILES.length > 0) {
        const cache = await caches.open(CACHE)
        // 'reload': fresh from the site, not the browser's own copy.
        await cache.addAll(APP_FILES.map((file) => new Request(fileUrl(file), { cache: 'reload' })))
      }
      await self.skipWaiting()
    })(),
  )
})

// Keep this version's files and the version before; delete older ones.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const older = (await caches.keys()).filter((name) => name.startsWith(PREFIX) && name !== CACHE)
      // caches.keys() lists them oldest first, so the last one is the version before this.
      await Promise.all(older.slice(0, -1).map((name) => caches.delete(name)))
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  // Only reading this app's own files. Anything else, like the team
  // database, sign-in or saving, goes to the network exactly as usual.
  if (request.method !== 'GET' || !request.url.startsWith(self.registration.scope)) return
  event.respondWith(request.mode === 'navigate' ? openApp(request) : appFile(request))
})

// Opening the app: the newest version from the site, or the saved one if the
// site doesn't answer in time.
async function openApp(request) {
  try {
    return await withTimeout(fetch(request), NETWORK_WAIT_MS)
  } catch {
    return (await caches.match(fileUrl('index.html'), { ...MATCH, cacheName: CACHE })) ?? (await caches.match(fileUrl('index.html'), MATCH)) ?? Response.error()
  }
}

// The app's other files. Files in assets/ have the version in their name and
// never change, so a saved copy is always right, from any version. Anything
// else (icons, the app manifest) comes from the site if it answers, so
// changes show up, and from the saved copy if it doesn't.
async function appFile(request) {
  if (new URL(request.url).pathname.includes('/assets/')) {
    const saved = await caches.match(request, MATCH)
    if (saved) return saved
    const response = await fetch(request)
    if (response.ok) {
      const copy = response.clone()
      caches.open(CACHE).then((cache) => cache.put(request, copy))
    }
    return response
  }
  try {
    return await withTimeout(fetch(request), NETWORK_WAIT_MS)
  } catch {
    return (await caches.match(request, MATCH)) ?? Response.error()
  }
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('The site took too long to answer.')), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

// ---------------------------------------------------------------------------
// Phone notifications.

self.addEventListener('push', (event) => {
  let message = {}
  try {
    message = event.data ? event.data.json() : {}
  } catch {
    message = { body: event.data ? event.data.text() : '' }
  }
  const title = typeof message.title === 'string' && message.title ? message.title : 'Ctrl-Z'
  event.waitUntil(
    self.registration.showNotification(title, {
      body: typeof message.body === 'string' ? message.body : '',
      icon: './icon-192.png',
      data: { url: typeof message.url === 'string' ? message.url : './' },
    }),
  )
})

// Tapping a notification opens its page in the app: in a tab that's already
// open if there is one, or a new one. Only pages of this app, never another site.
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const scope = self.registration.scope
  const wanted = new URL(event.notification.data?.url ?? './', scope).href
  const url = wanted.startsWith(scope) ? wanted : scope
  event.waitUntil(
    (async () => {
      const tabs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      const tab = tabs.find((t) => t.url.startsWith(scope))
      if (tab) {
        try {
          await tab.focus()
          await tab.navigate(url)
          return
        } catch {
          // Some browsers won't move a tab the worker didn't load: open a new one.
        }
      }
      await self.clients.openWindow(url)
    })(),
  )
})
