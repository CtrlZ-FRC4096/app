import { Callout, PageHead, Panel } from '../../core/ui'
import { WEEKS_AHEAD, eventsByDay, loadEvents, plainText, timeOfDay, updatedText, useCalendar } from './data'

// The page reads the events with a hook (useCalendar) and works out what to
// show with the functions in data.ts. Events are changed in Google Calendar.
export default function CalendarPage() {
  const { events, loadedAt, error, loading } = useCalendar()
  const days = eventsByDay(events)

  return (
    <>
      <PageHead title="Calendar">
        What's coming up in the next {WEEKS_AHEAD} weeks. Add or change an event in Google Calendar and it shows here within a few minutes.
      </PageHead>
      <div className="toolbar">
        <button type="button" className="btn btn-sm" disabled={loading} onClick={() => void loadEvents()}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
        <span className="note">{updatedText(loadedAt)}</span>
      </div>
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
              {day.events.map((event) => {
                const description = plainText(event.description)
                return (
                  <div key={event.id}>
                    <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
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
                    </span>
                    {event.url && (
                      <a className="btn btn-sm" style={{ marginLeft: 'auto', flexShrink: 0 }} href={event.url} target="_blank" rel="noreferrer">
                        Open
                      </a>
                    )}
                  </div>
                )
              })}
            </div>
          </Panel>
        ))
      )}
    </>
  )
}
