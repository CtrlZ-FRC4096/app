import { href } from '../../core/router'
import { PageHead, Pill } from '../../core/ui'
import { nexusEventUrl, queueTime, savedWhen, useCurrentEvent, useNexusStatus, useScoutingOverview } from './data'

// The scouting overview (#160), at #/scouting: a card for each scouting
// page, with how it's going and its latest results. The sums are
// scoutingOverview() in data.ts; this page only shows them. It reads only
// what's saved on this phone, so it works with no Wi-Fi.
//
// `paths` is each page's address after #/scouting/, from ScoutingPage.tsx.
export default function Overview(props: { paths: Record<string, string> }) {
  const cards = useScoutingOverview()
  const event = useCurrentEvent()
  return (
    <>
      <PageHead title="Scouting overview">
        {`How scouting is going at ${event.name ?? event.key}. Tap a card to open that page.`}
      </PageHead>
      <NexusLive eventKey={event.key} />
      <div className="modules">
        {cards.map((card) => (
          <a key={card.view} className="panel tile" href={href('scouting', props.paths[card.view] ?? '')}>
            <div className="tile-top">
              <h3>{card.view === 'Match' ? 'Match form' : card.view === 'Pit' ? 'Pit form' : card.view}</h3>
              {card.tone === 'info' && <Pill tone="info">Waiting</Pill>}
            </div>
            <div style={{ display: 'grid', gap: 2, overflowWrap: 'anywhere' }}>
              {card.lines.map((line, i) => (
                <span key={i} className={i === 0 ? undefined : 'note'}>{line}</span>
              ))}
            </div>
            <p className="tile-open" style={{ margin: 0 }}>Open <i>→</i></p>
          </a>
        ))}
      </div>
    </>
  )
}

// What's happening at the event right now, from Nexus (#165): what's on the
// field, what's queuing, and when our next match should queue. The last
// answer is kept on the phone, so it shows with no Wi-Fi.
function NexusLive(props: { eventKey: string }) {
  const { saved, problem } = useNexusStatus()
  const s = saved?.status
  const lines = s
    ? [
        s.onField && `On the field: ${s.onField}`,
        s.nowQueuing && `Now queuing: ${s.nowQueuing}`,
        s.ourNext && `Our next: ${s.ourNext.label} (${s.ourNext.alliance === 'red' ? 'Red' : 'Blue'})${s.ourNext.queueAt ? `, queue at ${queueTime(s.ourNext.queueAt)}` : ''}${s.ourNext.status ? ` · ${s.ourNext.status}` : ''}`,
        s.announcements[0] && `Announcement: ${s.announcements[0]}`,
      ].filter((line): line is string => typeof line === 'string' && line !== '')
    : []
  return (
    <div className="panel" style={{ marginBottom: 12 }}>
      <div className="panel-body" style={{ gap: 6 }}>
        <div className="toolbar">
          <strong>Live from Nexus</strong>
          <a className="btn" style={{ minHeight: 44, marginLeft: 'auto' }} href={nexusEventUrl(props.eventKey)} target="_blank" rel="noreferrer">Open in Nexus ↗</a>
        </div>
        {lines.map((line) => <span key={line} style={{ overflowWrap: 'anywhere' }}>{line}</span>)}
        <span className="note" role="status">
          {saved ? `Updated ${savedWhen(saved.savedAt)}${problem ? ` · ${problem}` : ''}` : problem ?? 'Checking Nexus…'}
        </span>
      </div>
    </div>
  )
}
