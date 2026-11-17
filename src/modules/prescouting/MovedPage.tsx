import { useEffect } from 'react'
import { useRoute } from '../../core/router'
import { Panel } from '../../core/ui'
import { movedHref } from './data'

// Old #/prescouting links and bookmarks land here, and go straight on to the
// Prescouting tab in Scouting. replace() swaps the address instead of adding
// one, so the back button doesn't bring you back here to be sent on again.
export default function MovedPage() {
  const to = movedHref(useRoute().rest)
  useEffect(() => {
    location.replace(to)
  }, [to])
  return (
    <Panel>
      <p className="panel-body" style={{ margin: 0 }}>
        Prescouting is a tab in Scouting now. <a href={to}>Open Prescouting →</a>
      </p>
    </Panel>
  )
}
