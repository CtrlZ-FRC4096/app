import { useEffect, useState } from 'react'
import { Pick } from '../../core/ui'
import { POSITIONS, loadSchedule, setPosition, teamFor, usePosition, useSavedSchedule, type Position } from './data'

const NUMBER_BOX = { width: '9ch', minHeight: 46, fontSize: 16 }

// The top of the match form: the scout's position, the match number and the
// team number. Typing the match number fills in the team for this device's
// position from the schedule, and shows it big to check against the robot's
// bumpers. The scout can still change it. With no schedule (no Wi-Fi the
// first time, or TBA doesn't have it yet) they type the team in themselves.
export default function MatchTeamFields(props: { match: string; team: string; onMatch: (match: string) => void; onTeam: (team: string) => void }) {
  const position = usePosition()
  const schedule = useSavedSchedule()
  // Why the schedule couldn't be loaded, if it couldn't. tries goes up when
  // the scout presses Try again, which loads it again.
  const [problem, setProblem] = useState<string | null>(null)
  const [tries, setTries] = useState(0)

  // Get the schedule when the form opens. loadSchedule() saves it on this
  // device, and uses the saved copy if there's no connection.
  useEffect(() => {
    let current = true
    void loadSchedule().then((result) => {
      if (current) setProblem(result.ok ? null : result.error)
    })
    return () => {
      current = false
    }
  }, [tries])

  function tryAgain() {
    setProblem(null)
    setTries((n) => n + 1)
  }

  const scheduled = teamFor(schedule, Number(props.match), position)
  const fromSchedule = scheduled !== null && props.team === String(scheduled)

  // Fill in the team for this match and position. If the schedule doesn't
  // have one, clear a team it filled in before, so it can't be left over
  // from the last match.
  function fill(match: string, at: Position | '') {
    const team = teamFor(schedule, Number(match), at)
    if (team !== null) props.onTeam(String(team))
    else if (fromSchedule) props.onTeam('')
  }

  function changeMatch(match: string) {
    props.onMatch(match)
    fill(match, position)
  }

  function changePosition(at: Position | '') {
    if (!at) return
    setPosition(at)
    fill(props.match, at)
  }

  const red = position.startsWith('Red')

  // What to tell the scout under the boxes when the team isn't from the schedule.
  let note = ''
  if (!position) note = 'Pick your position, and the team fills in from the match number.'
  else if (!schedule) note = problem ? `${problem} Type the team number in for now.` : 'Getting the match schedule…'
  else if (props.match.trim() === '') note = ''
  else if (scheduled === null) note = `Match ${props.match} isn't in the schedule. Type the team number in.`
  else note = `The schedule says team ${scheduled} for ${position}. Check the team number.`

  return (
    <>
      <div className="field">
        My position
        <Pick label="My position" options={[...POSITIONS]} value={position} onChange={changePosition} />
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
        <label className="field" htmlFor="scout-match">
          Match number
          <input id="scout-match" className="input" style={NUMBER_BOX} inputMode="numeric" value={props.match} onChange={(e) => changeMatch(e.target.value)} placeholder="12" />
        </label>
        <label className="field" htmlFor="scout-team">
          Team number
          <input id="scout-team" className="input" style={NUMBER_BOX} inputMode="numeric" value={props.team} onChange={(e) => props.onTeam(e.target.value)} placeholder="4096" />
        </label>
      </div>
      <div aria-live="polite">
        {fromSchedule ? (
          // Big, in the alliance's colour, to check against the robot's bumpers.
          <div style={{ borderRadius: 'var(--radius)', padding: '10px 14px', background: red ? 'var(--red-alliance-bg)' : 'var(--blue-alliance-bg)', color: red ? 'var(--red-alliance)' : 'var(--blue-alliance)' }}>
            <div>{position} in match {props.match}</div>
            <div className="mono" style={{ fontSize: 44, fontWeight: 700, lineHeight: 1.1 }}>{props.team}</div>
            <div className="note">Check it matches the robot's bumpers. If it doesn't, change the team number.</div>
          </div>
        ) : (
          note && (
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
              <p className="note" style={{ margin: 0 }}>{note}</p>
              {position && !schedule && problem && <button type="button" className="btn" onClick={tryAgain}>Try again</button>}
            </div>
          )
        )}
      </div>
    </>
  )
}
