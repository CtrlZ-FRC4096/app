import { useState, type FormEvent } from 'react'
import { canChangeEvent, EVENT_LIMITS, type CalendarEvent } from '../../core/calendar'
import { plural } from '../../core/format'
import { useMemberNames } from '../../core/members'
import { useSession, type User } from '../../core/session'
import type { Result } from '../../core/table'
import { toast } from '../../core/toast'
import { Callout, PageHead, Panel, Pick } from '../../core/ui'
import {
  SIGN_UP_KINDS,
  WEEKS_AHEAD,
  addEvent,
  blankEventForm,
  cancelSignUp,
  changeEvent,
  eventsByDay,
  formFromEvent,
  hasEnded,
  loadEvents,
  removeEvent,
  shownDescription,
  signUp,
  signUpLink,
  signUpsFor,
  timeOfDay,
  updatedText,
  useCalendar,
  useSignUps,
  type EventForm,
  type SignUp,
} from './data'

// The page reads the events and sign-ups with hooks (useCalendar,
// useSignUps) and changes them with functions from data.ts. It never saves
// anything itself.
export default function CalendarPage() {
  const user = useSession()
  const { events, loadedAt, error, loading } = useCalendar()
  const signUps = useSignUps()
  const [adding, setAdding] = useState(false)
  // The event whose Change form is open, if any.
  const [changing, setChanging] = useState<string | null>(null)
  const days = eventsByDay(events)

  return (
    <>
      <PageHead title="Calendar">
        What's coming up in the next {WEEKS_AHEAD} weeks. Add an event here or in Google Calendar, and everyone sees it.
      </PageHead>
      <div className="toolbar">
        <button type="button" className="btn btn-sm" disabled={loading} onClick={() => void loadEvents()}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
        {!adding && (
          <button type="button" className="btn btn-sm btn-primary" onClick={() => setAdding(true)}>
            Add event
          </button>
        )}
        <span className="note">{updatedText(loadedAt)}</span>
      </div>
      {adding && (
        <Panel title="Add an event">
          <EventFormFields
            idPrefix="add-event"
            initial={blankEventForm()}
            saveLabel="Add event"
            savedText="Added. It's on the team calendar for everyone."
            onSave={addEvent}
            onDone={() => setAdding(false)}
          />
        </Panel>
      )}
      {error && (
        <Callout title="Couldn't load the team calendar">
          <span>
            {error}
            {loadedAt && ' These are the events from the last time it loaded.'}
          </span>
        </Callout>
      )}
      {days.length === 0 ? (
        <Panel>
          <p className="panel-body muted">
            {loadedAt ? `Nothing on the team calendar in the next ${WEEKS_AHEAD} weeks.` : loading ? 'Loading the team calendar…' : 'No events loaded yet.'}
          </p>
        </Panel>
      ) : (
        days.map((day) => (
          <Panel key={day.day} title={day.label}>
            <div className="row-list">
              {day.events.map((event) =>
                changing === event.id ? (
                  // A block, not a row, so the form gets the whole width. The form has its own padding.
                  <div key={event.id} style={{ display: 'block', padding: 0 }}>
                    <EventFormFields
                      idPrefix={`change-${event.id}`}
                      initial={formFromEvent(event)}
                      saveLabel="Save changes"
                      savedText="Saved."
                      onSave={(form) => changeEvent(event, form)}
                      onDone={() => setChanging(null)}
                    />
                  </div>
                ) : (
                  <EventRow key={event.id} event={event} user={user} signUps={signUps} onChange={() => setChanging(event.id)} />
                ),
              )}
            </div>
          </Panel>
        ))
      )}
    </>
  )
}

/** One event: when and where, who's going, and its buttons. */
function EventRow(props: { event: CalendarEvent; user: User; signUps: SignUp[]; onChange: () => void }) {
  const { event, user } = props
  const nameOf = useMemberNames()
  const [busy, setBusy] = useState(false)
  const description = shownDescription(event.description)
  const link = signUpLink(event.description)
  const going = signUpsFor(props.signUps, event)
  const imGoing = going.some((s) => s.created_by === user.id)
  // Only the person who added it and mentors see Change and Remove. The server function checks this too.
  const canChange = canChangeEvent(event, user)

  async function toggleSignUp() {
    setBusy(true)
    const result = imGoing ? await cancelSignUp(event) : await signUp(event)
    setBusy(false)
    toast(result.ok ? (imGoing ? "You're off the list." : "You're signed up.") : result.error)
  }

  async function remove() {
    const signedUp = going.length ? ` ${plural(going.length, 'person has', 'people have')} signed up.` : ''
    if (!window.confirm(`Remove ${event.title} from the team calendar?${signedUp}`)) return
    setBusy(true)
    const result = await removeEvent(event)
    setBusy(false)
    toast(result.ok ? 'Removed from the team calendar.' : result.error)
  }

  return (
    // flexWrap lets the buttons move under the event on a narrow phone, instead of squeezing it.
    <div style={{ flexWrap: 'wrap' }}>
      <span style={{ minWidth: 0, overflowWrap: 'anywhere', flex: '1 1 14rem' }}>
        <strong>{event.title}</strong>
        <br />
        <span className="note">
          {timeOfDay(event)}
          {event.location && ` · ${event.location}`}
        </span>
        {description && (
          <>
            <br />
            <span className="note">{description}</span>
          </>
        )}
        {event.signUps && (
          <>
            <br />
            <span className="note">
              {going.length === 0 ? 'No one has signed up yet.' : `Going (${going.length}): ${going.map((s) => nameOf(s.created_by)).join(', ')}`}
            </span>
          </>
        )}
      </span>
      {/* maxWidth lets the buttons wrap onto two lines on a phone instead of making the page scroll sideways. */}
      <span className="toolbar" style={{ marginLeft: 'auto', maxWidth: '100%' }}>
        {link && (
          <a className="btn btn-sm btn-primary" href={link} target="_blank" rel="noreferrer">
            Sign up
          </a>
        )}
        {event.signUps && !hasEnded(event) && (
          <button type="button" className={imGoing ? 'btn btn-sm' : 'btn btn-sm btn-primary'} disabled={busy} onClick={() => void toggleSignUp()}>
            {imGoing ? 'Cancel sign-up' : 'Sign up'}
          </button>
        )}
        {event.url && (
          <a className="btn btn-sm" href={event.url} target="_blank" rel="noreferrer">
            Open
          </a>
        )}
        {canChange && (
          <>
            <button type="button" className="btn btn-sm" disabled={busy} onClick={props.onChange}>
              Change
            </button>
            <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void remove()}>
              Remove
            </button>
          </>
        )}
      </span>
    </div>
  )
}

/** The form for adding or changing an event. */
function EventFormFields(props: {
  idPrefix: string
  initial: EventForm
  saveLabel: string
  savedText: string
  onSave: (form: EventForm) => Promise<Result<unknown>>
  onDone: () => void
}) {
  const [form, setForm] = useState(props.initial)
  const [saving, setSaving] = useState(false)
  const set = (changes: Partial<EventForm>) => setForm({ ...form, ...changes })
  const id = (name: string) => `${props.idPrefix}-${name}`

  async function save(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    const result = await props.onSave(form)
    setSaving(false)
    toast(result.ok ? props.savedText : result.error)
    if (result.ok) props.onDone()
  }

  return (
    <form className="panel-body" onSubmit={save} aria-label={props.saveLabel}>
      <label className="field" htmlFor={id('title')}>
        Title
        <input id={id('title')} className="input" maxLength={EVENT_LIMITS.title} value={form.title} onChange={(e) => set({ title: e.target.value })} placeholder="Outreach: robot demo at the library" />
      </label>
      <label className="check">
        <input type="checkbox" checked={form.allDay} onChange={(e) => set({ allDay: e.target.checked })} />
        All day, like a competition
      </label>
      {form.allDay ? (
        <div className="toolbar">
          <label className="field" htmlFor={id('first')}>
            First day
            <input
              id={id('first')}
              className="input"
              type="date"
              value={form.day}
              // Moving the first day past the last moves the last day too.
              onChange={(e) => set({ day: e.target.value, lastDay: e.target.value > form.lastDay ? e.target.value : form.lastDay })}
            />
          </label>
          <label className="field" htmlFor={id('last')}>
            Last day
            <input id={id('last')} className="input" type="date" value={form.lastDay} min={form.day} onChange={(e) => set({ lastDay: e.target.value })} />
          </label>
        </div>
      ) : (
        <div className="toolbar">
          <label className="field" htmlFor={id('day')}>
            Day
            <input id={id('day')} className="input" type="date" value={form.day} onChange={(e) => set({ day: e.target.value })} />
          </label>
          <label className="field" htmlFor={id('start')}>
            Starts
            <input id={id('start')} className="input" type="time" value={form.startClock} onChange={(e) => set({ startClock: e.target.value })} />
          </label>
          <label className="field" htmlFor={id('end')}>
            Ends
            <input id={id('end')} className="input" type="time" value={form.endClock} onChange={(e) => set({ endClock: e.target.value })} />
          </label>
        </div>
      )}
      <label className="field" htmlFor={id('location')}>
        Where (optional)
        <input id={id('location')} className="input" maxLength={EVENT_LIMITS.location} value={form.location} onChange={(e) => set({ location: e.target.value })} placeholder="The shop" />
      </label>
      <label className="field" htmlFor={id('description')}>
        Details (optional)
        <textarea id={id('description')} className="input" rows={2} value={form.description} onChange={(e) => set({ description: e.target.value })} placeholder="What to bring, when to leave" />
      </label>
      <div className="field">
        Sign-ups
        <Pick label="Sign-ups" options={SIGN_UP_KINDS} value={form.signUps} onChange={(signUps) => set({ signUps })} />
      </div>
      {form.signUps === 'In the app' && <span className="note">People tap Sign up on the event, and everyone can see who's going.</span>}
      {form.signUps === 'With a link' && (
        <label className="field" htmlFor={id('link')}>
          Sign-up link, to a Google Form or Slack post
          <input id={id('link')} className="input" type="url" inputMode="url" value={form.link} onChange={(e) => set({ link: e.target.value })} placeholder="https://forms.gle/abc123" />
        </label>
      )}
      <div className="toolbar">
        <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : props.saveLabel}</button>
        <button type="button" className="btn" onClick={props.onDone}>Cancel</button>
      </div>
    </form>
  )
}
