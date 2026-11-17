import { useState, type CSSProperties, type FormEvent } from 'react'
import { useMemberNames, useMembers } from '../../core/members'
import { isMentor, useSession } from '../../core/session'
import { toast } from '../../core/toast'
import { plural } from '../../core/format'
import { Pill } from '../../core/ui'
import { cartCsv, markOrdered, orderCsv, orderTotalText, priceText, statusOf, today, useBuyers, type OrderDetails, type PurchaseItem } from './data'

// Fields and their boxes may shrink to the screen's width, so a long name
// in a dropdown doesn't make the page scroll sideways on a phone.
const FIELD: CSSProperties = { minWidth: 0 }
const BOX: CSSProperties = { minWidth: 0, width: '100%' }

/**
 * Order these: one vendor's items waiting to be ordered, to buy together.
 * Tick the ones going in this order, copy them for the vendor's cart, then
 * fill in the order details once and mark them all as ordered.
 *
 * Only mentors and purchasers are shown this. The database refuses anyone
 * else placing an order.
 */
export function VendorOrder(props: { vendor: string; items: PurchaseItem[]; onDone: () => void }) {
  const { vendor, items } = props
  const me = useSession()
  const members = useMembers()
  const buyers = useBuyers()
  const nameOf = useMemberNames()
  // Everything starts ticked, so this holds the ones unticked.
  const [unticked, setUnticked] = useState<string[]>([])
  const [details, setDetails] = useState<OrderDetails>({ ordered_by: me.id, ordered_on: today(), shipped_to: '', estimated_arrival: '', tracking: '' })
  const [saving, setSaving] = useState(false)
  const set = (changes: Partial<OrderDetails>) => setDetails((current) => ({ ...current, ...changes }))
  const ticked = items.filter((item) => !unticked.includes(item.id))
  const noPartNumber = ticked.filter((item) => !item.part_number).length
  const id = (field: string) => `vendor-order-${field}`
  const people = members.filter((m) => m.active)
  // Who can have placed an order: mentors, admins and purchasers.
  const orderers = people.filter((m) => isMentor(m.role) || buyers.some((b) => b.member_id === m.id))

  function tick(itemId: string, on: boolean) {
    setUnticked((current) => (on ? current.filter((other) => other !== itemId) : [...current, itemId]))
  }

  async function copy(text: string, done: string) {
    try {
      await navigator.clipboard.writeText(text)
      toast(done)
    } catch {
      toast("Couldn't copy the list. Check the browser is allowed to use the clipboard, then try again.")
    }
  }

  function copyForCart() {
    const left = noPartNumber === 0 ? '' : ` ${plural(noPartNumber, 'item has', 'items have')} no part number, so add ${noPartNumber === 1 ? 'it' : 'them'} by hand.`
    void copy(cartCsv(ticked), `Copied part numbers and quantities. Paste them into ${vendor}'s quick order page.${left}`)
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    const result = await markOrdered(ticked.map((item) => item.id), details)
    setSaving(false)
    if (!result.ok) {
      toast(result.error)
      return
    }
    toast(`Marked ${plural(result.value.length, 'item', 'items')} from ${vendor} as ordered.`)
    props.onDone()
  }

  return (
    <form className="panel-body" style={{ minWidth: 0, borderBottom: '1px solid var(--line)' }} onSubmit={save}>
      <strong>Order from {vendor}</strong>
      <p className="note" style={{ margin: 0 }}>Untick anything that isn't going in this order. Highest priority is first.</p>
      <div style={{ display: 'grid', gap: 10, minWidth: 0 }}>
        {items.map((item) => (
          <label key={item.id} className="check" style={{ alignItems: 'flex-start', minWidth: 0 }}>
            <input type="checkbox" checked={!unticked.includes(item.id)} onChange={(e) => tick(item.id, e.target.checked)} />
            <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
              <strong>{item.name}</strong> × {item.quantity} <Pill tone={statusOf(item.status).tone}>{statusOf(item.status).label}</Pill>
              <br />
              <span className="note">{[item.part_number ?? 'No part number', priceText(item) ?? 'No price yet'].join(' · ')}</span>
            </span>
          </label>
        ))}
      </div>
      <strong>{orderTotalText(ticked)}</strong>
      <div className="toolbar">
        <button type="button" className="btn" disabled={ticked.length === noPartNumber} onClick={copyForCart}>Copy as CSV for the cart</button>
        <button type="button" className="btn" disabled={ticked.length === 0} onClick={() => void copy(orderCsv(ticked, nameOf), 'Copied the full list. Paste it into a spreadsheet.')}>Copy full CSV</button>
      </div>

      <div style={{ display: 'grid', gap: 14, minWidth: 0, maxWidth: '70ch', borderTop: '1px solid var(--line)', paddingTop: 14 }}>
        <strong>Order details</strong>
        <p className="note" style={{ margin: 0 }}>Once you've ordered on the vendor's site, fill these in once for every ticked item.</p>
        <label className="field" style={FIELD} htmlFor={id('ordered-by')}>
          Ordered by
          <select id={id('ordered-by')} className="input" style={BOX} value={details.ordered_by} onChange={(e) => set({ ordered_by: e.target.value })}>
            {orderers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </label>
        <label className="field" style={FIELD} htmlFor={id('ordered-on')}>
          Date ordered
          <input id={id('ordered-on')} className="input" style={BOX} type="date" value={details.ordered_on} onChange={(e) => set({ ordered_on: e.target.value })} />
        </label>
        <label className="field" style={FIELD} htmlFor={id('shipped-to')}>
          Shipped to
          <select id={id('shipped-to')} className="input" style={BOX} value={details.shipped_to} onChange={(e) => set({ shipped_to: e.target.value })}>
            <option value="">Nobody yet</option>
            {people.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </label>
        <label className="field" style={FIELD} htmlFor={id('arrival')}>
          Estimated arrival
          <input id={id('arrival')} className="input" style={BOX} type="date" value={details.estimated_arrival} onChange={(e) => set({ estimated_arrival: e.target.value })} />
        </label>
        <label className="field" style={FIELD} htmlFor={id('tracking')}>
          Tracking number (if there is one)
          <input id={id('tracking')} className="input" style={BOX} value={details.tracking} onChange={(e) => set({ tracking: e.target.value })} />
        </label>
      </div>
      <div className="toolbar">
        <button type="submit" className="btn btn-primary" disabled={saving || ticked.length === 0}>
          {saving ? 'Saving…' : `Mark ${plural(ticked.length, 'item', 'items')} as ordered`}
        </button>
        <button type="button" className="btn" onClick={props.onDone}>Cancel</button>
      </div>
    </form>
  )
}
