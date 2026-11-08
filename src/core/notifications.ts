/**
 * Notifications in the app: the list behind the bell at the top right, on
 * the Notifications page (src/core/pages/Notifications.tsx).
 *
 * Each one is for one person. The same ones can also go to their phone
 * (src/core/push.ts), but they're always kept here too, so nobody misses
 * one because notifications are off on their phone.
 *
 * Who can do what is in supabase/migrations/..._notifications.sql: people
 * see, read and delete only their own. For now the only notification is
 * "Send me a test"; ones like "your request was ordered" come next.
 */
import { DEMO_PEOPLE } from './demo'
import { currentUser, useSession } from './session'
import { createTable, fail, newestFirst, ok, type Result, type Row } from './table'

/** One row of the notifications table. (Not "Notification": the browser already has one.) */
export interface AppNotification extends Row {
  /** Who it's for. */
  member_id: string
  title: string
  body: string
  /** The page in the app it opens, like "./#/purchasing", or null for none. */
  url: string | null
  /** When they read it, or null while it's new. */
  read_at: string | null
}

// Made up, for demo mode: one for each of the people you can view as.
const welcome = (n: number, member_id: string, created_at: string, read_at: string | null = null): AppNotification => ({
  id: `00000000-0000-4000-8000-0000000e000${n}`,
  member_id,
  title: 'Notifications show up here',
  body: 'Things that need you will appear here, and on your phone if you turn that on. Tap one to open it.',
  url: './#/notifications',
  created_at,
  read_at,
})

const EXAMPLE_NOTIFICATIONS: AppNotification[] = [
  welcome(1, DEMO_PEOPLE.alex, '2026-11-07T18:00:00Z'),
  welcome(2, DEMO_PEOPLE.pat, '2026-11-07T18:00:00Z'),
  welcome(3, DEMO_PEOPLE.morgan, '2026-11-07T18:00:00Z', '2026-11-07T18:05:00Z'),
]

export const notificationsTable = createTable<AppNotification>('notifications', { demo: EXAMPLE_NOTIFICATIONS, sort: newestFirst })

/** How many the page shows. Older ones stay until they're deleted. */
export const SHOWN_NOTIFICATIONS = 50

/** Only the signed-in person's. The database only sends those anyway; this keeps demo mode the same. */
export function forPerson(rows: AppNotification[], memberId: string): AppNotification[] {
  return rows.filter((n) => n.member_id === memberId)
}

/** Your notifications, newest first. */
export function useNotifications(): AppNotification[] {
  return forPerson(notificationsTable.useRows(), useSession().id)
}

export function unreadCount(rows: AppNotification[]): number {
  return rows.filter((n) => n.read_at === null).length
}

/** How many of yours are new, for the bell. */
export function useUnreadCount(): number {
  return unreadCount(useNotifications())
}

/** "9+" past nine, so the bell's badge stays small. Empty for none. */
export function badgeText(count: number): string {
  if (count <= 0) return ''
  return count > 9 ? '9+' : String(count)
}

/** What the bell says to a screen reader. */
export function bellLabel(count: number): string {
  return count === 0 ? 'Notifications' : `Notifications, ${count} new`
}

/** The link to a notification's page: "./#/purchasing" becomes "#/purchasing". Only pages in the app. */
export function notificationHref(url: string | null): string | null {
  return url && /^\.\/#\/\S*$/.test(url) ? url.slice(2) : null
}

export async function markRead(notification: AppNotification): Promise<Result> {
  if (notification.read_at !== null) return ok(null)
  const result = await notificationsTable.update(notification.id, { read_at: new Date().toISOString() })
  return result.ok ? ok(null) : result
}

/** Mark all of yours read. */
export async function markAllRead(): Promise<Result> {
  const me = currentUser()
  if (!me) return fail('Sign in first.')
  for (const notification of forPerson(notificationsTable.rows(), me.id)) {
    const result = await markRead(notification)
    if (!result.ok) return result
  }
  return ok(null)
}

export async function deleteNotification(notification: AppNotification): Promise<Result> {
  return notificationsTable.remove(notification.id)
}

/** The test notification, by first name. The push function sends the same words to phones. */
export function testNotificationText(name: string): { title: string; body: string; url: string } {
  const first = name.trim().split(/\s+/)[0] || 'there'
  return { title: 'Ctrl-Z', body: `Hi ${first}! Notifications are working.`, url: './#/notifications' }
}

/** Add a test notification for yourself. */
export async function addTestNotification(): Promise<Result<AppNotification>> {
  const me = currentUser()
  if (!me) return fail('Sign in first.')
  return notificationsTable.insert({ member_id: me.id, ...testNotificationText(me.name), read_at: null })
}
