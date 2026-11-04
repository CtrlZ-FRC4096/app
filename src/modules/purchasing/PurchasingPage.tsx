import { useEffect, useRef, useState, type CSSProperties, type FormEvent, type MouseEvent, type ReactNode } from 'react'
import { useMemberNames, useMembers } from '../../core/members'
import { navigate, useRoute } from '../../core/router'
import { isMentor, useSession } from '../../core/session'
import { toast } from '../../core/toast'
import { shortDate } from '../../core/format'
import { PageHead, Panel, Pick, Pill, Stepper } from '../../core/ui'
import { partsTable, systemsTable } from '../bom/data'
import {
  EMPTY_ITEM,
  STATUSES,
  TYPES,
  VENDORS,
  VIEWS,
  addBuyer,
  addItem,
  changeItem,
  choices,
  duplicateItem,
  groupItems,
  isAsking,
  itemToForm,
  removeBuyer,
  removeItem,
  requestFromBomPart,
  searchItems,
  statusOf,
  summaryText,
  useBuyers,
  useCanOrder,
  useItems,
  type NewItem,
  type PurchaseItem,
  type View,
} from './data'

// Fields and their boxes may shrink to the screen's width. Without this, a
// dropdown grows to fit its longest choice and the page scrolls sideways
// on a phone.
const FIELD: CSSProperties = { minWidth: 0 }
const BOX: CSSProperties = { minWidth: 0, width: '100%' }

const EMPTY_TEXT: Record<View, string> = {
  Current: 'Nothing in progress. Ask for something below, or look at All.',
  All: 'Nothing on the list yet. Ask for the first thing below.',
  'By status': 'Nothing on the list yet. Ask for the first thing below.',
  'By vendor': 'Nothing on the list yet. Ask for the first thing below.',
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
      </div>

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

      {/* At the end of the list, where you'd add a new row. */}
      {form ? (
        <InView key={form.key}>
          <Panel title="Ask for something">
            <ItemForm item={null} start={form.start} bomPartId={form.bomPartId} onDone={closeForm} />
          </Panel>
        </InView>
      ) : (
        <div className="toolbar">
          <button type="button" className="btn btn-primary" onClick={() => setAsking({ start: EMPTY_ITEM, bomPartId: null, key: 'new' })}>
            Ask for something
          </button>
        </div>
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
  const order = [item.ordered_by && `Ordered by ${nameOf(item.ordered_by)}`, item.shipped_to && `Shipped to ${nameOf(item.shipped_to)}`].filter(Boolean)

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
        <br />
        <span className="muted">{details.join(' · ')}</span>
        {bomPart && <><br /><span className="note">For BOM part {bomPart.part_number}</span></>}
        {item.notes && <><br /><span className="muted">{item.notes}</span></>}
        {order.length > 0 && <><br /><span className="note">{order.join(' · ')}</span></>}
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
  const statusLocked = !!item && !canOrder && !isAsking(item.status)
  const canDelete = !!item && (canOrder || isAsking(item.status))
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

  const text = (field: 'name' | 'link' | 'part_number', label: string, placeholder = '') => (
    <label className="field" style={FIELD} htmlFor={id(field)}>
      {label}
      <input id={id(field)} className="input" style={BOX} value={form[field]} placeholder={placeholder} onChange={(e) => set({ [field]: e.target.value })} />
    </label>
  )

  const select = (field: 'vendor' | 'type', label: string, list: string[]) => (
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
      {statusLocked && item ? (
        <div className="field" style={FIELD}>
          Status
          <span><Pill tone={statusOf(item.status).tone}>{statusOf(item.status).label}</Pill></span>
          <span className="note">Only mentors and purchasers change an order once it's placed.</span>
        </div>
      ) : (
        <label className="field" style={FIELD} htmlFor={id('status')}>
          {item ? 'Status' : 'Priority'}
          <select id={id('status')} className="input" style={BOX} value={form.status} onChange={(e) => set({ status: e.target.value as NewItem['status'] })}>
            {statuses.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
          <span className="note">{statusOf(form.status).hint}.</span>
        </label>
      )}
      {item && canOrder ? (
        <label className="field" style={FIELD} htmlFor={id('ordered-by')}>
          Ordered by
          <select id={id('ordered-by')} className="input" style={BOX} value={form.ordered_by} onChange={(e) => set({ ordered_by: e.target.value })}>
            <option value="">Nobody yet</option>
            {orderers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
          <span className="note">Marking it Order Placed makes this you, unless you pick someone else.</span>
        </label>
      ) : (
        item?.ordered_by && <p className="note" style={{ margin: 0 }}>Ordered by {nameOf(item.ordered_by)}</p>
      )}
      {canOrder ? (
        <label className="field" style={FIELD} htmlFor={id('shipped-to')}>
          Shipped to
          <select id={id('shipped-to')} className="input" style={BOX} value={form.shipped_to} onChange={(e) => set({ shipped_to: e.target.value })}>
            <option value="">Nobody yet</option>
            {people.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </label>
      ) : (
        item?.shipped_to && <p className="note" style={{ margin: 0 }}>Shipped to {nameOf(item.shipped_to)}</p>
      )}
      {select('vendor', 'Vendor', VENDORS)}
      {select('type', 'Type', TYPES)}
      <div className="field">
        <span>Number needed</span>
        <Stepper id={id('quantity')} label="Number needed" min={1} value={form.quantity} onChange={(quantity) => set({ quantity })} />
      </div>
      {text('link', 'Link to the product', 'https://…')}
      {text('part_number', 'Part or item number (if there is one)')}
      <label className="field" style={FIELD} htmlFor={id('notes')}>
        Notes
        <textarea id={id('notes')} className="input" style={BOX} rows={2} value={form.notes} onChange={(e) => set({ notes: e.target.value })} />
      </label>
      <div className="toolbar">
        <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : item ? 'Save' : 'Add to the list'}</button>
        <button type="button" className="btn" onClick={props.onDone}>Cancel</button>
        {canDelete && (
          <button type="button" className="btn" style={{ marginLeft: 'auto' }} onClick={() => void remove()}>
            {deleting ? 'Press again to delete' : 'Delete'}
          </button>
        )}
      </div>
    </form>
  )
}

/** Who the purchasers are, so people know who to ask. Mentors and admins add and remove them. */
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
