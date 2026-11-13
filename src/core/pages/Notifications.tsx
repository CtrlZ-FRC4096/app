import { useEffect, useState } from 'react'
import { shortDate } from '../format'
import { toast } from '../toast'
import { PageHead, Panel, Pill } from '../ui'
import { navigate, parseRoute } from '../router'
import { useSession } from '../session'
import { modules } from '../../modules'
import {
  SHOWN_NOTIFICATIONS,
  deleteNotification,
  markAllRead,
  markRead,
  notificationAreas,
  notificationHref,
  setNotificationSetting,
  unreadCount,
  useNotificationSettings,
  useNotifications,
  type AppNotification,
} from '../notifications'
import {
  BLOCKED_TEXT,
  IPHONE_STEPS,
  SUPPORT_TEXT,
  detailLines,
  otherDevicesText,
  pushDetails,
  pushKey,
  pushState,
  removeOtherDevices,
  sendTest,
  showTestHere,
  turnOffPush,
  turnOnPush,
  type DetailLine,
  type PushDetails,
  type PushState,
} from '../push'

type Outcome = { ok: true; value: unknown } | { ok: false; error: string }

/**
 * Notifications, from the bell at the top right: your notifications, which
 * kinds you get, and turning phone notifications on or off for this device.
 * See src/core/notifications.ts and src/core/push.ts.
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
      <WhatToNotify />
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
    if (link && link !== location.hash) {
      const { id, rest } = parseRoute(link)
      navigate(id, ...rest)
    }
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

/**
 * A switch for each kind of notification, under the name of the module that
 * sends it. They're built from each module's `notifications` list in its
 * index.ts, so a new kind shows up here by itself.
 */
function WhatToNotify() {
  const { role } = useSession()
  const areas = notificationAreas(modules, role, useNotificationSettings())
  const [saving, setSaving] = useState<string | null>(null)

  async function change(key: string, enabled: boolean) {
    setSaving(key)
    const result = await setNotificationSetting(key, enabled)
    setSaving(null)
    if (!result.ok) toast(result.error)
  }

  if (areas.length === 0) return null

  return (
    <Panel title="What to notify me about">
      <p className="panel-body note" style={{ paddingBottom: 0 }}>
        Turn off anything you don't want to hear about. Changes are saved as soon as you tap.
      </p>
      {areas.map((area) => (
        <section key={area.id}>
          <h3 style={{ padding: '14px 16px 4px' }}>{area.name}</h3>
          <div className="row-list">
            {area.kinds.map((kind) => (
              <label key={kind.key} className="check" style={{ display: 'flex', minHeight: 44, alignItems: 'flex-start', fontSize: 'inherit' }}>
                <input
                  type="checkbox"
                  role="switch"
                  checked={kind.enabled}
                  disabled={saving === kind.key}
                  onChange={(e) => void change(kind.key, e.target.checked)}
                  style={{ flex: 'none', width: 24, height: 24, marginTop: 2 }}
                />
                <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
                  <strong>{kind.name}</strong>
                  <br />
                  <span className="note">{kind.description}</span>
                </span>
              </label>
            ))}
          </div>
        </section>
      ))}
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
        {(state === 'add-to-home-screen' || state === 'update-iphone' || state === 'unsupported') && <p>{SUPPORT_TEXT[state]}</p>}
        {state === 'add-to-home-screen' && (
          <ol style={{ margin: 0, paddingLeft: '1.4em', display: 'grid', gap: 6 }}>
            {IPHONE_STEPS.map((step) => <li key={step}>{step}</li>)}
          </ol>
        )}
        <p className="note">Turn them on separately on each phone or computer you use.</p>
        <Details state={state} busy={busy} run={run} />
      </div>
    </Panel>
  )
}

const PILL_TEXT: Record<DetailLine['tone'], string> = { ok: 'OK', warn: 'Fix', plain: 'Not yet' }

/**
 * What's going on with notifications on this device, for when they don't
 * pop up. It works without DevTools, which some computers block.
 */
function Details(props: { state: PushState | null; busy: boolean; run: (action: () => Promise<Outcome>, done: string) => Promise<void> }) {
  const { state, busy, run } = props
  const [details, setDetails] = useState<PushDetails | null>(null)

  // Checked again whenever notifications are turned on or off, or a button finishes.
  useEffect(() => {
    if (!busy) void pushDetails().then(setDetails)
  }, [state, busy])

  const canTest = state === 'on' || state === 'off' || state === 'blocked'
  const others = details?.saved?.others ?? 0

  function removeOthers() {
    if (!window.confirm(`Remove your ${otherDevicesText(others)}? They stop getting notifications until they're turned on again there.`)) return
    void run(removeOtherDevices, 'Removed.')
  }

  return (
    <details>
      <summary style={{ cursor: 'pointer', minHeight: 44, paddingBlock: 12 }}>Details, for when notifications don't pop up</summary>
      <div style={{ display: 'grid', gap: 10 }}>
        {details === null ? (
          <p className="muted" style={{ margin: 0 }}>Checking…</p>
        ) : (
          detailLines(details).map((line) => (
            <p key={line.label} style={{ margin: 0, overflowWrap: 'anywhere' }}>
              <Pill tone={line.tone}>{PILL_TEXT[line.tone]}</Pill> <strong>{line.label}:</strong> {line.text}
            </p>
          ))
        )}
        {others > 0 && (
          <>
            <p className="note" style={{ margin: 0 }}>
              Notifications sent to you also go to your {otherDevicesText(others)}. If you don't use one any more, or you
              turned notifications on at the app's old github.io address, remove them here.
            </p>
            <div className="toolbar">
              <button type="button" className="btn" disabled={busy} onClick={removeOthers}>Remove my other devices</button>
            </div>
          </>
        )}
        {canTest && (
          <>
            <p className="note" style={{ margin: 0 }}>
              Show a test here makes this device show a notification by itself, with no server. If it pops up but Send me a
              test doesn't, the problem is getting messages to this device, not showing them.
            </p>
            <div className="toolbar">
              <button type="button" className="btn" disabled={busy} onClick={() => void run(showTestHere, 'Shown.')}>Show a test here</button>
            </div>
          </>
        )}
      </div>
    </details>
  )
}
