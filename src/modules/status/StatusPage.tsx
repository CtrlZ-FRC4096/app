import { useEffect, useState } from 'react'
import { useSession } from '../../core/session'
import { PageHead } from '../../core/ui'
import { keepScheduleFresh } from '../scouting/data'
import { canManagePit, defaultMatch, useOurMatches } from './data'
import { MatchPicker } from './MatchPicker'
import { MyChecklist } from './MyChecklist'
import { PitChecklist } from './PitChecklist'
import { TeamProgress } from './TeamProgress'
import './status.css'

// The Pit checklist (#146). The folder and id are still "status" so links and
// other code keep working. Students see their own items for the chosen match;
// student leaders, mentors and admins see everyone's progress and the full
// checklist, which they run.
export default function StatusPage() {
  const { role } = useSession()
  const matches = useOurMatches()
  const [chosenKey, setChosenKey] = useState<string | null>(null)
  const match = matches.find((m) => m.key === chosenKey) ?? defaultMatch(matches)

  // Keep the schedule up to date while the page is open. It's saved on this
  // device, so with no connection the last one still shows.
  useEffect(() => keepScheduleFresh(), [])

  return (
    <>
      <PageHead title="Pit checklist">
        Get the robot ready for each of our matches. Pick the match, then check off your items.
      </PageHead>
      <MatchPicker matches={matches} chosen={match} onChoose={setChosenKey} />
      {canManagePit(role) ? (
        <>
          <TeamProgress match={match} />
          <PitChecklist match={match} />
        </>
      ) : (
        <MyChecklist match={match} />
      )}
    </>
  )
}
