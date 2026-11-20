import { useEffect, useRef, useState, type RefObject } from 'react'
import { QuietBoundary } from '../../core/ErrorBoundary'
import { toast } from '../../core/toast'
import { Panel } from '../../core/ui'
import { useCurrentEvent, useSavedSchedule } from '../scouting/data'
import {
  DISPLAY_TICK_MS, clockTime, keepPitDisplayFresh, keepScreenAwake, matchProgress, readyText, usePitChecklist, usePitChecks, usePitDisplay,
  type DisplayTeam,
} from './data'

// The pit display (#161), at #/status/display: a page left open on a TV or
// laptop in the pit, so anyone walking past can see when our next match is,
// who we're with and against, and whether we're ready. Nobody needs to
// touch it. It keeps itself up to date (keepPitDisplayFresh() in data.ts)
// and keeps the screen on where the browser can (keepScreenAwake()). The
// sums are pitDisplay() in data.ts: this page only shows what it gives back.
export function PitDisplay() {
  const box = useRef<HTMLDivElement>(null)
  const now = useNow(DISPLAY_TICK_MS)
  const event = useCurrentEvent()
  const view = usePitDisplay(now)
  const savedAt = useSavedSchedule(event.key)?.savedAt ?? ''
  const screen = useFullScreen(box)

  // These two return their stop functions on purpose: React calls them when the page closes.
  useEffect(() => keepPitDisplayFresh(event.key), [event.key])
  useEffect(() => keepScreenAwake(), [])

  const { next } = view
  return (
    <div ref={box} className="pit-display">
      <h1 className="pit-sr-only">Pit display</h1>
      <div className="pit-display-corner">
        <span>{event.name ?? event.key}</span>
        {view.updated && <span className="pit-display-updated" data-stale={view.stale || undefined}>{view.updated}</span>}
        {screen.can && !screen.full && <button type="button" className="btn" onClick={screen.enter}>Full screen</button>}
      </div>
      {/* Scouting keeps this device's copy of the team's event; until it has been open here, it's the one in season.ts. */}
      {event.name === null && <p className="note">Not the right event? Open Scouting on this device once, with a connection.</p>}

      <div className="pit-display-main">
        <section className="pit-display-next" data-queue={next?.queueNow || undefined} aria-label="Our next match">
          {next ? (
            <>
              <p className="pit-display-match">
                {`${next.label} · `}<span className="pit-display-chip" data-alliance={next.alliance}>{next.alliance}</span>
              </p>
              <p className="pit-display-countdown" data-words={!next.counting || undefined}>{next.countdown}</p>
              {next.time !== null && <p className="pit-display-line">{`Expected ${clockTime(next.time, now)}`}</p>}
              <p className="pit-display-line">{next.awayText}</p>
              {next.queueNow && <p className="pit-display-queue">Queue now</p>}
              {/* The checklist needs the team database. With no connection only this line goes, not the whole
                  display, and it tries again each time the schedule updates. */}
              <QuietBoundary key={savedAt}>
                <Readiness matchKey={next.key} />
              </QuietBoundary>
            </>
          ) : (
            view.noMatch && (
              <>
                <p className="pit-display-countdown" data-words>{view.noMatch.text}</p>
                {view.noMatch.note && <p className="pit-display-line">{view.noMatch.note}</p>}
              </>
            )
          )}
        </section>
        {next && (
          <div className="pit-display-alliances">
            <Alliance color={next.alliance} title="with us" teams={next.ours} />
            <Alliance color={next.alliance === 'Red' ? 'Blue' : 'Red'} title="against us" teams={next.theirs} />
          </div>
        )}
      </div>

      <div className="pit-display-lower">
        <Panel title="How we're doing">
          <div className="panel-body pit-display-standing">
            <strong>{view.standing}</strong>
            <span>{view.lastResult ? `Last: ${view.lastResult}` : 'No matches played yet'}</span>
          </div>
        </Panel>
        {view.comingUp.length > 0 && (
          <Panel title="Coming up">
            <div className="row-list pit-display-coming">
              {view.comingUp.map((match) => (
                <div key={match.key}>
                  <strong>{match.label}</strong>
                  <span className="pit-display-chip" data-alliance={match.alliance}>{match.alliance}</span>
                  {match.partners.length > 0 && <span>{`with ${match.partners.join(', ')}`}</span>}
                  <span className="pit-display-when">{clockTime(match.time, now)}</span>
                </div>
              ))}
            </div>
          </Panel>
        )}
      </div>
    </div>
  )
}

/** One alliance: each team's number, name, rank, record and rating, with us marked. */
function Alliance(props: { color: 'Red' | 'Blue'; title: string; teams: DisplayTeam[] }) {
  return (
    <section className="pit-display-alliance" data-alliance={props.color}>
      <h2>{`${props.color} · ${props.title}`}</h2>
      <ul>
        {props.teams.map((team) => (
          <li key={team.number} data-us={team.us || undefined}>
            <span className="pit-display-team-head">
              <strong className="tnum">{team.number}</strong>
              {team.name && <span>{team.name}</span>}
            </span>
            <span>{`${team.standing} · ${team.rating}`}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** "Ready" or "3 of 14 checklist items left" for a match, from the pit checklist. */
function Readiness(props: { matchKey: string }) {
  const progress = matchProgress(usePitChecklist(), usePitChecks(), props.matchKey)
  return (
    <p className="pit-display-ready" data-ready={progress.ready || undefined} data-empty={progress.total === 0 || undefined}>
      {readyText(progress)}
    </p>
  )
}

/** The time now, ticking every `everyMs` and when the screen comes back on. It's only a clock: it never asks the network. */
function useNow(everyMs: number): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const tick = () => setNow(new Date())
    const timer = setInterval(tick, everyMs)
    // Straight away when the screen comes back on, not up to 30 seconds later.
    document.addEventListener('visibilitychange', tick)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [everyMs])
  return now
}

/**
 * Full screen for the display alone, so the app's top bar and menus go
 * away. Browsers only allow it after a tap or click, so it's a button,
 * hidden while in full screen and where the browser can't (an iPhone).
 * Esc leaves full screen.
 */
function useFullScreen(box: RefObject<HTMLDivElement | null>) {
  const [can] = useState(() => globalThis.document?.fullscreenEnabled === true)
  const [full, setFull] = useState(false)
  useEffect(() => {
    const changed = () => setFull(document.fullscreenElement !== null && document.fullscreenElement === box.current)
    document.addEventListener('fullscreenchange', changed)
    return () => document.removeEventListener('fullscreenchange', changed)
  }, [box])
  function enter() {
    box.current?.requestFullscreen().catch(() => toast("This browser didn't allow full screen. Use its own full screen instead: F11 on most laptops."))
  }
  return { can, full, enter }
}
