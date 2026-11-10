import { useEffect, useState } from 'react'
import { QuietBoundary } from '../../core/ErrorBoundary'
import { isMentor, useSession } from '../../core/session'
import { toast } from '../../core/toast'
import { Panel, Pick } from '../../core/ui'
import {
  chooseEvent, eventStore, eventWhenWhere, eventsTable, getAllEvents, getOurEvents, latestEvent, lookupSeasons, searchEvents, useCurrentEvent,
  type TbaEvent,
} from './data'
import type { Result } from '../../core/table'

const BOX = { minHeight: 46, fontSize: 16 }

/**
 * Which event the team is scouting, at the top of every Scouting page. A
 * mentor picks it here, from our events this season or by searching every
 * event, and every phone switches to it. Everyone else sees which event it
 * is. The pick is saved in the scouting_events table (chooseEvent() in
 * data.ts).
 */
export default function EventPicker() {
  const event = useCurrentEvent()
  const { role } = useSession()
  const [open, setOpen] = useState(false)
  const mentor = isMentor(role)

  return (
    <Panel>
      <QuietBoundary>
        <EventSync />
      </QuietBoundary>
      <div className="panel-body" style={{ display: 'grid', gap: 8 }}>
        <div className="toolbar" style={{ justifyContent: 'space-between' }}>
          <span>
            Event: <strong>{event.name ?? event.key}</strong> {event.name && <span className="muted">({event.key})</span>}
          </span>
          {mentor && (
            <button type="button" className="btn" style={BOX} aria-expanded={open} onClick={() => setOpen(!open)}>
              {open ? 'Close' : 'Change event'}
            </button>
          )}
        </div>
        {!event.name && (
          <p className="note" style={{ margin: 0 }}>
            {mentor ? 'Nobody has picked the event yet, so this is the one in season.ts. Pick the right one with Change event.' : 'A mentor picks the event for the whole team.'}
          </p>
        )}
        {open && mentor && <Lookup current={event.key} onPicked={() => setOpen(false)} />}
      </div>
    </Panel>
  )
}

/**
 * Keeps this phone's copy of the current event up to date: from the team
 * database, or from the copy of it kept on the phone with no connection.
 * It's in a QuietBoundary, so if the database can't be reached the rest of
 * the page carries on with the copy it already has.
 */
function EventSync() {
  const latest = latestEvent(eventsTable.useRows())
  const key = latest?.key ?? null
  const name = latest?.name ?? null
  useEffect(() => {
    const saved = eventStore.get()
    if (key !== (saved?.key ?? null) || name !== (saved?.name ?? null)) eventStore.set(key && name ? { key, name } : null)
  }, [key, name])
  return null
}

/** Our events this season, and a search for any other event. */
function Lookup(props: { current: string; onPicked: () => void }) {
  const seasons = lookupSeasons()
  const [year, setYear] = useState(seasons[0])
  const [ours, setOurs] = useState<Result<TbaEvent[]> | null>(null)
  const [all, setAll] = useState<Result<TbaEvent[]> | null>(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)

  // Our events for the season, straight away. Every event only once someone searches.
  useEffect(() => {
    let current = true
    void getOurEvents(year).then((result) => current && setOurs(result))
    return () => {
      current = false
    }
  }, [year])
  useEffect(() => {
    if (!text.trim() || all) return
    let current = true
    void getAllEvents(year).then((result) => current && setAll(result))
    return () => {
      current = false
    }
  }, [text, year, all])

  function changeSeason(next: number) {
    setYear(next)
    setOurs(null)
    setAll(null)
  }

  async function pick(event: TbaEvent) {
    setBusy(true)
    const result = await chooseEvent(event)
    setBusy(false)
    if (!result.ok) return toast(result.error)
    toast(`The team is scouting ${event.name} now.`)
    props.onPicked()
  }

  const found = all?.ok ? searchEvents(all.value, text) : []
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <Pick label="Season" options={seasons} value={year} onChange={changeSeason} />
      <section aria-label={`Our events in ${year}`} style={{ display: 'grid', gap: 6 }}>
        <strong>Our events in {year}</strong>
        {!ours ? (
          <p className="note" style={{ margin: 0 }}>Getting our events…</p>
        ) : !ours.ok ? (
          <p role="alert" style={{ margin: 0 }}>{ours.error}</p>
        ) : ours.value.length === 0 ? (
          <p className="note" style={{ margin: 0 }}>We aren't registered for any events in {year} yet. Search for the event below.</p>
        ) : (
          <EventList events={ours.value} current={props.current} busy={busy} onPick={pick} />
        )}
      </section>
      <label className="field" htmlFor="event-search">
        Find another event, like a World division
        <input
          id="event-search"
          className="input"
          style={BOX}
          type="search"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Name, city or key"
        />
      </label>
      {text.trim() && (
        !all ? (
          <p className="note" style={{ margin: 0 }}>Getting {year}'s events…</p>
        ) : !all.ok ? (
          <p role="alert" style={{ margin: 0 }}>{all.error}</p>
        ) : found.length === 0 ? (
          <p className="note" style={{ margin: 0 }}>No {year} event matches "{text.trim()}". Check the spelling, or try the other season.</p>
        ) : (
          <EventList events={found} current={props.current} busy={busy} onPick={pick} />
        )
      )}
    </div>
  )
}

/** One big button per event. */
function EventList(props: { events: TbaEvent[]; current: string; busy: boolean; onPick: (event: TbaEvent) => void }) {
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      {props.events.map((event) => (
        <button
          key={event.key}
          type="button"
          className="btn"
          style={{ ...BOX, display: 'grid', justifyContent: 'start', justifyItems: 'start', textAlign: 'left', height: 'auto', padding: '8px 12px', overflowWrap: 'anywhere' }}
          disabled={props.busy || event.key === props.current}
          onClick={() => props.onPick(event)}
        >
          <strong>{event.name}{event.key === props.current ? ' (the event now)' : ''}</strong>
          <span className="note">{eventWhenWhere(event)} · {event.key}</span>
        </button>
      ))}
    </div>
  )
}
