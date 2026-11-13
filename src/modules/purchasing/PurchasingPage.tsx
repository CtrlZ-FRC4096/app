import { useEffect, useRef, useState, type ChangeEvent, type CSSProperties, type FormEvent, type MouseEvent, type ReactNode } from 'react'
import { useMemberNames, useMembers, type Member } from '../../core/members'
import { navigate, useRoute } from '../../core/router'
import { isMentor, useSession } from '../../core/session'
import { toast } from '../../core/toast'
import { shortDate } from '../../core/format'
import { PageHead, Panel, Pick, Pill, Stepper } from '../../core/ui'
import { partsTable, systemsTable } from '../bom/data'
import {
  EMPTY_ITEM,
  RECEIPT_ACCEPT,
  STATUSES,
  TYPES,
  VENDORS,
  VIEWS,
  addBuyer,
  addItem,
  arrivalText,
  addReceipt,
  changeItem,
  choices,
  duplicateItem,
  formPriceText,
  groupItems,
  isAsking,
  orderFieldsShown,
  pickStatus,
  isLate,
  itemToForm,
  priceText,
  receiptCountText,
  receiptLink,
  receiptText,
  receiptAddingShown,
  removeBuyer,
  removeItem,
  removeReceipt,
  requestFromBomPart,
  searchItems,
  statusOf,
  summaryText,
  useBuyers,
  useCanOrder,
  useReceipts,
  useItems,
  type NewItem,
  type PurchaseItem,
  type Receipt,
  type View,
} from './data'

// Fields and their boxes may shrink to the screen's width. Without this, a
// dropdown grows to fit its longest choice and the page scrolls sideways
// on a phone.
const FIELD: CSSProperties = { minWidth: 0 }
const BOX: CSSProperties = { minWidth: 0, width: '100%' }

const EMPTY_TEXT: Record<View, string> = {
  Current: 'Nothing in progress. Ask for something above, or look at All.',
  All: 'Nothing on the list yet. Ask for the first thing above.',
  'By status': 'Nothing on the list yet. Ask for the first thing above.',
  'By vendor': 'Nothing on the list yet. Ask for the first thing above.',
}

/** The Ask for something form, when it's open: what it starts with, and the BOM part it's for. */
interface Asking {
  start: NewItem
  bomPartId: string | null
  /** Changes when a different item is duplicated, so the form starts over. */
  key: string
}

// The page reads items with a hook (useItems) and changes them with
// functions from data.ts. It never saves anything itself.
//
// Its address can say what to open, for the BOM page's links:
//   #/purchasing/from-bom/<part id>   Ask for something, filled in from a BOM part
//   #/purchasing/item/<item id>       That item, open for changing
export default function PurchasingPage() {
  const items = useItems()
  const route = useRoute()
  const [view, setView] = useState<View>('Current')
  const [search, setSearch] = useState('')
  const [asking, setAsking] = useState<Asking | null>(null)
  // The item opened for changing, if any.
  const [openId, setOpenId] = useState<string | null>(null)
  const groups = groupItems(searchItems(items, search), view)

  const fromBom = useBomRequest(route.rest)
  const routeItem = route.rest[0] === 'item' ? items.find((i) => i.id === route.rest[1]) : undefined
  // A link from the BOM opens its form until it's sent or cancelled.
  const form = fromBom ?? asking
  const closeForm = () => {
    setAsking(null)
    if (fromBom) navigate('purchasing')
  }

  return (
    <>
      <PageHead title="Purchasing">
        What the team needs to buy, from asking for it to it being in the shop. Add anything we need to order, or use Purchase on a BOM part. Tap an item to change it.
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
            Ask for something
          </button>
        )}
      </div>

      {form && (
        <InView key={form.key}>
          <Panel title="Ask for something">
            <ItemForm item={null} start={form.start} bomPartId={form.bomPartId} onDone={closeForm} />
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
            aside={<span className="note">{group.status ? group.status.hint + ' · ' : ''}{group.items.length}</span>}
          >
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

      <Purchasers />
    </>
  )
}

/** The Ask for something form for a link from the BOM, or null when the address isn't one. */
function useBomRequest(rest: string[]): Asking | null {
  const parts = partsTable.useRows()
  const systems = systemsTable.useRows()
  if (rest[0] !== 'from-bom') return null
  const part = parts.find((p) => p.id === rest[1])
  if (!part) return null
  return { start: requestFromBomPart(part, systems.find((s) => s.id === part.system_id)), bomPartId: part.id, key: `bom-${part.id}` }
}

/** Scrolls its contents into view when it first appears, clear of the top bar. */
function InView(props: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    ref.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }, [])
  return <div ref={ref} style={{ scrollMarginTop: 160 }}>{props.children}</div>
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
    arrivalText(item),
  ].filter(Boolean)
  const receipts = receiptCountText(useReceipts(item.id).length)
  const price = priceText(item)

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
        {item.link && (
          <a className="btn btn-sm" href={item.link} target="_blank" rel="noopener noreferrer">Open link</a>
        )}
      </span>
    </div>
  )
}

/**
 * Ask for something, or change an item when `item` is given. A new
 * request can start filled in (`start`), for Duplicate and the BOM's
 * Purchase button.
 */
function ItemForm(props: { item: PurchaseItem | null; start?: NewItem; bomPartId?: string | null; onDone: () => void }) {
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
  const price = formPriceText(form)
  const buyers = useBuyers()
  const people = members.filter((m) => m.active || m.id === form.shipped_to)
  // Who can have placed an order: mentors, admins and purchasers, and whoever it says now.
  const orderers = members.filter((m) => (m.active && (isMentor(m.role) || buyers.some((b) => b.member_id === m.id))) || m.id === form.ordered_by)

  async function save(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    const result = item ? await changeItem(item, form) : await addItem(form, props.bomPartId ?? null)
    setSaving(false)
    if (!result.ok) {
      toast(result.error)
      return
    }
    toast(item ? 'Saved.' : 'Added to the list.')
    props.onDone()
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
      </p>
      {text('name', 'What to buy', 'Like "Ethernet cables, 5 ft (10 pack)"')}
      {locked && item ? (
        <div className="field" style={FIELD}>
          Status
          <span><Pill tone={statusOf(item.status).tone}>{statusOf(item.status).label}</Pill></span>
          <span className="note">Only mentors and purchasers change anything about an order once it's placed.</span>
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
      {item && <Receipts item={item} showAdd={receiptAddingShown(form.status)} />}
      <div className="toolbar">
        {!locked && <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : item ? 'Save' : 'Add to the list'}</button>}
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
 * The bottom of an item's form: who ordered it, who it ships to and when it
 * should arrive. Mentors and purchasers fill these in; everyone else sees
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
    arrivalText(item),
  ].filter(Boolean)
  // Mentors and purchasers get the fields once it's ordered (see orderFieldsShown).
  const shown = orderFieldsShown(form)
  if (!props.canOrder && known.length === 0) return null
  if (props.canOrder && !shown.ordered_by && !shown.shipped_to && !shown.estimated_arrival) return null

  return (
    <div style={{ display: 'grid', gap: 14, minWidth: 0, borderTop: '1px solid var(--line)', paddingTop: 14 }}>
      <strong>Order details</strong>
      {!props.canOrder ? (
        <p className="note" style={{ margin: 0 }}>{known.join(' · ')}</p>
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
        </>
      )}
    </div>
  )
}

/** Who the purchasers are, so people know who to ask. Mentors and admins add and remove them. */
/**
 * An item's receipts, on the opened item. Everyone sees how many there are.
 * Mentors, admins and purchasers add, open and delete them.
 * The buttons are only tidiness: the database's rules are what stop people.
 */
function Receipts(props: { item: PurchaseItem; showAdd: boolean }) {
  const nameOf = useMemberNames()
  const canManage = useCanOrder()
  const receipts = useReceipts(props.item.id)
  const picker = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  // The receipt whose Delete was pressed once: it takes two presses.
  const [deletingId, setDeletingId] = useState<string | null>(null)

  async function pick(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    // Cleared so picking the same file again, after a problem, still counts.
    event.target.value = ''
    if (!file) return
    setUploading(true)
    const result = await addReceipt(props.item, file)
    setUploading(false)
    toast(result.ok ? 'Receipt added.' : result.error)
  }

  async function open(receipt: Receipt) {
    // The tab has to open during the tap, or phones block it. The address
    // comes after, once the link is made.
    const tab = window.open('', '_blank')
    const result = await receiptLink(receipt)
    if (!result.ok) {
      tab?.close()
      toast(result.error)
      return
    }
    if (!tab) {
      toast('Your browser blocked the new tab. Allow pop-ups for this site and try again.')
      return
    }
    tab.opener = null
    tab.location.href = result.value
  }

  async function remove(receipt: Receipt) {
    if (deletingId !== receipt.id) {
      setDeletingId(receipt.id)
      return
    }
    const result = await removeReceipt(receipt)
    setDeletingId(null)
    toast(result.ok ? 'Receipt deleted.' : result.error)
  }

  // Nothing to see or do here for a student, on an item with no receipts.
  if (!canManage && receipts.length === 0) return null

  return (
    <div className="field" style={FIELD}>
      <span>Receipts</span>
      {canManage ? (
        receipts.map((receipt, i) => (
          <div key={receipt.id} className="toolbar" style={{ justifyContent: 'space-between', padding: '4px 0' }}>
            <span style={{ minWidth: 0, color: 'var(--ink)' }}>
              Receipt {i + 1}: {receiptText(receipt)}
              <br />
              <span className="note">Added by {nameOf(receipt.created_by)} · {shortDate(receipt.created_at)}</span>
            </span>
            <span className="toolbar">
              <button type="button" className="btn btn-sm" onClick={() => void open(receipt)}>Open</button>
              <button type="button" className="btn btn-sm" onClick={() => void remove(receipt)}>
                {deletingId === receipt.id ? 'Press again to delete' : 'Delete'}
              </button>
            </span>
          </div>
        ))
      ) : (
        <span className="note">
          {receipts.length > 0 ? `${receiptCountText(receipts.length)} added. ` : ''}Only mentors and purchasers can open receipts, because they can show card digits and addresses.
        </span>
      )}
      {canManage && props.showAdd && (
        <div className="toolbar">
          <button type="button" className="btn btn-sm" disabled={uploading} onClick={() => picker.current?.click()}>
            {uploading ? 'Uploading…' : 'Add receipt'}
          </button>
          <span className="note">PDF or photo, up to 10 MB</span>
          <input ref={picker} type="file" accept={RECEIPT_ACCEPT} aria-label="Add receipt" hidden onChange={(e) => void pick(e)} />
        </div>
      )}
    </div>
  )
}

function Purchasers() {
  const buyers = useBuyers()
  const members = useMembers()
  const nameOf = useMemberNames()
  const me = useSession()
  const [adding, setAdding] = useState('')
  const mentor = isMentor(me.role)
  const others = members.filter((m) => m.active && !isMentor(m.role) && !buyers.some((b) => b.member_id === m.id))

  async function add(event: FormEvent) {
    event.preventDefault()
    const result = await addBuyer(adding)
    toast(result.ok ? `${nameOf(adding)} is now a purchaser.` : result.error)
    if (result.ok) setAdding('')
  }

  return (
    <Panel title="Purchasers" aside={<span className="note">Place and change orders, with mentors and admins</span>}>
      {buyers.length === 0 ? (
        <p className="panel-body muted">No purchasers yet{mentor ? '. Add someone below.' : ': ask a mentor to place orders.'}</p>
      ) : (
        <div className="row-list">
          {buyers.map((buyer) => (
            <div key={buyer.id}>
              <span style={{ flex: 1, minWidth: 0 }}>{nameOf(buyer.member_id)}</span>
              {mentor && (
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={async () => {
                    const result = await removeBuyer(buyer)
                    toast(result.ok ? `${nameOf(buyer.member_id)} is no longer a purchaser.` : result.error)
                  }}
                >
                  Remove
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {mentor && others.length > 0 && (
        <form className="panel-body" onSubmit={add}>
          <label className="field" style={FIELD} htmlFor="purchase-add-buyer">
            Add a purchaser
            <select id="purchase-add-buyer" className="input" style={BOX} value={adding} onChange={(e) => setAdding(e.target.value)}>
              <option value="">Pick someone</option>
              {others.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </label>
          <div className="toolbar"><button type="submit" className="btn btn-primary" disabled={!adding}>Add</button></div>
        </form>
      )}
    </Panel>
  )
}
