import { Panel } from '../../core/ui'
import type { Battery } from './data'

// Labels to print and stick on the batteries: one big number each, so anyone
// can read it across the pit and find the battery in the app with "Find a
// battery". A QR code would be nicer, but making one needs an npm package,
// which is a mentor's decision (Inventory's bin labels need the same).
export default function Labels(props: { batteries: Battery[]; onDone: () => void }) {
  return (
    <Panel
      title="Labels"
      aside={
        <span className="toolbar">
          <button type="button" className="btn btn-sm btn-primary" onClick={() => window.print()}>Print</button>
          <button type="button" className="btn btn-sm" onClick={props.onDone}>Close</button>
        </span>
      }
    >
      <div className="panel-body" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(9rem, 1fr))', gap: 12 }}>
        {props.batteries.map((battery) => (
          <div key={battery.id} style={{ border: '2px solid var(--ink)', borderRadius: 'var(--radius)', padding: '18px 8px', textAlign: 'center' }}>
            <div className="note">Ctrl-Z battery</div>
            <div style={{ fontSize: 40, fontWeight: 700, overflowWrap: 'anywhere', lineHeight: 1.1 }}>{battery.name}</div>
          </div>
        ))}
      </div>
    </Panel>
  )
}
