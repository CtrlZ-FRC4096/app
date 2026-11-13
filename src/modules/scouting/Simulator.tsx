import { useState } from 'react'
import { PageHead, Panel, Pill } from '../../core/ui'
import {
  MIN_MATCHES, allianceScore, pointsRange, redWinChance, teamNumber, upcomingMatches, useSavedSchedule, useTeamPoints,
  type AllianceScore, type TeamPoints,
} from './data'
import { TeamLink } from './TeamPage'

type Side = 'red' | 'blue'
const SIDES: Side[] = ['red', 'blue']
const NAMES: Record<Side, string> = { red: 'Red', blue: 'Blue' }

/** The team numbers typed in a side's three boxes, leaving out blank or odd ones. */
function teamsIn(boxes: string[]): number[] {
  return boxes.map(Number).filter((n) => Number.isInteger(n) && n > 0)
}

/** Where a team's expected points come from, in a few words. */
function whereFrom(points: TeamPoints): string {
  const matches = points.aps?.matches ?? 0
  const scouted = `${matches} scouted ${matches === 1 ? 'match' : 'matches'}`
  if (points.source === 'scouting') return `APS from ${scouted}`
  if (points.source === 'match13') return `Match 13 xP (only ${scouted})`
  return 'No scouting or Match 13 rating yet'
}

// The match simulator (#166), at #/scouting/simulate. Pick 3 teams a side
// (or one side only) and it adds up their expected points: our APS, or
// Match 13's xP when we've scouted a team too few times. The sums are in
// data.ts; this page only shows them. It reads the saved entries and saved
// Match 13 copy, so it works with no Wi-Fi.
export default function Simulator() {
  const { pointsFor, ratings } = useTeamPoints()
  const schedule = useSavedSchedule()
  const upcoming = upcomingMatches(schedule)
  const [boxes, setBoxes] = useState<Record<Side, string[]>>({ red: ['', '', ''], blue: ['', '', ''] })
  const [chosenMatch, setChosenMatch] = useState('')

  function type(side: Side, i: number, text: string) {
    setBoxes((now) => ({ ...now, [side]: now[side].map((old, j) => (j === i ? text.replace(/\D/g, '') : old)) }))
  }

  function fillFrom(key: string) {
    setChosenMatch(key)
    const match = upcoming.find((m) => m.key === key)
    if (!match) return
    const three = (keys: string[]) => [0, 1, 2].map((i) => (keys[i] ? String(teamNumber(keys[i])) : ''))
    setBoxes({ red: three(match.alliances.red.team_keys), blue: three(match.alliances.blue.team_keys) })
  }

  const teams = { red: teamsIn(boxes.red).map(pointsFor), blue: teamsIn(boxes.blue).map(pointsFor) }
  const scores = { red: allianceScore(teams.red), blue: allianceScore(teams.blue) }
  const both = teams.red.length > 0 && teams.blue.length > 0

  return (
    <>
      <PageHead title="Match simulator">
        Pick 3 teams for red and 3 for blue, or just one side, to see the score we'd expect. It adds up each team's average points: it doesn't count defense or robots getting in each other's way.
      </PageHead>
      <div className="stack">
        <Panel title="Teams">
          <div className="panel-body">
            <label className="field" htmlFor="sim-match">
              Fill in an upcoming match
              <select id="sim-match" className="input" style={{ minHeight: 46, fontSize: 16, maxWidth: '100%' }} value={chosenMatch} onChange={(e) => fillFrom(e.target.value)}>
                <option value="">{upcoming.length === 0 ? 'No upcoming matches on this phone yet' : 'Choose a match'}</option>
                {upcoming.map((m) => <option key={m.key} value={m.key}>Qual {m.match_number}</option>)}
              </select>
            </label>
            {SIDES.map((side) => (
              <div key={side} className="field">
                <span style={{ color: `var(--${side}-alliance)`, fontWeight: 600 }}>{NAMES[side]}</span>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {boxes[side].map((text, i) => (
                    <input
                      key={i}
                      className="input"
                      style={{ width: '8ch', minHeight: 46, fontSize: 16, background: `var(--${side}-alliance-bg)` }}
                      inputMode="numeric"
                      aria-label={`${NAMES[side]} ${i + 1} team number`}
                      placeholder="Team"
                      value={text}
                      onChange={(e) => type(side, i, e.target.value)}
                    />
                  ))}
                </div>
              </div>
            ))}
            <div className="toolbar">
              <button type="button" className="btn btn-lg" onClick={() => { setBoxes({ red: ['', '', ''], blue: ['', '', ''] }); setChosenMatch('') }}>Clear</button>
            </div>
          </div>
        </Panel>

        {both && <Winner red={scores.red} blue={scores.blue} />}
        {SIDES.map((side) => teams[side].length > 0 && <Alliance key={side} side={side} teams={teams[side]} score={scores[side]} />)}
        {teams.red.length + teams.blue.length === 0 && <p className="note" style={{ margin: 0 }}>Type some team numbers, or fill in a match, to see a score.</p>}
        {ratings.ratings.length === 0 && (
          <p className="note" style={{ margin: 0 }}>No Match 13 ratings on this phone yet, so teams we haven't scouted much have nothing to go on.</p>
        )}
      </div>
    </>
  )
}

function Winner(props: { red: AllianceScore; blue: AllianceScore }) {
  const chance = Math.round(redWinChance(props.red, props.blue) * 100)
  const text = chance === 50 ? 'A toss-up' : chance > 50 ? `Red is likely to win: ${chance}%` : `Blue is likely to win: ${100 - chance}%`
  return (
    <Panel>
      <p className="panel-body" style={{ margin: 0, fontSize: 18 }} role="status">
        <strong>{text}</strong>
        <br />
        <span className="note">
          Expected <span className="mono">{Math.round(props.red.expected)}–{Math.round(props.blue.expected)}</span>
        </span>
      </p>
    </Panel>
  )
}

function Alliance(props: { side: Side; teams: TeamPoints[]; score: AllianceScore }) {
  const { score } = props
  return (
    <Panel
      title={<span style={{ color: `var(--${props.side}-alliance)` }}>{NAMES[props.side]}</span>}
      aside={<strong className="tnum" style={{ fontSize: 22 }}>{pointsRange(score.expected, score.low, score.high)}</strong>}
    >
      <div className="row-list">
        {props.teams.map((t, i) => (
          <div key={`${t.team}-${i}`} style={{ flexWrap: 'wrap' }}>
            <span>
              <TeamLink team={t.team} />
              <br />
              <span className="note">{whereFrom(t)}</span>
            </span>
            <span style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              {t.fewMatches && t.expected !== null && <Pill tone="warn">{`Fewer than ${MIN_MATCHES} matches`}</Pill>}
              <strong className="tnum">{t.expected === null ? '–' : t.source === 'scouting' && t.aps ? pointsRange(t.aps.average, t.aps.low, t.aps.high) : Math.round(t.expected)}</strong>
            </span>
          </div>
        ))}
      </div>
      {score.unknown.length > 0 && (
        <p className="panel-body note" style={{ margin: 0 }}>
          Nothing to go on for {score.unknown.map((t) => `team ${t}`).join(', ')}, so {score.unknown.length === 1 ? 'it counts' : 'they count'} as 0.
        </p>
      )}
    </Panel>
  )
}
