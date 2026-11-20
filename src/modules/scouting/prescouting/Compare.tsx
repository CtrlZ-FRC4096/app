import type { ReactNode } from 'react'
import { useMemberNames } from '../../../core/members'
import { toast } from '../../../core/toast'
import { PageHead, Panel } from '../../../core/ui'
import { COUNTERS } from '../season'
import {
  MAX_COMPARE, MIN_COMPARE, PRESCOUT_QUESTIONS, bestValue, clearCompare, compareHref, formatEpa, isEventKey, parseCompare, prescoutHref, reloadPrescoutTeams, tickCompare,
  useCompareChoice, useCompareTeams, type CompareTeam,
} from './data'
import TierBadge from './TierBadge'

/** Big enough to tap. */
const TAP = { minHeight: 44 }

// Comparing teams side by side (#233), at
// #/scouting/prescouting/<event>/compare/<team>,<team>,... The address holds
// the teams, so a link sent to someone else opens the same teams. Every
// detail comes from useCompareTeams() in data.ts; this page only shows it.
//
// Each section (EPA, Strengths, ...) has one cell per team. On a phone the
// cells stack, one team under another, so nothing scrolls sideways; on a
// wider screen they sit side by side, one column per team
// (.prescout-compare in prescouting.css).
export default function ComparePage(props: { event: string; teams: string }) {
  const teams = parseCompare(props.teams)
  if (!isEventKey(props.event) || teams.length < MIN_COMPARE) {
    return (
      <Panel>
        <div className="panel-body" style={{ display: 'grid', gap: 10 }}>
          <p style={{ margin: 0 }}>{`That address isn't ${MIN_COMPARE} to ${MAX_COMPARE} teams to compare. Go back to the list and tick the teams you want.`}</p>
          <div className="toolbar"><a className="btn" style={TAP} href={prescoutHref()}>All teams</a></div>
        </div>
      </Panel>
    )
  }
  return <Comparison event={props.event} teams={teams} />
}

function Comparison(props: { event: string; teams: number[] }) {
  const { event } = props
  const { list, teams } = useCompareTeams(event, props.teams)
  const nameOf = useMemberNames()
  const epaBest = bestValue(teams.map((t) => t.epa))
  const xpBest = bestValue(teams.map((t) => t.xp))

  async function copy() {
    try {
      // The full link, since the installed app has no address bar to copy from.
      await navigator.clipboard.writeText(new URL(compareHref(event, props.teams), location.href).href)
      toast('Copied the link. Send it to anyone on the team.')
    } catch {
      toast("Couldn't copy the link. Check the browser is allowed to use the clipboard, then try again.")
    }
  }

  return (
    <>
      <div className="toolbar">
        <a className="btn" style={TAP} href={prescoutHref()}>← All teams</a>
        <button type="button" className="btn" style={TAP} onClick={() => void copy()}>Copy link</button>
      </div>
      <PageHead title="Compare teams" eyebrow={`Prescouting · ${event}`}>
        {teams.map((t) => (t.name ? `${t.team} ${t.name}` : String(t.team))).join(' · ')}
      </PageHead>

      <Panel
        title="Teams"
        aside={!list ? <span className="note">Loading names and Match 13 numbers…</span> : undefined}
      >
        {list && !list.ok && (
          <div className="panel-body toolbar">
            <span role="alert">{list.error}</span>
            <button type="button" className="btn" style={TAP} onClick={() => void reloadPrescoutTeams(event)}>Try again</button>
          </div>
        )}
        <CompareRow teams={teams} cell={(t) => (
          <div style={{ display: 'grid', gap: 6 }}>
            <span>
              {t.name ?? (list?.ok ? <span className="muted">The Blue Alliance doesn't list them at this event.</span> : null)}
            </span>
            <span>{t.tier ? <TierBadge tier={t.tier} long /> : <span className="muted">Not rated</span>}</span>
            <span className="toolbar">
              <a className="btn" style={TAP} href={t.href}>{t.prescouted ? 'Open notes' : 'Add notes'}</a>
              <a className="btn" style={TAP} href={t.tbaUrl} target="_blank" rel="noreferrer" aria-label={`Team ${t.team} on The Blue Alliance`}>TBA</a>
            </span>
          </div>
        )} />
      </Panel>

      <Panel title="Match 13">
        <CompareRow label="EPA" teams={teams} cell={(t) => <Best value={t.epa} best={epaBest} />} />
        <CompareRow label="xP" teams={teams} cell={(t) => (
          <>
            <Best value={t.xp} best={xpBest} />
            {t.xpRank && <span className="note">{` · rank ${t.xpRank.rank} of ${t.xpRank.of}`}</span>}
          </>
        )} />
      </Panel>

      <Panel title="Stars">
        <CompareRow teams={teams} cell={(t) => <StarLines team={t} nameOf={nameOf} />} />
      </Panel>

      <Panel title="Our notes">
        <CompareRow label="Quick answers" teams={teams} cell={(t) => (t.facts.length > 0 ? t.facts.map((f) => `${f.label} ${f.value}`).join(' · ') : <Dash />)} />
        {PRESCOUT_QUESTIONS.map((q) => (
          <CompareRow key={q.key} label={q.label} teams={teams} cell={(t) => (t.answers[q.key].trim() ? <span style={{ whiteSpace: 'pre-wrap' }}>{t.answers[q.key]}</span> : <Dash />)} />
        ))}
      </Panel>

      <Panel title="Scouted from video" aside={<span className="note">This season</span>}>
        <CompareRow label="Matches" teams={teams} cell={(t) => (t.averages.matches === 0 ? <span className="muted">No matches scouted from video yet.</span> : `From ${t.averages.matches} ${t.averages.matches === 1 ? 'match' : 'matches'}`)} />
        {COUNTERS.map((c) => {
          const average = (t: CompareTeam) => t.averages.counters.find((a) => a.key === c.key)?.average ?? null
          const best = bestValue(teams.map(average), c.lowerIsBetter)
          return <CompareRow key={c.key} label={c.lowerIsBetter ? `${c.label} (fewer is better)` : c.label} teams={teams} cell={(t) => <Best value={average(t)} best={best} />} />
        })}
        <CompareRow label="Endgame" teams={teams} cell={(t) => {
          const endgame = t.averages.endgame.filter((e) => e.count > 0).map((e) => `${e.option} ×${e.count}`).join(' · ')
          return endgame || <Dash />
        }} />
      </Panel>
    </>
  )
}

/**
 * One section of the compare page: a cell for each team, each starting with
 * their number. Stacked on a phone, side by side on a wider screen.
 */
function CompareRow(props: { label?: string; teams: CompareTeam[]; cell: (t: CompareTeam) => ReactNode }) {
  return (
    <section className="prescout-compare-section">
      {props.label && <h3 style={{ margin: 0, fontSize: 15 }}>{props.label}</h3>}
      <div className="prescout-compare">
        {props.teams.map((t) => (
          <div key={t.team}>
            <strong className="tnum" style={{ marginRight: 6 }}>{t.team}</strong>
            {props.cell(t)}
          </div>
        ))}
      </div>
    </section>
  )
}

/** A number to one decimal place, in bold if it's the best (bestValue() in data.ts). */
function Best(props: { value: number | null; best: number | null }) {
  const text = formatEpa(props.value)
  if (props.value === null) return <span className="muted">{text}</span>
  return props.value === props.best ? <strong className="tnum">{text}</strong> : <span className="tnum">{text}</span>
}

function Dash() {
  return <span className="muted">—</span>
}

/** A team's stars, read only: each team star with its reason and who gave it, then your own. */
function StarLines(props: { team: CompareTeam; nameOf: (id: string | null) => string }) {
  const { forTeam, mine } = props.team.stars
  if (forTeam.length === 0 && !mine) return <span className="muted">No stars</span>
  return (
    <ul style={{ margin: '4px 0 0', padding: 0, listStyle: 'none', display: 'grid', gap: 4 }}>
      {forTeam.map((s) => <li key={s.id}>{`★ ${s.reason} — ${s.created_by ? props.nameOf(s.created_by) : 'from before stars'}`}</li>)}
      {mine && <li>☆ Your star (only you see it)</li>}
    </ul>
  )
}

/**
 * A team's Compare tick box, in each overview view: 24px, in a 44px label
 * so it's easy to tap. A fifth tick is refused with a message, and the box
 * stays unticked, since it shows what's ticked in data.ts.
 */
export function CompareTick(props: { event: string; team: number; words?: boolean }) {
  const checked = useCompareChoice(props.event).includes(props.team)
  function tick() {
    const result = tickCompare(props.event, props.team)
    if (!result.ok) toast(result.error)
  }
  return (
    <label className="check" style={{ minHeight: 44, minWidth: 44, justifyContent: 'center', flexShrink: 0 }}>
      <input type="checkbox" style={{ width: 24, height: 24, flexShrink: 0 }} checked={checked} onChange={tick} aria-label={`Compare team ${props.team}`} />
      {props.words && 'Compare'}
    </label>
  )
}

/**
 * The bar at the bottom of the team list once a team is ticked: which are
 * ticked, Clear, and Compare (n) from two. It stays at the bottom of the
 * screen while the list scrolls (.prescout-compare-bar is sticky).
 *
 * The words are always on the page, empty until the first tick. Screen
 * readers only read changes to an aria-live area that was already there, so
 * adding it with the first tick would mean they never read that first hint.
 */
export function CompareBar(props: { event: string }) {
  const chosen = useCompareChoice(props.event)
  const ticked = chosen.length > 0
  const words =
    !ticked ? ''
    : chosen.length < MIN_COMPARE ? `Team ${chosen[0]} ticked. Tick another team to compare.`
    : chosen.length === MAX_COMPARE ? `Ticked: ${chosen.join(', ')} (${MAX_COMPARE} is the most)`
    : `Ticked: ${chosen.join(', ')}`
  return (
    <div className={ticked ? 'prescout-compare-bar' : undefined}>
      <span aria-live="polite" style={{ flex: '1 1 12em', minWidth: 0 }}>{words}</span>
      {ticked && <button type="button" className="btn" style={TAP} onClick={clearCompare}>Clear</button>}
      {chosen.length >= MIN_COMPARE && (
        <a className="btn btn-primary" style={TAP} href={compareHref(props.event, chosen)}>{`Compare (${chosen.length})`}</a>
      )}
    </div>
  )
}
