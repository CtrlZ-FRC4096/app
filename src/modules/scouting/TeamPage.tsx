import { useState, type FormEvent } from 'react'
import { shortDate } from '../../core/format'
import { useMemberNames } from '../../core/members'
import { href, navigate } from '../../core/router'
import { useSession } from '../../core/session'
import { toast } from '../../core/toast'
import { Bar, PageHead, Panel, Pill } from '../../core/ui'
import { MIN_MATCHES, pointsRange, useCurrentEvent, useIsStrategy, useScoutedTeams, useTeamPoints, useTeamSummary, type Tally, type TeamSummary } from './data'
import { PRESCOUT_QUESTIONS, prescoutHref, usePrescoutFor } from '../prescouting/data'
import TeamPhotos from './TeamPhotos'
// Stars belong to the Prescouting module (#118), and are the same here and
// there: starring a team in either place shows in both.
import { starredFirst, useStars } from '../prescouting/data'
import Stars from '../prescouting/Stars'
import TeamRank from './TeamRank'
import TeamVideos from './TeamVideos'
import TeamRatings from './TeamRatings'

/** "Team 9991", as a link to its team page, or just the words for someone off the strategy team (#167), who can't open it. */
export function TeamLink(props: { team: number }) {
  const strategy = useIsStrategy()
  if (!strategy) return <>Team {props.team}</>
  return <a href={href('scouting', 'team', String(props.team))}>Team {props.team}</a>
}

/** "2.5", or "3" for a whole number. */
function oneDecimal(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}

// Everything we scouted about one team, at #/scouting/team/9991. The sums
// come from teamSummary() in data.ts; this page only shows them. Each panel
// is its own component, so a new one (like Match 13's numbers or match
// videos) can be added below the others without changing these.
export default function TeamPage(props: { team: number | null }) {
  return (
    <div className="stack">
      {props.team === null ? (
        <PageHead title="Teams">Look up a team to see everything we scouted about them at this event.</PageHead>
      ) : (
        <TeamDetails team={props.team} />
      )}
      {/* Below the team, so on a phone the team's numbers come first. */}
      <FindTeam />
    </div>
  )
}

// A box to type a team number, and a link to every team we've scouted.
// Starred teams come first (team stars, then your own), even before anyone
// has scouted them.
function FindTeam() {
  const event = useCurrentEvent().key
  const me = useSession().id
  const list = starredFirst(useScoutedTeams(), useStars(event), me)
  const starred = list.filter((t) => t.group !== 'Everyone else')
  const rest = list.filter((t) => t.group === 'Everyone else')
  const [typed, setTyped] = useState('')

  function show(event: FormEvent) {
    event.preventDefault()
    const team = Number(typed)
    if (!Number.isInteger(team) || team <= 0) {
      toast('Enter a team number, like 4096.')
      return
    }
    setTyped('')
    navigate('scouting', 'team', String(team))
  }

  return (
    <Panel title="Find a team">
      <form className="panel-body" onSubmit={show}>
        <div className="toolbar">
          <label className="field" htmlFor="team-find">
            Team number
            <input id="team-find" className="input" style={{ width: '9ch', minHeight: 46, fontSize: 16 }} inputMode="numeric" value={typed} onChange={(e) => setTyped(e.target.value.replace(/\D/g, ''))} placeholder="4096" />
          </label>
          <button type="submit" className="btn btn-lg btn-primary" style={{ alignSelf: 'end', minHeight: 46 }}>Show</button>
        </div>
        {starred.length > 0 && (
          <div className="field" style={{ marginTop: 12 }}>
            Starred
            <div className="toolbar">
              {starred.map((t) => (
                <a
                  key={t.team}
                  className="btn"
                  style={{ minHeight: 44 }}
                  href={href('scouting', 'team', String(t.team))}
                  aria-label={`Team ${t.team}, ${t.group === 'Team stars' ? 'starred for the whole team' : 'starred by you'}`}
                >
                  {t.group === 'Team stars' ? '★' : '☆'} {t.team}
                </a>
              ))}
            </div>
          </div>
        )}
        {list.length === 0 ? (
          <p className="note" style={{ margin: 0 }}>No teams scouted at this event yet.</p>
        ) : (
          rest.length > 0 && (
            <div className="field" style={{ marginTop: 12 }}>
              Scouted at this event
              <div className="toolbar">
                {rest.map((t) => (
                  <a key={t.team} className="btn" style={{ minHeight: 44 }} href={href('scouting', 'team', String(t.team))}>{t.team}</a>
                ))}
              </div>
            </div>
          )
        )}
      </form>
    </Panel>
  )
}

function TeamDetails(props: { team: number }) {
  const event = useCurrentEvent().key
  const summary = useTeamSummary(props.team)
  const scouted = `${summary.matchCount} match ${summary.matchCount === 1 ? 'entry' : 'entries'}, ${summary.pitCount} pit ${summary.pitCount === 1 ? 'entry' : 'entries'}`
  return (
    <>
      <PageHead title={`Team ${props.team}`}>
        {summary.matchCount + summary.pitCount === 0 ? `Nothing scouted for team ${props.team} yet.` : `Everything we scouted at this event: ${scouted}.`}
      </PageHead>
      <Panel title="Stars">
        <div className="panel-body">
          <Stars event={event} team={props.team} />
        </div>
      </Panel>
      <TeamRank team={props.team} />
      <TeamPhotos team={props.team} />
      <AveragePoints team={props.team} />
      {summary.matchCount > 0 && <Numbers summary={summary} />}
      <TeamRatings team={props.team} />
      {summary.matchCount + summary.pitCount > 0 && <HowOften summary={summary} />}
      {summary.written.length > 0 && <WrittenAnswers summary={summary} />}
      <Prescouting team={props.team} />
      <TeamVideos team={props.team} />
    </>
  )
}

// The team's average points per match (APS) from our scouting, with its
// range, and Match 13's xP as a second opinion (#166). teamPoints() in
// data.ts works them out.
function AveragePoints(props: { team: number }) {
  const { pointsFor } = useTeamPoints()
  const { aps, xp, fewMatches } = pointsFor(props.team)
  if (!aps && xp === null) return null
  return (
    <Panel title="Average points (APS)" aside={xp !== null && <span className="note">{`Match 13 xP: ${xp.toFixed(1)}`}</span>}>
      <p className="panel-body" style={{ margin: 0 }}>
        {aps ? (
          <>
            <strong className="tnum" style={{ fontSize: 22 }}>{`APS ${pointsRange(aps.average, aps.low, aps.high)}`}</strong>{' '}
            <span className="note">{`from ${aps.matches} ${aps.matches === 1 ? 'match' : 'matches'}`}</span>
            {fewMatches && <><br /><span className="note">{`Fewer than ${MIN_MATCHES} matches, so this is only a guess.`}</span></>}
          </>
        ) : (
          <span className="note">Not scouted in a match yet.</span>
        )}
      </p>
    </Panel>
  )
}

// What we expected from the team before the event (#119), from Prescouting,
// with a link to their full prescouting page. The team page is what we saw
// in matches; this puts the two one tap apart.
const PRESCOUT_SHOWN = ['key_task', 'strengths', 'weaknesses', 'auto_paths'] as const

function Prescouting(props: { team: number }) {
  const event = useCurrentEvent().key
  const notes = usePrescoutFor(event, props.team)
  const link = <a href={prescoutHref(event, props.team)}>{notes ? 'Full prescouting page →' : 'Prescout them →'}</a>
  return (
    <Panel title="Prescouting" aside={link}>
      {notes ? (
        <div className="row-list">
          {PRESCOUT_QUESTIONS.filter((q) => (PRESCOUT_SHOWN as readonly string[]).includes(q.key) && notes[q.key].trim()).map((q) => (
            <div key={q.key}>
              <span style={{ overflowWrap: 'anywhere', whiteSpace: 'pre-line' }}>
                <span className="note">{q.label}</span>
                <br />
                {notes[q.key].trim()}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p className="panel-body muted" style={{ margin: 0 }}>Not prescouted yet</p>
      )}
    </Panel>
  )
}

// The average of each counter in season.ts, and each match's count.
function Numbers(props: { summary: TeamSummary }) {
  return (
    <Panel title="Numbers" aside={<span className="note">Average per match</span>}>
      <div className="row-list">
        {props.summary.counters.map((c) => (
          <div key={c.key} style={{ flexWrap: 'wrap' }}>
            <span>{c.label}</span>
            <strong className="tnum" style={{ marginLeft: 'auto', fontSize: 22 }}>{c.average === null ? '–' : oneDecimal(c.average)}</strong>
            <span style={{ display: 'flex', flexWrap: 'wrap', gap: 6, flexBasis: '100%' }}>
              {c.perMatch.map((m, i) => (
                <Pill key={i} tone="plain">{`Match ${m.match}: ${m.count}`}</Pill>
              ))}
            </span>
          </div>
        ))}
      </div>
    </Panel>
  )
}

// How often each answer came up, as bars.
function HowOften(props: { summary: TeamSummary }) {
  const s = props.summary
  return (
    <Panel
      title="How often"
      aside={s.matchCount > 0 && <span className="note">{`Broke down in ${s.brokeDown} of ${s.matchCount} · Died or browned out in ${s.brownedOut} of ${s.matchCount}`}</span>}
    >
      <div className="panel-body">
        {s.matchCount > 0 && (
          <>
            <Tallies title="Endgame" tallies={s.endgame} />
            <Tallies title="Role" tallies={s.roles} />
            <Tallies title="Driver skill (5 is best)" tallies={s.driverSkill} />
            <Tallies title="E-stop or A-stop" tallies={s.stops} />
            {s.brokeDown > 0 && <Tallies title="What broke (when it broke down)" tallies={s.brokeParts} />}
            {s.autoSides.some((t) => t.count > 0) && <Tallies title="Auto starting side (seen in matches)" tallies={s.autoSides} />}
            <Tallies title="Ranking points their alliance earned" tallies={s.rankingPoints} />
          </>
        )}
        {s.pitCount > 0 && <Tallies title="Drivetrain (pit)" tallies={s.drivetrain} />}
      </div>
    </Panel>
  )
}

function Tallies(props: { title: string; tallies: Tally[] }) {
  return (
    <div className="field">
      {props.title}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr) auto', gap: '6px 10px', alignItems: 'center', color: 'var(--ink)', fontSize: 14 }}>
        {props.tallies.map((t) => (
          <div key={t.option} style={{ display: 'contents' }}>
            <span>{t.option}</span>
            <Bar value={t.share} label={`${props.title}: ${t.option}`} />
            <span className="tnum">{t.count}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// Match notes and pit answers, newest first, with who wrote them.
function WrittenAnswers(props: { summary: TeamSummary }) {
  const nameOf = useMemberNames()
  return (
    <Panel title="Written answers">
      <div className="row-list">
        {props.summary.written.map((w, i) => (
          <div key={i}>
            <span style={{ overflowWrap: 'anywhere' }}>
              {w.text}
              <br />
              <span className="note">
                {w.kind === 'pit' ? 'Pit' : `Match ${w.match}`} · {w.question} · {nameOf(w.by)} · {shortDate(w.at)}
                {w.kind === 'pit' && w.match !== null ? ` · before match ${w.match}` : ''}
              </span>
            </span>
          </div>
        ))}
      </div>
    </Panel>
  )
}
