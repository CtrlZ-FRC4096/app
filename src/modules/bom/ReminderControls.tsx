// The BOM page's Slack reminder controls (#22): your own daily reminder
// switch, and a mentor's "Remind now" on one stage. They save through
// data.ts and reminders.ts, never by themselves.
import { useState } from 'react'
import { isMentor } from '../../core/roles'
import { useSession } from '../../core/session'
import { toast } from '../../core/toast'
import { Pick } from '../../core/ui'
import { setDailyReminder, stepName, useDailyReminder, type Step } from './data'
import { remindNow } from './reminders'

const LABEL = 'Daily Slack reminder about my stages'
const CHOICES: ('On' | 'Off')[] = ['On', 'Off']

/** "Daily Slack reminder about my stages: On / Off", for whoever is signed in. */
export function DailyReminderSwitch() {
  const user = useSession()
  const on = useDailyReminder(user.id)
  const [saving, setSaving] = useState(false)

  async function change(value: 'On' | 'Off') {
    if ((value === 'On') === on || saving) return
    setSaving(true)
    const result = await setDailyReminder(value === 'On')
    setSaving(false)
    if (!result.ok) return toast(result.error)
    toast(value === 'On' ? "You'll get a Slack message on school days listing your stages." : "Turned off. You won't get the daily Slack message.")
  }

  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <div className="toolbar">
        <span>{LABEL}</span>
        <Pick label={LABEL} options={CHOICES} value={on ? 'On' : 'Off'} onChange={(v) => void change(v)} />
      </div>
      <span className="note">On school days at about 3 PM, a direct message lists the stages assigned to you that aren't done, late ones first.</span>
    </div>
  )
}

/** Mentors: " · Remind now" after a stage's assignee, to message them about it straight away. */
export function RemindNow(props: { step: Step; name: string }) {
  const user = useSession()
  const [sending, setSending] = useState(false)
  if (!isMentor(user.role) || !props.step.assigned_to || props.step.status === 'done') return null

  async function send() {
    setSending(true)
    const result = await remindNow(props.step)
    setSending(false)
    toast(result.ok ? `Sent ${props.name} a Slack reminder about ${stepName(props.step)}.` : result.error)
  }

  return (
    <>
      {' · '}
      <button type="button" className="link-btn" disabled={sending} onClick={() => void send()}>{sending ? 'Sending…' : 'Remind now'}</button>
    </>
  )
}
