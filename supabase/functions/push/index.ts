// Phone notifications (Web Push): gives browsers the public key to turn
// notifications on, and sends a test to your own devices. Needs the
// VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY secrets; see "Server functions" in
// supabase/README.md. The app calls this through src/core/push.ts.
//
// web-push locks each message with the device's keys and signs it with
// ours, as every push service requires. A mentor approved using it.
// @deno-types="npm:@types/web-push@3.6.4"
import webpush from 'npm:web-push@3.6.7'
import { forMembers, reply } from '../_shared/members.ts'
import { isGone, pushRequest, testMessage, TEST_TTL } from './push.ts'

const publicKey = Deno.env.get('VAPID_PUBLIC_KEY') ?? ''
const privateKey = Deno.env.get('VAPID_PRIVATE_KEY') ?? ''

// Push services want a way to reach whoever sends: the app's address.
if (publicKey && privateKey) webpush.setVapidDetails('https://ctrlz-frc4096.github.io/app/', publicKey, privateKey)

interface Device {
  id: string
  endpoint: string
  p256dh: string
  auth: string
}

export default {
  fetch: forMembers(async (req, member, db) => {
    if (!publicKey || !privateKey) {
      return reply({ error: "Phone notifications aren't set up yet. A mentor adds the VAPID keys: see supabase/README.md." }, 503)
    }
    const request = pushRequest(await req.json().catch(() => null))
    if ('error' in request) return reply({ error: request.error }, request.status)

    if (request.kind === 'key') return reply({ key: publicKey })

    // The database's rules show the caller only their own devices.
    const { data, error } = await db.from('push_subscriptions').select('id, endpoint, p256dh, auth')
    if (error) return reply({ error: "Couldn't read your devices. Try again." }, 500)
    const devices = (data ?? []) as Device[]
    if (devices.length === 0) {
      return reply({ error: "Notifications aren't on for any of your devices. Turn them on first." }, 409)
    }

    const message = JSON.stringify(testMessage(member.name))
    let sent = 0
    let removed = 0
    let failed = 0
    for (const device of devices) {
      try {
        await webpush.sendNotification({ endpoint: device.endpoint, keys: { p256dh: device.p256dh, auth: device.auth } }, message, { TTL: TEST_TTL })
        sent += 1
      } catch (problem) {
        const status = (problem as { statusCode?: number }).statusCode
        if (isGone(status)) {
          await db.from('push_subscriptions').delete().eq('id', device.id)
          removed += 1
        } else {
          console.error('push failed', status, problem)
          failed += 1
        }
      }
    }
    return reply({ sent, removed, failed })
  }),
}
