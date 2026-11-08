// The team app's service worker: it shows phone notifications (Web Push).
// See src/core/push.ts, which registers it when someone turns notifications
// on, and supabase/functions/push/, which sends them.
//
// It does nothing else. It doesn't cache pages or handle page loads, so the
// app always loads fresh from the site, exactly as it does without it.

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
