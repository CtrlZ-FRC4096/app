import { useEffect, useState } from 'react'
import { useRoute } from '../../core/router'
import { useSession } from '../../core/session'
import { PageHead } from '../../core/ui'
import { keepScheduleFresh, useCurrentEvent } from '../scouting/data'
import { canManagePit, defaultMatch, useOurMatches } from './data'
import { MatchPicker } from './MatchPicker'
import { MyChecklist } from './MyChecklist'
import { PitChecklist } from './PitChecklist'
import { PitDisplay } from './PitDisplay'
import { TeamProgress } from './TeamProgress'
import './status.css'

// The Pit checklist (#146), at #/status, and the pit display for the pit TV
// (#161, PitDisplay.tsx), at #/status/display. The folder and id are still
// "status" so links and other code keep working.
export default function StatusPage() {
  const [page = ''] = useRoute().rest
  return page === 'display' ? <PitDisplay /> : <Checklist />
}

// Students see their own items for the chosen match; student leaders,
// mentors and admins see everyone's progress and the full checklist, which
// they run.
function Checklist() {
  const { role } = useSession()
  const event = useCurrentEvent().key
  const matches = useOurMatches()
  const [chosenKey, setChosenKey] = useState<string | null>(null)
  const match = matches.find((m) => m.key === chosenKey) ?? defaultMatch(matches)

  // Keep the schedule up to date while the page is open, starting again for
  // the new event when someone picks another (like Scouting's Schedule
  // page). It's saved on this device, so with no connection the last one
  // still shows.
  useEffect(() => keepScheduleFresh(event), [event])

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
