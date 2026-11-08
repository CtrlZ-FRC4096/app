import { useEffect, useState } from 'react'
import { shortDate } from '../format'
import { toast } from '../toast'
import { PageHead, Panel } from '../ui'
import { SHOWN_NOTIFICATIONS, deleteNotification, markAllRead, markRead, notificationHref, unreadCount, useNotifications, type AppNotification } from '../notifications'
import { BLOCKED_TEXT, SUPPORT_TEXT, pushKey, pushState, sendTest, turnOffPush, turnOnPush, type PushState } from '../push'

type Outcome = { ok: true; value: unknown } | { ok: false; error: string }

/**
 * Notifications, from the bell at the top right: your notifications, and
 * turning phone notifications on or off for this device. See
 * src/core/notifications.ts and src/core/push.ts.
 */
export function Notifications() {
  const [state, setState] = useState<PushState | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void pushState().then(setState)
  }, [])

  async function run(action: () => Promise<Outcome>, done: string) {
    setBusy(true)
    const result = await action()
    setBusy(false)
    toast(result.ok ? (typeof result.value === 'string' ? result.value : done) : result.error)
    setState(await pushState())
  }

  return (
    <>
      <PageHead title="Notifications">
        Things that need you. They show here, and on your phone too if you turn that on below.
      </PageHead>
      <List busy={busy} onTest={() => void run(() => sendTest(state === 'on'), 'Sent.')} />
      <ThisDevice state={state} busy={busy} run={run} />
    </>
  )
}

function List(props: { busy: boolean; onTest: () => void }) {
  const notifications = useNotifications()
  const unread = unreadCount(notifications)
  const shown = notifications.slice(0, SHOWN_NOTIFICATIONS)

  async function open(notification: AppNotification) {
    const result = await markRead(notification)
    if (!result.ok) toast(result.error)
    const link = notificationHref(notification.url)
    if (link && link !== location.hash) location.hash = link
  }

  async function remove(notification: AppNotification) {
    const result = await deleteNotification(notification)
    if (!result.ok) toast(result.error)
  }

  return (
    <Panel
      title={unread > 0 ? `Notifications (${unread} new)` : 'Notifications'}
      aside={
        <span className="toolbar">
          {unread > 0 && <button type="button" className="btn btn-sm" onClick={() => void markAllRead().then((r) => { if (!r.ok) toast(r.error) })}>Mark all read</button>}
          <button type="button" className="btn btn-sm" disabled={props.busy} onClick={props.onTest}>Send me a test</button>
        </span>
      }
    >
      {shown.length === 0 ? (
        <p className="panel-body muted">Nothing yet. Send yourself a test to see what one looks like.</p>
      ) : (
        <div className="row-list">
          {shown.map((n) => (
            <div key={n.id} style={{ flexWrap: 'wrap' }}>
              <span style={{ flex: '1 1 14rem', minWidth: 0, overflowWrap: 'anywhere' }}>
                <button type="button" className="name-btn" onClick={() => void open(n)}>
                  {n.read_at === null ? <strong>{n.title}</strong> : n.title}
                </button>
                {n.read_at === null && <span className="pill info" style={{ marginLeft: 8 }}>New</span>}
                {n.body && <><br /><span className={n.read_at === null ? undefined : 'muted'}>{n.body}</span></>}
                <br />
                <span className="note">{shortDate(n.created_at)}</span>
              </span>
              <button type="button" className="btn btn-sm" onClick={() => void remove(n)} aria-label={`Delete "${n.title}"`}>Delete</button>
            </div>
          ))}
        </div>
      )}
    </Panel>
  )
}

/** Phone notifications for the device you're on. */
function ThisDevice(props: { state: PushState | null; busy: boolean; run: (action: () => Promise<Outcome>, done: string) => Promise<void> }) {
  const { state, busy, run } = props
  const [key, setKey] = useState<{ value: string } | { error: string } | null>(null)

  useEffect(() => {
    // Fetched now, not on the tap: see pushKey().
    void pushKey().then((answer) => setKey(answer.ok ? { value: answer.value } : { error: answer.error }))
  }, [])

  const keyProblem = key && 'error' in key ? key.error : null

  return (
    <Panel title="Phone notifications on this device">
      <div className="panel-body">
        {state === null && <p className="muted">Checking…</p>}
        {state === 'on' && (
          <>
            <p><strong>On.</strong> Notifications also come to this device. Use Send me a test above to check.</p>
            <div className="toolbar">
              <button type="button" className="btn" disabled={busy} onClick={() => void run(turnOffPush, 'Turned off on this device.')}>Turn off</button>
            </div>
          </>
        )}
        {state === 'off' && (
          <>
            <p><strong>Off.</strong> Your browser will ask to allow notifications: tap Allow.</p>
            {keyProblem && <p className="note">{keyProblem}</p>}
            <div className="toolbar">
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy || key === null || !!keyProblem}
                onClick={() => void run(() => turnOnPush(key && 'value' in key ? key.value : ''), 'Turned on. Send yourself a test to check.')}
              >
                Turn on
              </button>
            </div>
          </>
        )}
        {state === 'blocked' && <p>{BLOCKED_TEXT}</p>}
        {(state === 'iphone' || state === 'unsupported') && <p>{SUPPORT_TEXT[state]}</p>}
        <p className="note">Turn them on separately on each phone or computer you use.</p>
      </div>
    </Panel>
  )
}
