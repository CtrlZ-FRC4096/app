import { plural } from '../../core/format'
import { PageHead, Panel } from '../../core/ui'
import { useItems } from './data'

// The page reads parts with a hook (useItems). It never saves anything itself.
export default function InventoryPage() {
  const items = useItems()

  return (
    <>
      <PageHead eyebrow="Inventory" title="Parts">
        Parts, where they live, and how many are left.
      </PageHead>
      <Panel title="All parts" aside={<span className="note">{plural(items.length, 'part', 'parts')}</span>}>
        {items.length === 0 ? (
          <p className="panel-body muted">No parts yet. A mentor can add them.</p>
        ) : (
          // table-wrap lets the table scroll sideways inside its box on a phone, so the page doesn't.
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Part number</th>
                  <th>Location</th>
                  <th className="num">Qty</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td>{item.name}</td>
                    <td><span className="note">{item.vendor}</span><br />{item.vendor_part_number}</td>
                    <td>{item.location}</td>
                    <td className="num">{item.quantity}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  )
}
