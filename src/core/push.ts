/**
 * Phone notifications (Web Push), step 1: turning them on and off for this
 * device, and sending yourself a test. The Notifications page
 * (src/core/pages/Notifications.tsx) uses these.
 *
 * How it fits together:
 *
 *   - public/sw.js is the service worker: a small script the browser keeps
 *     running in the background, which shows a notification when one comes.
 *   - Turning notifications on asks the browser to allow them, then gets an
 *     address for this device from the browser's push service and saves it
 *     with save_push_subscription() (supabase/migrations/..._push_subscriptions.sql).
 *   - The `push` server function (supabase/functions/push/) holds the
 *     team's private key and sends to those addresses.
 *
 * Each phone or computer is turned on separately. iPhones only allow this
 * for apps added to the Home Screen and opened from there, in their own
 * window (public/manifest.webmanifest), on iOS 16.4 or later.
 *
 * Demo mode has no server: turning on only asks the browser, and the test
 * comes from the browser itself, so you can still see what one looks like.
 *
 * When notifications don't pop up, the Details section on the
 * Notifications page (pushDetails(), showTestHere()) shows what's wrong
 * without needing DevTools.
 */
import { callFunction } from './functions'
import { addTestNotification } from './notifications'
import { supabase } from './supabase'
import { fail, ok, type Result } from './table'

/** The service worker, next to index.html. */
const WORKER = './sw.js'

/**
 * What this browser can do about notifications:
 *
 *   - ready: it can turn them on.
 *   - add-to-home-screen: an iPhone in Safari (or another browser). It has
 *     to be opened from a Home Screen icon first.
 *   - update-iphone: opened from the Home Screen, but too old: they came
 *     in iOS 16.4.
 *   - unsupported: anything else that can't.
 */
export type PushSupport = 'ready' | 'add-to-home-screen' | 'update-iphone' | 'unsupported'

/** Where notifications are up to on this device. */
export type PushState = 'on' | 'off' | 'blocked' | Exclude<PushSupport, 'ready'>

/** What we know about the browser. A plain object, so it can be tested. */
export interface Device {
  serviceWorker: boolean
  pushManager: boolean
  notification: boolean
  /** An iPhone or iPad. */
  ios: boolean
  /** Opened from a Home Screen icon, in its own window rather than a browser tab. */
  standalone: boolean
}

export function pushSupport(device: Device): PushSupport {
  if (device.serviceWorker && device.pushManager && device.notification) return 'ready'
  if (!device.ios) return 'unsupported'
  return device.standalone ? 'update-iphone' : 'add-to-home-screen'
}

export function thisDevice(): Device {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return { serviceWorker: false, pushManager: false, notification: false, ios: false, standalone: false }
  }
  const agent = navigator.userAgent
  return {
    serviceWorker: 'serviceWorker' in navigator,
    pushManager: 'PushManager' in window,
    notification: 'Notification' in window,
    // iPads say they're Macs, but Macs don't have touch screens.
    ios: /iPhone|iPad|iPod/.test(agent) || (/Macintosh/.test(agent) && navigator.maxTouchPoints > 1),
    standalone: window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true,
  }
}

/** The push server function's public key, as the bytes the browser wants. It comes as base64url text. */
export function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (base64url.length % 4)) % 4)
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
}

/** What's saved for a device: its address and its two keys. */
export interface SavedDevice {
  endpoint: string
  p256dh: string
  auth: string
}

/** The parts of a browser's subscription the database keeps, or null if any is missing. */
export function savedDevice(subscription: { endpoint?: string; keys?: Record<string, string> }): SavedDevice | null {
  const { endpoint } = subscription
  const p256dh = subscription.keys?.p256dh
  const auth = subscription.keys?.auth
  return endpoint && p256dh && auth ? { endpoint, p256dh, auth } : null
}

/** "Sent to 2 of your devices." and anything that went wrong, from the push function's answer. */
export function testResultText(answer: { sent: number; removed: number; failed: number }): string {
  const devices = (n: number) => (n === 1 ? '1 of your devices' : `${n} of your devices`)
  const parts = [answer.sent > 0 ? `Sent to ${devices(answer.sent)}.` : "Didn't reach any of your devices."]
  if (answer.removed > 0) parts.push(`${answer.removed === 1 ? 'One device was' : `${answer.removed} devices were`} turned off there, so it's been removed.`)
  if (answer.failed > 0) parts.push(`${devices(answer.failed)} couldn't be reached. Try again in a minute.`)
  return parts.join(' ')
}

export const SUPPORT_TEXT: Record<Exclude<PushSupport, 'ready'>, string> = {
  'add-to-home-screen': 'On an iPhone, notifications only work when the app is opened from your Home Screen.',
  'update-iphone': 'This iPhone needs iOS 16.4 or later for notifications. Update it in Settings > General > Software Update, then come back here.',
  unsupported: "This browser can't show notifications. Try Chrome on an Android phone, or a computer.",
}

/** How to add the app to an iPhone's Home Screen, one step each. */
export const IPHONE_STEPS = [
  'Tap the Share button (the square with an arrow pointing up). In Safari it\'s at the bottom, or under the ••• button.',
  'Scroll down and tap Add to Home Screen, then Add.',
  'Open the app from the new Ctrl-Z icon on your Home Screen, and sign in with Slack.',
  'Tap the bell at the top right, then Turn on.',
]

export const BLOCKED_TEXT = "Notifications are blocked for this site. Allow them in your browser's settings for this site, then reload the page."

async function registration(): Promise<ServiceWorkerRegistration | undefined> {
  return navigator.serviceWorker.getRegistration(WORKER)
}

/** Where notifications are up to on this device. */
export async function pushState(): Promise<PushState> {
  const support = pushSupport(thisDevice())
  if (support !== 'ready') return support
  if (Notification.permission === 'denied') return 'blocked'
  if (Notification.permission !== 'granted') return 'off'
  const worker = await registration()
  if (!worker) return 'off'
  if (!supabase) return 'on'
  return (await worker.pushManager.getSubscription()) ? 'on' : 'off'
}

/**
 * The public key, fetched before anyone taps Turn on: iPhones only allow
 * turning on straight from a tap, with no waiting for the network first.
 */
export async function pushKey(): Promise<Result<string>> {
  if (!supabase) return ok('')
  const answer = await callFunction<{ key: string }>('push', { kind: 'key' }, () => ({ key: '' }))
  return answer.ok ? ok(answer.value.key) : answer
}

/** Turn on notifications for this device. Call it straight from a tap, with the key from pushKey(). */
export async function turnOnPush(key: string): Promise<Result> {
  const support = pushSupport(thisDevice())
  if (support !== 'ready') return fail(SUPPORT_TEXT[support])
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return fail(permission === 'denied' ? BLOCKED_TEXT : 'Tap Allow when your browser asks, to turn notifications on.')
  try {
    await navigator.serviceWorker.register(WORKER)
    const worker = await navigator.serviceWorker.ready
    if (!supabase) return ok(null)
    if (!key) return fail("Couldn't get the key for notifications. Reload the page and try again.")
    const subscription =
      (await worker.pushManager.getSubscription()) ??
      (await worker.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) }))
    const device = savedDevice(subscription.toJSON())
    if (!device) return fail("This browser didn't give an address for notifications. Try another browser.")
    const { error } = await supabase.rpc('save_push_subscription', { new_endpoint: device.endpoint, new_p256dh: device.p256dh, new_auth: device.auth })
    return error ? fail("Couldn't save this device. Check your connection and try again.") : ok(null)
  } catch {
    return fail("This browser wouldn't turn notifications on. Try again, or try another browser.")
  }
}

/** Turn off notifications for this device. Other devices stay on. */
export async function turnOffPush(): Promise<Result> {
  if (pushSupport(thisDevice()) !== 'ready') return ok(null)
  const worker = await registration()
  const subscription = await worker?.pushManager.getSubscription()
  if (!subscription) {
    await worker?.unregister()
    return ok(null)
  }
  const { endpoint } = subscription
  await subscription.unsubscribe()
  await worker?.unregister()
  if (!supabase) return ok(null)
  const { error } = await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint)
  return error ? fail("It's off on this device, but couldn't be removed from your list. Try again.") : ok(null)
}

/**
 * Send yourself a test: always to your notifications in the app (the
 * bell), and to each of your devices when they're on (`pushOn`). Says how
 * it went.
 */
export async function sendTest(pushOn: boolean): Promise<Result<string>> {
  const added = await addTestNotification()
  if (!added.ok) return added
  if (!pushOn) return ok('Added to your notifications. Turn on phone notifications to get them on this device too.')
  if (!supabase) {
    // Demo mode: no server, so this browser shows one itself.
    const worker = await registration()
    if (!worker || Notification.permission !== 'granted') return fail('Turn notifications on first.')
    const { title, body, url } = added.value
    await showOn(worker, title, body, url)
    return ok('Sent. (Demo mode: this browser showed it itself, with no server.)')
  }
  const answer = await callFunction<{ sent: number; removed: number; failed: number }>('push', { kind: 'test' }, () => ({ sent: 1, removed: 0, failed: 0 }))
  return answer.ok ? ok(testResultText(answer.value)) : answer
}

/** Show a notification from this device's service worker, the same way public/sw.js does. */
function showOn(worker: ServiceWorkerRegistration, title: string, body: string, url: string | null): Promise<void> {
  return worker.showNotification(title, { body, icon: './icon-192.png', data: { url } })
}

/**
 * Show a test notification straight from this device's service worker,
 * with no server. If this pops up but Send me a test doesn't, the problem
 * is getting messages to the device, not showing them.
 */
export async function showTestHere(): Promise<Result<string>> {
  const support = pushSupport(thisDevice())
  if (support !== 'ready') return fail(SUPPORT_TEXT[support])
  if (Notification.permission === 'denied') return fail(BLOCKED_TEXT)
  const worker = await registration()
  if (!worker || Notification.permission !== 'granted') return fail('Turn notifications on first.')
  try {
    await showOn(worker, 'Test from this device', 'If you can see this, this device can show notifications.', './#/notifications')
    return ok("Shown, with no server. If nothing popped up, check this device's settings allow notifications from your browser, and that Do not disturb is off.")
  } catch {
    return fail("This browser wouldn't show it. Tap Turn off, then Turn on, and try again.")
  }
}

/**
 * Facts about notifications on this device, for the Details section on
 * the Notifications page. It explains what's wrong on computers where
 * DevTools is blocked. detailLines() turns them into sentences.
 */
export interface PushDetails {
  /** The site address, like https://app.team4096.org/ */
  address: string
  /** Whether the browser counts this address as secure (https). Notifications need it. */
  secure: boolean
  /** Whether the browser allows notifications for this site, or 'missing' if it can't show them at all. */
  permission: NotificationPermission | 'missing'
  /** The service worker (public/sw.js): not set up, starting, or running. */
  worker: 'none' | 'starting' | 'running'
  /** The addresses the service worker looks after, like https://app.team4096.org/ */
  workerScope: string | null
  /** Only the push service's name, like fcm.googleapis.com. See pushServiceName(). */
  pushService: string | null
  /** Demo mode, which has no server, so never signs up with a push service. */
  demo: boolean
}

/**
 * The push service's name from a device's address: only the host, like
 * fcm.googleapis.com. Never show the whole address: anyone who has it can
 * send this device notifications, so it works like a password.
 */
export function pushServiceName(endpoint: string): string {
  try {
    return new URL(endpoint).host || 'unknown'
  } catch {
    return 'unknown'
  }
}

/** One line of the Details section: good (ok), something to fix (warn), or not set up yet (plain). */
export interface DetailLine {
  label: string
  tone: 'ok' | 'warn' | 'plain'
  text: string
}

export function detailLines(details: PushDetails): DetailLine[] {
  const { address, secure, permission, worker, workerScope, pushService, demo } = details
  return [
    secure
      ? { label: 'Site address', tone: 'ok', text: address }
      : { label: 'Site address', tone: 'warn', text: `${address} isn't secure, so notifications can't work here. Open the address that starts with https:// instead.` },
    permission === 'granted'
      ? { label: 'Browser permission', tone: 'ok', text: 'Allowed.' }
      : permission === 'denied'
        ? { label: 'Browser permission', tone: 'warn', text: BLOCKED_TEXT }
        : permission === 'default'
          ? { label: 'Browser permission', tone: 'plain', text: 'Not asked yet. Turn on asks.' }
          : { label: 'Browser permission', tone: 'warn', text: "This browser can't show notifications." },
    worker === 'running'
      ? { label: 'Service worker', tone: 'ok', text: `Running, for ${workerScope ?? address}` }
      : worker === 'starting'
        ? { label: 'Service worker', tone: 'plain', text: 'Starting. Reload the page in a moment.' }
        : { label: 'Service worker', tone: 'plain', text: 'Not set up yet. Turn on sets it up.' },
    pushService
      ? { label: 'Push service', tone: 'ok', text: pushService }
      : demo
        ? { label: 'Push service', tone: 'plain', text: "None: demo mode has no server, so it doesn't use one." }
        : { label: 'Push service', tone: 'plain', text: 'None yet. Turn on sets it up.' },
  ]
}

/** Gather the facts for the Details section from this browser. */
export async function pushDetails(): Promise<PushDetails> {
  const device = thisDevice()
  let worker: ServiceWorkerRegistration | undefined
  let subscription: PushSubscription | null = null
  try {
    worker = device.serviceWorker ? await registration() : undefined
    subscription = worker && device.pushManager ? await worker.pushManager.getSubscription() : null
  } catch {
    // Some browsers refuse to answer, for example in a private window: show what we have.
  }
  return {
    address: location.origin + location.pathname,
    secure: window.isSecureContext,
    permission: device.notification ? Notification.permission : 'missing',
    worker: !worker ? 'none' : worker.active ? 'running' : 'starting',
    workerScope: worker?.scope ?? null,
    pushService: subscription ? pushServiceName(subscription.endpoint) : null,
    demo: !supabase,
  }
}
