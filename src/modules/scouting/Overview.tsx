import { href } from '../../core/router'
import { PageHead, Pill } from '../../core/ui'
import { nexusEventUrl, useCurrentEvent, useScoutingOverview } from './data'

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
      <div className="toolbar" style={{ marginBottom: 12 }}>
        <a className="btn" style={{ minHeight: 44 }} href={nexusEventUrl(event.key)} target="_blank" rel="noreferrer">Open in Nexus ↗</a>
        <span className="note">What's on the field now, and who should be queuing</span>
      </div>
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
