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
 *
 * For now it only sends to your own devices. Real notifications, like
 * "Your request was ordered", are already in the app's bell (see
 * supabase/migrations/..._purchase_notifications.sql). Sending those to
 * phones too comes in a later step, because it means sending to other
 * people's devices.
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
