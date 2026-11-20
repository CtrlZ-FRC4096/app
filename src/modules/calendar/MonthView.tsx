import { useState } from 'react'
import type { CalendarEvent } from '../../core/calendar'
import { plural } from '../../core/format'
import { Panel } from '../../core/ui'
import { addMonths, monthGrid, thisMonth, type GridDay } from './data'
import './calendar.css'

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/**
 * The month at the bottom of the Calendar page (#227): a square for each day,
 * Sunday to Saturday, with its events. Tapping a day or an event calls
 * onPickDay with the day in the list above that shows it. On a phone or
 * tablet the squares show dots instead of titles (calendar.css). monthGrid() in data.ts
 * works out what goes in each square; this only draws them.
 */
export function MonthView(props: { events: CalendarEvent[]; loadedAt: string | null; onPickDay: (day: string) => void }) {
  // Chicago's month, not the phone's.
  const current = thisMonth()
  const [month, setMonth] = useState(current)
  const grid = monthGrid(month, props.events, props.loadedAt)

  return (
    <Panel
      // aria-live: a screen reader reads out the new month after Previous or Next.
      title={<h2 aria-live="polite">{grid.title}</h2>}
      aside={
        // At the top, so they don't move under a finger when a month has more or fewer weeks.
        <div className="toolbar calendar-nav">
          <button type="button" className="btn" aria-label="Previous month" onClick={() => setMonth(addMonths(month, -1))}>
            Previous
          </button>
          {/* Never disabled: disabling it on this month would drop the keyboard focus of whoever just pressed it. */}
          <button type="button" className="btn" onClick={() => setMonth(current)}>
            Today
          </button>
          <button type="button" className="btn" aria-label="Next month" onClick={() => setMonth(addMonths(month, 1))}>
            Next
          </button>
        </div>
      }
    >
      {grid.note && <p className="panel-body note calendar-note">{grid.note}</p>}
      <div className="calendar-grid">
        {WEEKDAYS.map((name) => (
          <span key={name} className="calendar-weekday" aria-hidden="true">
            {name}
          </span>
        ))}
        {grid.weeks.flat().map((day) => (
          <DaySquare key={day.day} day={day} onPickDay={props.onPickDay} />
        ))}
      </div>
    </Panel>
  )
}

/** One day: its date, and its events as titles (dots on a phone). */
function DaySquare(props: { day: GridDay; onPickDay: (day: string) => void }) {
  const { day, onPickDay } = props
  // A day with nothing on is a plain number: no button to tab to.
  const goTo = day.listDay
  return (
    <div className="calendar-day" data-out={day.inMonth ? undefined : ''} data-past={day.past ? '' : undefined} aria-current={day.isToday ? 'date' : undefined}>
      {goTo ? (
        // The date is the day's button. CSS stretches it over the whole square, so a tap anywhere on it works.
        <button type="button" className="calendar-date" aria-label={`${day.name}: ${plural(day.events.length, 'event', 'events')}`} onClick={() => onPickDay(goTo)}>
          {day.date}
        </button>
      ) : (
        <span className="calendar-date">{day.date}</span>
      )}
      {goTo && (
        <>
          <ul className="calendar-events">
            {day.shown.map((e) => (
              <li key={e.event.id}>
                {/* title: the whole title shows when you point at it, if it's cut short. */}
                <button type="button" className="calendar-event" data-all-day={e.event.allDay ? '' : undefined} title={e.label} onClick={() => onPickDay(e.listDay)}>
                  {e.label}
                </button>
              </li>
            ))}
            {day.more > 0 && (
              <li>
                <button type="button" className="calendar-event calendar-more" onClick={() => onPickDay(goTo)}>
                  +{day.more} more
                </button>
              </li>
            )}
          </ul>
          <span className="calendar-dots" aria-hidden="true">
            {day.events.map((e) => (
              <span key={e.event.id} className="calendar-dot" data-all-day={e.event.allDay ? '' : undefined} />
            ))}
          </span>
        </>
      )}
    </div>
  )
}
