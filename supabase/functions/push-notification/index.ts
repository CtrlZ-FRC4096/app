// Sends a saved purchase notification to its requester's devices. This
// function has JWT verification disabled so pg_net can call it; the shared
// secret is checked before it reads or changes anything.
// @deno-types="npm:@types/web-push@3.6.4"
import webpush from 'npm:web-push@3.6.7'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { isGone, purchasePush, pushNotificationId, pushWebhookAuthorized } from '../push/push.ts'

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const webhookSecret = Deno.env.get('PUSH_WEBHOOK_SECRET') ?? ''
const publicKey = Deno.env.get('VAPID_PUBLIC_KEY') ?? ''
const privateKey = Deno.env.get('VAPID_PRIVATE_KEY') ?? ''

if (publicKey && privateKey) webpush.setVapidDetails('https://ctrlz-frc4096.github.io/app/', publicKey, privateKey)

interface Device {
  id: string
  endpoint: string
  p256dh: string
  auth: string
}

export default {
  fetch: async (req: Request): Promise<Response> => {
    if (req.method !== 'POST') return Response.json({ error: 'Use POST.' }, { status: 405 })
    if (!pushWebhookAuthorized(req.headers.get('x-push-webhook-secret'), webhookSecret)) {
      return Response.json({ error: 'Not allowed.' }, { status: 401 })
    }
    if (!supabaseUrl || !serviceRoleKey || !publicKey || !privateKey) {
      return Response.json({ error: 'Phone notifications are not configured.' }, { status: 503 })
    }

    let body: unknown
    try {
      body = await req.json()
    } catch {
      return Response.json({ error: 'Send a notification ID.' }, { status: 400 })
    }
    const id = pushNotificationId(body)
    if (!id) return Response.json({ error: 'Send a notification ID.' }, { status: 400 })

    const db = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    })
    const { data: notification, error: notificationError } = await db
      .from('notifications')
      .select('id, member_id, title, body, url, topic, created_at, pushed_at')
      .eq('id', id)
      .maybeSingle()
    if (notificationError) {
      console.error('purchase push could not read notification', notificationError)
      return Response.json({ error: 'Could not read the notification.' }, { status: 500 })
    }
    if (!notification) return Response.json({ sent: 0, skipped: true })

    const push = purchasePush(notification, Date.now())
    if (!push) return Response.json({ sent: 0, skipped: true })

    const { data: devices, error: devicesError } = await db
      .from('push_subscriptions')
      .select('id, endpoint, p256dh, auth')
      .eq('member_id', notification.member_id)
    if (devicesError) {
      console.error('purchase push could not read devices', devicesError)
      return Response.json({ error: "Could not read the requester's devices." }, { status: 500 })
    }

    // Claim before sending: duplicate or delayed webhook calls cannot send
    // this row again. A failed delivery is not retried, by design.
    const pushedAt = new Date().toISOString()
    const { data: claimed, error: claimError } = await db
      .from('notifications')
      .update({ pushed_at: pushedAt })
      .eq('id', id)
      .is('pushed_at', null)
      .select('id')
      .maybeSingle()
    if (claimError) {
      console.error('purchase push could not claim notification', claimError)
      return Response.json({ error: 'Could not claim the notification.' }, { status: 500 })
    }
    if (!claimed) return Response.json({ sent: 0, skipped: true })

    let sent = 0
    let removed = 0
    let failed = 0
    for (const device of (devices ?? []) as Device[]) {
      try {
        await webpush.sendNotification(
          { endpoint: device.endpoint, keys: { p256dh: device.p256dh, auth: device.auth } },
          JSON.stringify(push.message),
          { TTL: push.ttl },
        )
        sent += 1
      } catch (problem) {
        const status = (problem as { statusCode?: number }).statusCode
        if (isGone(status)) {
          const { error } = await db.from('push_subscriptions').delete().eq('id', device.id)
          if (error) {
            console.error('purchase push could not remove an expired device', error)
            failed += 1
          } else {
            removed += 1
          }
        } else {
          console.error('purchase push failed', status, problem)
          failed += 1
        }
      }
    }
    return Response.json({ sent, removed, failed })
  },
}
