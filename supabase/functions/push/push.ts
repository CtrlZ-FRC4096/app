/**
 * What the `push` server function lets the app do, checked before it does
 * it. Kept apart from index.ts so supabase/tests can test it: plain
 * TypeScript, no Deno.
 *
 * - `key` (anyone on the team): the public key browsers need to turn on
 *   notifications. It's safe to share; the private one never leaves the
 *   function.
 * - `test` (anyone on the team): a test notification to each of your own
 *   devices. The Notifications page's "Send me a test" button uses it.
 * - Purchase updates are sent by the separate `push-notification` function,
 *   which accepts only a notification ID from the database webhook. It loads
 *   the saved message itself and never accepts message text from a caller.
 */

export type PushRequest = { kind: 'key' } | { kind: 'test' }

/** What a notification says. The service worker (public/sw.js) shows it. */
export interface PushMessage {
  title: string
  body: string
  /** The page to open when it's tapped, inside the app, like "./#/purchasing". */
  url: string
}

/** What the app asked for, or why it isn't allowed. */
export function pushRequest(body: unknown): PushRequest | { error: string; status: number } {
  const kind = (body as { kind?: unknown } | null)?.kind
  if (kind === 'key' || kind === 'test') return { kind }
  return { error: 'Ask for the key, or a test.', status: 400 }
}

/** The test notification, by first name. */
export function testMessage(name: string): PushMessage {
  const first = name.trim().split(/\s+/)[0] || 'there'
  return { title: 'Ctrl-Z', body: `Hi ${first}! Notifications are working on this device.`, url: './#/notifications' }
}

/**
 * The push service's answer means the device is gone for good (the app
 * was removed, notifications were switched off, or the address ran out),
 * so its row should be deleted rather than tried again.
 */
export function isGone(status: number | undefined): boolean {
  return status === 404 || status === 410
}

/** How long the push service keeps trying a phone that's off, in seconds. A test is no use a day later. */
export const TEST_TTL = 60 * 60

/** Purchase updates are no use after a day. */
export const PURCHASE_TTL = 24 * 60 * 60

export interface PurchaseNotification {
  id: string
  member_id: string
  title: string
  body: string
  url: string | null
  topic: string | null
  created_at: string
  pushed_at: string | null
}

export interface PurchasePush {
  message: PushMessage
  ttl: number
}

/** The database webhook may identify a notification, but cannot supply its text. */
export function pushNotificationId(body: unknown): string | null {
  if (typeof body !== 'object' || body === null || !('id' in body)) return null
  const id = body.id
  return typeof id === 'string' && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id) ? id : null
}

/** Compare the webhook header without exiting early when a character differs. */
export function pushWebhookAuthorized(provided: string | null, expected: string): boolean {
  if (!provided || !expected) return false
  const actualBytes = new TextEncoder().encode(provided)
  const expectedBytes = new TextEncoder().encode(expected)
  if (actualBytes.length !== expectedBytes.length) return false
  let difference = 0
  for (let i = 0; i < actualBytes.length; i += 1) difference |= actualBytes[i] ^ expectedBytes[i]
  return difference === 0
}

/** A push can only be made from a recent, unpushed purchase notification row. */
export function purchasePush(notification: PurchaseNotification, now = Date.now()): PurchasePush | null {
  if (notification.topic !== 'purchasing.request_updates' || notification.pushed_at !== null) return null
  if (!notification.title.trim() || !notification.url || !/^\.\/#\/\S*$/.test(notification.url)) return null

  const createdAt = Date.parse(notification.created_at)
  if (!Number.isFinite(createdAt)) return null
  const age = now - createdAt
  if (age > PURCHASE_TTL * 1000) return null

  const ttl = Math.floor((PURCHASE_TTL * 1000 - Math.max(0, age)) / 1000)
  if (ttl <= 0) return null
  return { message: { title: notification.title, body: notification.body, url: notification.url }, ttl }
}
