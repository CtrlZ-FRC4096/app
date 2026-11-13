import { useState } from 'react'
import { useMemberNames } from '../../core/members'
import { PageHead, Panel } from '../../core/ui'
import { useTeamPicklist, type TeamPicklistLine } from './data'
import { TeamLink } from './TeamPage'

// The team picklist (#151), at #/scouting/team-picklist: everyone's own
// picklists averaged. teamPicklist() in data.ts works it out; this page only
// shows it. It updates by itself when someone changes their list.
export default function TeamPicklist() {
  const lines = useTeamPicklist()
  const lists = lines[0]?.lists ?? 0
  return (
    <div className="stack">
      <PageHead title="Team picklist">
        Everyone's picklists averaged. A place counts as a share of its list, so 1st of 30 counts the same as 1st of 20, and a team missing from someone's list is left out of that list, not counted as last. Tap a team to see where each person put it.
      </PageHead>
      <Panel title="Averaged" aside={<span className="note">{`${lists} ${lists === 1 ? 'list' : 'lists'}`}</span>}>
        {lines.length === 0 ? (
          <p className="panel-body muted" style={{ margin: 0 }}>Nobody has made a picklist for this event yet. Start yours on My picklist.</p>
        ) : (
          <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {lines.map((line) => <Line key={line.team} line={line} />)}
          </ol>
        )}
      </Panel>
    </div>
  )
}

function Line(props: { line: TeamPicklistLine }) {
  const { line } = props
  const [open, setOpen] = useState(false)
  const nameOf = useMemberNames()
  return (
    <li style={{ display: 'grid', gap: 6, padding: '10px 16px', borderBottom: '1px solid var(--line)' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '4px 12px' }}>
        <strong className="tnum" style={{ fontSize: 18, minWidth: '2ch' }}>{`${line.rank}.`}</strong>
        <strong style={{ fontSize: 18 }}><TeamLink team={line.team} /></strong>
        <span className="note">{`Average place ${line.averagePlace.toFixed(1)} · best ${line.best}, worst ${line.worst} · on ${line.onLists} of ${line.lists} lists`}</span>
        <button type="button" className="btn" style={{ minHeight: 44, marginLeft: 'auto' }} aria-expanded={open} onClick={() => setOpen((now) => !now)}>
          {open ? 'Hide' : 'Who put it where'}
        </button>
      </div>
      {open && (
        <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 4 }}>
          {line.placements.map((p, i) => (
            <li key={i} style={{ overflowWrap: 'anywhere' }}>
              {`${nameOf(p.by)}: ${p.place} of ${p.of}`}
              {p.note && <span className="note">{` · ${p.note}`}</span>}
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}
