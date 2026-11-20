import { useState, type CSSProperties, type FormEvent, type MouseEvent, type ReactNode } from 'react'
import { useMemberNames, useMembers, type Member } from '../../core/members'
import { navigate, useRoute } from '../../core/router'
import { isMentor, useSession } from '../../core/session'
import { toast } from '../../core/toast'
import { shortDate } from '../../core/format'
import { InView, PageHead, Panel, Pick, Pill, Stepper } from '../../core/ui'
import { partsTable, systemsTable } from '../bom/data'
// Inventory's parts, for its Order more button. Purchasing has its own useItems, so this one is renamed.
import { useItems as useInventoryItems } from '../inventory/data'
import {
  EMPTY_ITEM,
  STATUSES,
  TYPES,
  VENDORS,
  VIEWS,
  addItem,
  arrivalText,
  changeItem,
  choices,
  duplicateItem,
  formPriceText,
  groupItems,
  isAsking,
  orderFieldsShown,
  orderedText,
  pickStatus,
  isLate,
  isOnItsWay,
  matchParts,
  planFor,
  receiveItem,
  shelveItem,
  useCanReceive,
  type InventoryPlan,
  itemToForm,
  priceText,
  receiptCountText,
  receiptAddingShown,
  removeItem,
  requestFromBomPart,
  requestFromInventoryItem,
  searchItems,
  statusOf,
  summaryText,
  useBuyers,
  useCanOrder,
  useReceipts,
  useItems,
  waitingByVendor,
  type NewItem,
  type PurchaseItem,
  type View,
} from './data'
import { Receipts } from './Receipts'
import { VendorOrder } from './VendorOrder'

// Fields and their boxes may shrink to the screen's width. Without this, a
// dropdown grows to fit its longest choice and the page scrolls sideways
// on a phone.
const FIELD: CSSProperties = { minWidth: 0 }
const BOX: CSSProperties = { minWidth: 0, width: '100%' }

const EMPTY_TEXT: Record<View, string> = {
  Current: 'Nothing in progress. Add a new item above, or look at All.',
  All: 'Nothing on the list yet. Add the first item above.',
  'By status': 'Nothing on the list yet. Add the first item above.',
  'By vendor': 'Nothing on the list yet. Add the first item above.',
}

/** The Add new item form, when it's open: what it starts with, and the BOM part it's for. */
interface Asking {
  start: NewItem
  bomPartId: string | null
  /** Filled in from an Inventory part's Order more button (#194). */
  fromInventory?: boolean
  /** Changes when a different item is duplicated, so the form starts over. */
  key: string
}

// The page reads items with a hook (useItems) and changes them with
// functions from data.ts. It never saves anything itself.
//
// Its address can say what to open, for the BOM page's links:
//   #/purchasing/from-bom/<part id>         Add new item, filled in from a BOM part
//   #/purchasing/from-inventory/<part id>   Add new item, filled in from an Inventory part (Order more)
//   #/purchasing/item/<item id>             That item, open for changing
export default function PurchasingPage() {
  const items = useItems()
  const route = useRoute()
  const [view, setView] = useState<View>('Current')
  const [search, setSearch] = useState('')
  const [asking, setAsking] = useState<Asking | null>(null)
  // The item opened for changing, if any.
  const [openId, setOpenId] = useState<string | null>(null)
  const groups = groupItems(searchItems(items, search), view)
  // Order these, in the By vendor view: the vendor whose waiting items are open to order together.
  const canOrder = useCanOrder()
  const [orderingVendor, setOrderingVendor] = useState<string | null>(null)
  const waiting = view === 'By vendor' && canOrder ? waitingByVendor(items) : new Map<string, PurchaseItem[]>()

  // Two hooks, each called every time (a hook can't be skipped).
  const fromBom = useBomRequest(route.rest)
  const fromInventory = useInventoryRequest(route.rest)
  const fromLink = fromBom ?? fromInventory
  const routeItem = route.rest[0] === 'item' ? items.find((i) => i.id === route.rest[1]) : undefined
  // A link from the BOM or Inventory opens its form until it's sent or cancelled.
  const form = fromLink ?? asking
  const closeForm = () => {
    setAsking(null)
    if (fromLink) navigate('purchasing')
  }

  return (
    <>
      <PageHead title="Purchasing">
        What the team needs to buy, from asking for it to it being in the shop. Add anything we need to order, or use Purchase on a BOM part or Order more on an Inventory part. Tap an item to change it.
      </PageHead>

      {routeItem && (
        <InView key={routeItem.id}>
          <Panel title={routeItem.name}>
            <ItemForm item={routeItem} onDone={() => navigate('purchasing')} />
          </Panel>
        </InView>
      )}

      <div className="toolbar">
        <Pick label="Show" options={[...VIEWS]} value={view} onChange={setView} />
        <label className="field" htmlFor="purchase-search" style={{ ...FIELD, flex: '1 1 14rem' }}>
          Search
          <input
            id="purchase-search"
            className="input"
            style={BOX}
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Name, vendor, type or part number"
          />
        </label>
        {!form && (
          <button type="button" className="btn btn-primary" onClick={() => setAsking({ start: EMPTY_ITEM, bomPartId: null, key: 'new' })}>
            Add new item
          </button>
        )}
      </div>

      {form && (
        <InView key={form.key}>
          <Panel title="Add new item">
            <ItemForm item={null} start={form.start} bomPartId={form.bomPartId} fromInventory={form.fromInventory} onDone={closeForm} />
          </Panel>
        </InView>
      )}

      {groups.length === 0 ? (
        <Panel>
          {search.trim() ? (
            <div className="panel-body">
              <p className="muted" style={{ margin: 0 }}>Nothing matches “{search.trim()}”.</p>
              <div className="toolbar"><button type="button" className="btn" onClick={() => setSearch('')}>Clear the search</button></div>
            </div>
          ) : (
            <p className="panel-body muted">{EMPTY_TEXT[view]}</p>
          )}
        </Panel>
      ) : (
        groups.map((group) => (
          <Panel
            key={group.title}
            title={group.status ? <h2><Pill tone={group.status.tone}>{group.title}</Pill></h2> : group.title}
            aside={
              <span className="toolbar">
                <span className="note">{group.status ? group.status.hint + ' · ' : ''}{group.items.length}</span>
                {waiting.has(group.title) && orderingVendor !== group.title && (
                  <button type="button" className="btn btn-sm" onClick={() => setOrderingVendor(group.title)}>Order these</button>
                )}
              </span>
            }
          >
            {waiting.has(group.title) && orderingVendor === group.title && (
              <VendorOrder key={group.title} vendor={group.title} items={waiting.get(group.title)!} onDone={() => setOrderingVendor(null)} />
            )}
            <div className="row-list">
              {group.items.map((item) =>
                item.id === openId ? (
                  <div key={item.id} style={{ display: 'block', padding: 0 }}>
                    <ItemForm item={item} onDone={() => setOpenId(null)} />
                  </div>
                ) : (
                  <ItemRow
                    key={item.id}
                    item={item}
                    showStatus={!group.status}
                    onOpen={() => setOpenId(item.id)}
                    onDuplicate={() => setAsking({ start: duplicateItem(item), bomPartId: null, key: `copy-${item.id}-${Date.now()}` })}
                  />
                ),
              )}
            </div>
          </Panel>
        ))
      )}

      {items.length > 0 && <p className="note">{summaryText(items)}</p>}
    </>
  )
}

/** The Add new item form for a link from the BOM, or null when the address isn't one. */
function useBomRequest(rest: string[]): Asking | null {
  const parts = partsTable.useRows()
  const systems = systemsTable.useRows()
  if (rest[0] !== 'from-bom') return null
  const part = parts.find((p) => p.id === rest[1])
  if (!part) return null
  return { start: requestFromBomPart(part, systems.find((s) => s.id === part.system_id)), bomPartId: part.id, key: `bom-${part.id}` }
}

/**
 * The Add new item form for an Inventory part's Order more link, or null when
 * the address isn't one. A part that isn't found (deleted, or a bad link) opens
 * Purchasing as normal.
 */
function useInventoryRequest(rest: string[]): Asking | null {
  const parts = useInventoryItems()
  if (rest[0] !== 'from-inventory') return null
  const part = parts.find((p) => p.id === rest[1])
  if (!part) return null
  return { start: requestFromInventoryItem(part), bomPartId: null, fromInventory: true, key: `inventory-${part.id}` }
}

/**
 * One item in a list. Tapping it opens it for changing, except on its
 * buttons, which sit apart so they're easy to hit on a phone.
 */
function ItemRow(props: { item: PurchaseItem; showStatus: boolean; onOpen: () => void; onDuplicate: () => void }) {
  const { item } = props
  const nameOf = useMemberNames()
  const status = statusOf(item.status)
  const details = [item.vendor, item.type, item.part_number].filter(Boolean)
  const bomPart = partsTable.useRows().find((p) => p.id === item.bom_part_id)
  const order = [
    item.ordered_by && `Ordered by ${nameOf(item.ordered_by)}`,
    item.shipped_to && `Shipped to ${nameOf(item.shipped_to)}`,
    orderedText(item),
    arrivalText(item),
  ].filter(Boolean)
  const receipts = receiptCountText(useReceipts(item.id).length)
  const price = priceText(item)

  async function copyTracking() {
    if (!item.tracking) return
    try {
      await navigator.clipboard.writeText(item.tracking)
      toast('Tracking number copied.')
    } catch {
      toast(`Couldn't copy it. The tracking number is ${item.tracking}.`)
    }
  }

  function open(event: MouseEvent) {
    if ((event.target as HTMLElement).closest('a, button')) return
    props.onOpen()
  }

  return (
    <div style={{ flexWrap: 'wrap', cursor: 'pointer' }} onClick={open}>
      <span style={{ flex: '1 1 16rem', minWidth: 0, overflowWrap: 'anywhere' }}>
        <button type="button" className="name-btn" onClick={props.onOpen}><strong>{item.name}</strong></button>
        {' '}× {item.quantity}
        {props.showStatus && <>{' '}<Pill tone={status.tone}>{status.label}</Pill></>}
        {isLate(item) && <>{' '}<Pill tone="warn">Late</Pill></>}
        <br />
        <span className="muted">{details.join(' · ')}</span>
        {price && <><br /><span>{price}</span></>}
        {bomPart && <><br /><span className="note">For BOM part {bomPart.part_number}</span></>}
        {item.notes && <><br /><span className="muted">{item.notes}</span></>}
        {order.length > 0 && <><br /><span className="note">{order.join(' · ')}</span></>}
        {receipts && <><br /><span className="note">{receipts}</span></>}
        <br />
        <span className="note">Requested by {nameOf(item.requested_by)} · {shortDate(item.created_at)}</span>
      </span>
      <span className="toolbar">
        <button type="button" className="btn btn-sm" onClick={props.onDuplicate}>Duplicate</button>
        {item.tracking && <button type="button" className="btn btn-sm" onClick={() => void copyTracking()}>Copy tracking</button>}
        {item.link && (
          <a className="btn btn-sm" href={item.link} target="_blank" rel="noopener noreferrer">Open link</a>
        )}
      </span>
    </div>
  )
}

/**
 * Add a new item, or change one when `item` is given. A new
 * request can start filled in (`start`), for Duplicate and the BOM's
 * Purchase button.
 */
function ItemForm(props: { item: PurchaseItem | null; start?: NewItem; bomPartId?: string | null; fromInventory?: boolean; onDone: () => void }) {
  const { item } = props
  const nameOf = useMemberNames()
  const members = useMembers()
  const me = useSession()
  const canOrder = useCanOrder()
  const [form, setForm] = useState<NewItem>(item ? itemToForm(item) : props.start ?? EMPTY_ITEM)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const set = (changes: Partial<NewItem>) => setForm((current) => ({ ...current, ...changes }))
  const id = (field: string) => `purchase-${item?.id ?? 'new'}-${field}`
  // Asking for something, you pick its priority. Changing one, mentors and
  // purchasers can pick any status; others only between the priorities,
  // and only while it's still being asked for.
  const statuses = item && canOrder ? STATUSES : STATUSES.filter((s) => s.ask)
  // Once it's ordered, only mentors and purchasers change anything about
  // it: everyone else sees it as text.
  const locked = !!item && !canOrder && !isAsking(item.status)
  const canDelete = !!item && (canOrder || isAsking(item.status))
  // Student leaders can't change an order, but they can say it has
  // arrived, then that it's put away in the shop.
  const leaderSteps = useCanReceive() && locked
  const canReceive = leaderSteps && isOnItsWay(item)
  const canShelve = leaderSteps && item.status === 'received'
  // The Add to Inventory tick, when an item moves to In Shop. Until someone
  // changes it, it follows Inventory's parts as they load.
  const inventoryParts = useInventoryItems()
  const [plan, setPlan] = useState<InventoryPlan | null>(null)
  const shownPlan = plan ?? (item ? planFor(item, inventoryParts) : null)
  const shelving = !!item && (canShelve || (!locked && form.status === 'in_shop' && item.status !== 'in_shop'))
  const price = formPriceText(form)
  const buyers = useBuyers()
  const people = members.filter((m) => m.active || m.id === form.shipped_to)
  // Who can have placed an order: mentors, admins and purchasers, and whoever it says now.
  const orderers = members.filter((m) => (m.active && (isMentor(m.role) || buyers.some((b) => b.member_id === m.id))) || m.id === form.ordered_by)

  async function save(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    const result = item ? await changeItem(item, form, shelving ? shownPlan : null) : await addItem(form, props.bomPartId ?? null)
    setSaving(false)
    if (!result.ok) {
      toast(result.error)
      return
    }
    toast(item ? 'Saved.' : 'Added to the list.')
    props.onDone()
  }

  async function receive() {
    if (!item) return
    setSaving(true)
    const result = await receiveItem(item)
    setSaving(false)
    toast(result.ok ? `Marked ${item.name} as received.` : result.error)
    if (result.ok) props.onDone()
  }

  async function shelve() {
    if (!item || !shownPlan) return
    setSaving(true)
    const result = await shelveItem(item, shownPlan)
    setSaving(false)
    toast(result.ok ? `${item.name} is in the shop.${shownPlan.add ? ' Added to Inventory.' : ''}` : result.error)
    if (result.ok) props.onDone()
  }

  async function remove() {
    if (!item) return
    // Deleting can't be undone, so it takes two presses.
    if (!deleting) {
      setDeleting(true)
      return
    }
    const result = await removeItem(item)
    toast(result.ok ? `Deleted ${item.name}.` : result.error)
    if (result.ok) props.onDone()
  }

  const shown = (label: string, value: ReactNode) => (
    <div className="field" style={FIELD}>
      {label}
      <span style={{ overflowWrap: 'anywhere' }}>{value || 'Not filled in'}</span>
    </div>
  )

  const text = (field: 'name' | 'link' | 'part_number', label: string, placeholder = '') => locked ? shown(label, form[field]) : (
    <label className="field" style={FIELD} htmlFor={id(field)}>
      {label}
      <input id={id(field)} className="input" style={BOX} value={form[field]} placeholder={placeholder} onChange={(e) => set({ [field]: e.target.value })} />
    </label>
  )

  const select = (field: 'vendor' | 'type', label: string, list: string[]) => locked ? shown(label, form[field]) : (
    <label className="field" style={FIELD} htmlFor={id(field)}>
      {label}
      <select id={id(field)} className="input" style={BOX} value={form[field]} onChange={(e) => set({ [field]: e.target.value })}>
        <option value="" disabled>Pick one</option>
        {choices(list, form[field]).map((choice) => <option key={choice} value={choice}>{choice}</option>)}
      </select>
    </label>
  )

  return (
    <form className="panel-body" style={{ maxWidth: '70ch', minWidth: 0 }} onSubmit={save}>
      {/* Always whoever filled in the form: it can't be picked or changed. */}
      <p className="note" style={{ margin: 0 }}>
        {item ? `Requested by ${nameOf(item.requested_by)} · ${shortDate(item.created_at)}` : `Requested by ${me.name}`}
        {props.bomPartId && ' · from the BOM: fill in what\'s missing, like the link and the priority'}
        {props.fromInventory && ' · from Inventory: check the number needed and the priority'}
      </p>
      {text('name', 'What to buy', 'Like "Ethernet cables, 5 ft (10 pack)"')}
      {locked && item ? (
        <div className="field" style={FIELD}>
          Status
          <span><Pill tone={statusOf(item.status).tone}>{statusOf(item.status).label}</Pill></span>
          <span className="note">
            {canReceive
              ? "Has it arrived? Press Mark as received. Only mentors and purchasers change anything else about an order."
              : canShelve
                ? "Put away in the shop? Press Put in shop. Only mentors and purchasers change anything else about an order."
                : "Only mentors and purchasers change anything about an order once it's placed."}
          </span>
        </div>
      ) : (
        <label className="field" style={FIELD} htmlFor={id('status')}>
          {item ? 'Status' : 'Priority'}
          <select id={id('status')} className="input" style={BOX} value={form.status} onChange={(e) => set(pickStatus(form, e.target.value as NewItem['status'], item ?? null, me.id))}>
            {statuses.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
          <span className="note">{statusOf(form.status).hint}.</span>
        </label>
      )}
      {select('vendor', 'Vendor', VENDORS)}
      {select('type', 'Type', TYPES)}
      <div className="field">
        <span>Number needed</span>
        {locked ? <span>{form.quantity}</span> : <Stepper id={id('quantity')} label="Number needed" min={1} value={form.quantity} onChange={(quantity) => set({ quantity })} />}
      </div>
      {locked ? shown('Price each', price) : (
        <label className="field" style={FIELD} htmlFor={id('price')}>
          Price each (if you know it)
          <input id={id('price')} className="input" style={BOX} inputMode="decimal" placeholder="12.50" value={form.price} onChange={(e) => set({ price: e.target.value })} />
          {price && <span className="note">{price}</span>}
        </label>
      )}
      {text('link', 'Link to the product', 'https://…')}
      {text('part_number', 'Part or item number (if there is one)')}
      {locked ? shown('Notes', form.notes) : (
        <label className="field" style={FIELD} htmlFor={id('notes')}>
          Notes
          <textarea id={id('notes')} className="input" style={BOX} rows={2} value={form.notes} onChange={(e) => set({ notes: e.target.value })} />
        </label>
      )}
      {item && <OrderDetails item={item} form={form} canOrder={canOrder} set={set} id={id} people={people} orderers={orderers} />}
      {shelving && item && shownPlan && <ToInventory item={item} plan={shownPlan} set={(changes) => setPlan({ ...shownPlan, ...changes })} id={id} />}
      {/* Re-key when the item or permission changes, clearing any local file waiting for review. */}
      {item && <Receipts key={`${item.id}-${canOrder}-${receiptAddingShown(form.status)}`} item={item} showAdd={receiptAddingShown(form.status)} />}
      <div className="toolbar">
        {!locked && <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : item ? 'Save' : 'Add to the list'}</button>}
        {canShelve && <button type="button" className="btn btn-primary" disabled={saving} onClick={() => void shelve()}>{saving ? 'Saving…' : 'Put in shop'}</button>}
        {canReceive && <button type="button" className="btn btn-primary" disabled={saving} onClick={() => void receive()}>{saving ? 'Saving…' : 'Mark as received'}</button>}
        <button type="button" className="btn" onClick={props.onDone}>{locked ? 'Close' : 'Cancel'}</button>
        {canDelete && (
          <button type="button" className="btn" style={{ marginLeft: 'auto' }} onClick={() => void remove()}>
            {deleting ? 'Press again to delete' : 'Delete'}
          </button>
        )}
      </div>
    </form>
  )
}

/**
 * The Add to Inventory tick, when an item moves to In Shop: which part it
 * is (best matches first), how many single parts go on the shelf, and for a
 * new part, what Inventory lists it as and where it lives.
 */
function ToInventory(props: { item: PurchaseItem; plan: InventoryPlan; set: (changes: Partial<InventoryPlan>) => void; id: (field: string) => string }) {
  const { item, plan, set, id } = props
  const parts = useInventoryItems()
  const matches = matchParts(item, parts)
  const others = parts.filter((p) => !matches.some((m) => m.part.id === p.id))
  const part = parts.find((p) => p.id === plan.partId)
  const text = (field: 'name' | 'vendor' | 'vendor_part_number' | 'location', label: string, placeholder = '') => (
    <label className="field" style={FIELD} htmlFor={id(`inv-${field}`)}>
      {label}
      <input id={id(`inv-${field}`)} className="input" style={BOX} value={plan[field]} placeholder={placeholder} onChange={(e) => set({ [field]: e.target.value })} />
    </label>
  )

  return (
    <div style={{ display: 'grid', gap: 14, minWidth: 0, borderTop: '1px solid var(--line)', paddingTop: 14 }}>
      <label className="check">
        <input type="checkbox" checked={plan.add} onChange={(e) => set({ add: e.target.checked })} /> Add to Inventory
      </label>
      {!plan.add ? (
        <span className="note">Leave it unticked for one-off parts that don't go on a shelf.</span>
      ) : (
        <>
          <label className="field" style={FIELD} htmlFor={id('inv-part')}>
            Which part is it?
            <select id={id('inv-part')} className="input" style={BOX} value={plan.partId} onChange={(e) => set({ partId: e.target.value })}>
              {matches.length > 0 && (
                <optgroup label="Looks like">
                  {matches.map((m) => <option key={m.part.id} value={m.part.id}>{m.part.name}, {m.part.location} ({m.reason.toLowerCase()})</option>)}
                </optgroup>
              )}
              <option value="">A new part</option>
              {others.length > 0 && (
                <optgroup label="Other parts">
                  {others.map((p) => <option key={p.id} value={p.id}>{p.name}, {p.location}</option>)}
                </optgroup>
              )}
            </select>
            {matches.length === 0 && (
              <span className="note">
                {plan.partId
                  ? "It didn't match this part by part number, link or name, so check it's the right one."
                  : 'Nothing in Inventory matches its part number, link or name.'}
              </span>
            )}
          </label>
          <div className="field">
            <span>How many single parts go on the shelf</span>
            <Stepper id={id('inv-quantity')} label="How many single parts go on the shelf" min={1} value={plan.quantity} onChange={(quantity) => set({ quantity })} />
            <span className="note">
              {item.quantity} needed. If each one was a pack, count what's inside, like 100 for a pack of 100.
              {part && ` ${part.name} goes from ${part.quantity} to ${part.quantity + plan.quantity}.`}
            </span>
          </div>
          {!plan.partId && (
            <>
              {text('name', 'Name in Inventory')}
              {text('vendor', 'Vendor', 'Like REV or AndyMark')}
              {text('vendor_part_number', 'Part number', 'Like REV-11-1850')}
              {text('location', 'Where it lives', 'Like "Bin E2"')}
            </>
          )}
        </>
      )}
    </div>
  )
}

/**
 * The bottom of an item's form: who ordered it and when, who it ships to,
 * when it should arrive and its tracking number. Mentors and purchasers fill these in; everyone else sees
 * them as text.
 */
function OrderDetails(props: {
  item: PurchaseItem
  form: NewItem
  canOrder: boolean
  set: (changes: Partial<NewItem>) => void
  id: (field: string) => string
  people: Member[]
  orderers: Member[]
}) {
  const { item, form, set, id } = props
  const nameOf = useMemberNames()
  const known = [
    item.ordered_by && `Ordered by ${nameOf(item.ordered_by)}`,
    item.shipped_to && `Shipped to ${nameOf(item.shipped_to)}`,
    orderedText(item),
    arrivalText(item),
    item.tracking && `Tracking number ${item.tracking}`,
  ].filter(Boolean)
  // Mentors and purchasers get the fields once it's ordered (see orderFieldsShown).
  const shown = orderFieldsShown(form)
  if (!props.canOrder && known.length === 0) return null
  if (props.canOrder && !Object.values(shown).some(Boolean)) return null

  return (
    <div style={{ display: 'grid', gap: 14, minWidth: 0, borderTop: '1px solid var(--line)', paddingTop: 14 }}>
      <strong>Order details</strong>
      {!props.canOrder ? (
        <p className="note" style={{ margin: 0, overflowWrap: 'anywhere' }}>{known.join(' · ')}</p>
      ) : (
        <>
          {shown.ordered_by && (
            <label className="field" style={FIELD} htmlFor={id('ordered-by')}>
              Ordered by
              <select id={id('ordered-by')} className="input" style={BOX} value={form.ordered_by} onChange={(e) => set({ ordered_by: e.target.value })}>
                <option value="">Nobody yet</option>
                {props.orderers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
              <span className="note">Marking it Order Placed fills this in with you. Pick someone else if they placed it.</span>
            </label>
          )}
          {shown.ordered_on && (
            <label className="field" style={FIELD} htmlFor={id('ordered-on')}>
              Date ordered
              <input id={id('ordered-on')} className="input" style={BOX} type="date" value={form.ordered_on} onChange={(e) => set({ ordered_on: e.target.value })} />
              <span className="note">Marking it Order Placed fills this in with today. Change it if it was ordered another day.</span>
            </label>
          )}
          {shown.shipped_to && (
            <label className="field" style={FIELD} htmlFor={id('shipped-to')}>
              Shipped to
              <select id={id('shipped-to')} className="input" style={BOX} value={form.shipped_to} onChange={(e) => set({ shipped_to: e.target.value })}>
                <option value="">Nobody yet</option>
                {props.people.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </label>
          )}
          {shown.estimated_arrival && (
            <label className="field" style={FIELD} htmlFor={id('arrival')}>
              Estimated arrival
              <input
                id={id('arrival')}
                className="input"
                style={BOX}
                type="date"
                value={form.estimated_arrival}
                onChange={(e) => set({ estimated_arrival: e.target.value })}
              />
              <span className="note">When it should arrive. Leave it empty if you don't know yet.</span>
            </label>
          )}
          {shown.tracking && (
            <label className="field" style={FIELD} htmlFor={id('tracking')}>
              Tracking number (if there is one)
              <input id={id('tracking')} className="input" style={BOX} value={form.tracking} onChange={(e) => set({ tracking: e.target.value })} />
            </label>
          )}
        </>
      )}
    </div>
  )
}
