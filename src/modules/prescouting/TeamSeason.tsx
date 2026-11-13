import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useMemberNames } from '../../core/members'
import { currentUser } from '../../core/session'
import type { Result } from '../../core/table'
import { toast } from '../../core/toast'
import { Panel, Pick, Stepper } from '../../core/ui'
import { COUNTERS, ENDGAME, ROLES, eventWhenWhere, getTeamEvents, getTeamMatches, tbaEventUrl, type TbaEvent } from '../scouting/data'
import { prescoutAverages, savePrescoutMatch, seasonMatches, usePrescoutMatches, type PrescoutMatch, type PrescoutMatchFields, type SeasonMatch } from './data'

/** Big enough to tap. */
const TAP = { minHeight: 44 }

/** "2.5", or "3" for a whole number, or "—" with nothing to average. */
function number(n: number | null): string {
  if (n === null) return '—'
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}

/**
 * Load something from The Blue Alliance when the page opens, again when
 * `load` changes, and again with retry(). Null while loading. Make `load`
 * with useCallback, so it only changes when what it loads changes.
 */
function useLoaded<T>(load: () => Promise<Result<T>>): [Result<T> | null, () => void] {
  const [tries, setTries] = useState(0)
  const [result, setResult] = useState<{ tries: number; load: () => Promise<Result<T>>; value: Result<T> } | null>(null)
  useEffect(() => {
    let current = true
    void load().then((value) => current && setResult({ tries, load, value }))
    return () => {
      current = false
    }
  }, [load, tries])
  const fresh = result && result.tries === tries && result.load === load ? result.value : null
  return [fresh, () => setTries((n) => n + 1)]
}

// A team's season (#153), on their prescouting page: their averages from
// the matches we scouted from video, then every event they've been to (or
// are going to) this year. Tap an event to see their matches there, with
// links to the videos, and scout any match. The sums and saving are in
// data.ts: prescoutAverages() and savePrescoutMatch().
export default function TeamSeason(props: { event: string; team: number }) {
  const year = Number(props.event.slice(0, 4))
  const [events, retry] = useLoaded(useCallback(() => getTeamEvents(props.team, year), [props.team, year]))
  const looks = usePrescoutMatches(props.team)
  const season = prescoutAverages(looks)

  return (
    <Panel title={`${year} season`} aside={<span className="note">Scouted from video</span>}>
      <div className="panel-body">
        <Averages title="Season averages" averages={season} />
      </div>
      {!events ? (
        <p className="panel-body muted" style={{ margin: 0 }}>Loading their events…</p>
      ) : !events.ok ? (
        <div className="panel-body toolbar">
          <span role="alert">{events.error}</span>
          <button type="button" className="btn" style={TAP} onClick={retry}>Try again</button>
        </div>
      ) : events.value.length === 0 ? (
        <p className="panel-body muted" style={{ margin: 0 }}>{`The Blue Alliance doesn't list any events for team ${props.team} in ${year}.`}</p>
      ) : (
        <div>
          {events.value.map((e) => <EventRow key={e.key} team={props.team} event={e} looks={looks.filter((l) => l.event_key === e.key)} />)}
        </div>
      )}
    </Panel>
  )
}

function Averages(props: { title: string; averages: ReturnType<typeof prescoutAverages> }) {
  const a = props.averages
  if (a.matches === 0) return <p className="note" style={{ margin: 0 }}>{`${props.title}: no matches scouted from video yet.`}</p>
  const endgame = a.endgame.filter((e) => e.count > 0).map((e) => `${e.option} ${e.count}`).join(', ')
  return (
    <p style={{ margin: 0, overflowWrap: 'anywhere' }}>
      <strong>{props.title}</strong> <span className="note">{`from ${a.matches} ${a.matches === 1 ? 'match' : 'matches'}`}</span>
      <br />
      {a.counters.map((c) => `${c.label} ${number(c.average)}`).join(' · ')}
      {endgame && <><br /><span className="note">{`Endgame: ${endgame}`}</span></>}
    </p>
  )
}

/** One event: its name, dates and TBA link. Tap to see the team's matches there. */
function EventRow(props: { team: number; event: TbaEvent; looks: PrescoutMatch[] }) {
  const [open, setOpen] = useState(false)
  const { event } = props
  return (
    <section style={{ borderTop: '1px solid var(--line)', padding: '10px 16px', display: 'grid', gap: 8 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 10px', alignItems: 'center' }}>
        <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
          <strong>{event.name}</strong>
          <br />
          <span className="note">{eventWhenWhere(event)}</span>
        </span>
        <span className="toolbar" style={{ marginLeft: 'auto' }}>
          <a className="btn" style={TAP} href={tbaEventUrl(event.key)} target="_blank" rel="noreferrer">TBA ↗</a>
          <button type="button" className="btn" style={TAP} aria-expanded={open} onClick={() => setOpen((now) => !now)}>{open ? 'Hide matches' : 'Matches'}</button>
        </span>
      </div>
      {open && <EventMatches team={props.team} event={event.key} looks={props.looks} />}
    </section>
  )
}

function EventMatches(props: { team: number; event: string; looks: PrescoutMatch[] }) {
  const [matches, retry] = useLoaded(useCallback(() => getTeamMatches(props.team, props.event), [props.team, props.event]))
  if (!matches) return <p className="muted" style={{ margin: 0 }}>Loading matches…</p>
  if (!matches.ok) {
    return (
      <div className="toolbar">
        <span role="alert">{matches.error}</span>
        <button type="button" className="btn" style={TAP} onClick={retry}>Try again</button>
      </div>
    )
  }
  const rows = seasonMatches(matches.value, props.team)
  if (rows.length === 0) return <p className="muted" style={{ margin: 0 }}>No matches at this event yet.</p>
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <Averages title="This event" averages={prescoutAverages(props.looks)} />
      {rows.map((m) => <MatchRow key={m.key} team={props.team} event={props.event} match={m} looks={props.looks.filter((l) => l.match_key === m.key)} />)}
    </div>
  )
}

/** One match: name, alliance, score and Watch links, everyone's looks at it, and a form to scout it. */
function MatchRow(props: { team: number; event: string; match: SeasonMatch; looks: PrescoutMatch[] }) {
  const { match } = props
  const [scouting, setScouting] = useState(false)
  const nameOf = useMemberNames()
  const me = currentUser()?.id
  const mine = props.looks.find((l) => l.created_by === me)
  const result = match.score ? `${match.score.ours > match.score.theirs ? 'Won' : match.score.ours < match.score.theirs ? 'Lost' : 'Tied'} ${match.score.ours}–${match.score.theirs}` : 'Not played yet'
  return (
    <div style={{ border: '1px solid var(--line)', borderRadius: 'var(--radius)', padding: 10, display: 'grid', gap: 6 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 10px', alignItems: 'center' }}>
        <strong>{match.label}</strong>
        <span style={{ color: `var(--${match.alliance}-alliance)` }}>{match.alliance === 'red' ? 'Red' : 'Blue'}</span>
        <span className="note">{result}</span>
        <span className="toolbar" style={{ marginLeft: 'auto' }}>
          {match.videos.map((link, i) => (
            <a key={link} className="btn" style={TAP} href={link} target="_blank" rel="noreferrer">{i === 0 ? 'Watch ↗' : `Watch (${i + 1}) ↗`}</a>
          ))}
          {match.score && (
            <button type="button" className="btn" style={TAP} aria-expanded={scouting} onClick={() => setScouting((now) => !now)}>
              {scouting ? 'Close' : mine ? 'Change mine' : 'Scout it'}
            </button>
          )}
        </span>
      </div>
      {props.looks.map((l) => (
        <p key={l.id} className="note" style={{ margin: 0, overflowWrap: 'anywhere' }}>
          {`${nameOf(l.created_by)}: ${COUNTERS.map((c) => `${c.label} ${l.counts[c.key] ?? 0}`).join(', ')} · ${l.endgame}${l.roles.length ? ` · ${l.roles.join(', ')}` : ''}${l.notes ? ` · ${l.notes}` : ''}`}
        </p>
      ))}
      {scouting && <ScoutForm team={props.team} event={props.event} matchKey={match.key} saved={mine} done={() => setScouting(false)} />}
    </div>
  )
}

/** The season's counters, endgame and roles, as on the match form, and notes. Saves with savePrescoutMatch(). */
function ScoutForm(props: { team: number; event: string; matchKey: string; saved: PrescoutMatch | undefined; done: () => void }) {
  const start: PrescoutMatchFields = props.saved
    ? { counts: props.saved.counts, endgame: props.saved.endgame, roles: props.saved.roles, notes: props.saved.notes }
    : { counts: Object.fromEntries(COUNTERS.map((c) => [c.key, 0])), endgame: ENDGAME[0], roles: [], notes: '' }
  const [fields, setFields] = useState(start)
  const [busy, setBusy] = useState(false)
  const id = (part: string) => `prescout-${props.matchKey}-${part}`

  async function save(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    const result = await savePrescoutMatch(props.team, props.event, props.matchKey, fields)
    setBusy(false)
    if (!result.ok) return toast(result.error)
    toast('Saved.')
    props.done()
  }

  const toggleRole = (role: string) => setFields((f) => ({ ...f, roles: f.roles.includes(role) ? f.roles.filter((r) => r !== role) : [...f.roles, role] }))
  return (
    <form onSubmit={save} style={{ display: 'grid', gap: 10 }}>
      {COUNTERS.map((c) => (
        <label key={c.key} className="field" htmlFor={id(c.key)}>
          {c.label}
          <Stepper id={id(c.key)} label={c.label} value={fields.counts[c.key] ?? 0} onChange={(n) => setFields((f) => ({ ...f, counts: { ...f.counts, [c.key]: n } }))} />
        </label>
      ))}
      <div className="field">
        Endgame
        <Pick label="Endgame" options={ENDGAME} value={fields.endgame} onChange={(endgame) => setFields((f) => ({ ...f, endgame }))} />
      </div>
      <div className="field">
        Role (choose all that fit)
        <div className="pick" role="group" aria-label="Role">
          {ROLES.map((role) => (
            <button key={role} type="button" aria-pressed={fields.roles.includes(role)} onClick={() => toggleRole(role)}>{role}</button>
          ))}
        </div>
      </div>
      <label className="field" htmlFor={id('notes')}>
        Notes
        <textarea id={id('notes')} className="input" style={{ fontSize: 16 }} rows={2} value={fields.notes} onChange={(e) => setFields((f) => ({ ...f, notes: e.target.value }))} placeholder="Anything the numbers don't show" />
      </label>
      <div className="toolbar">
        <button type="submit" className="btn btn-primary" style={TAP} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
      </div>
    </form>
  )
}
