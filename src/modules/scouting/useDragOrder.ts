import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react'

// Drag and drop for the picklists (My picklist and the Final picklist).
// Based on the pit checklist's usePitDrag.ts in the status module. If more
// modules want it, a mentor could move one copy into src/core/.
//
// How it feels smooth:
// - While you drag, rows only move with CSS transforms, so nothing is saved
//   or redrawn until you let go.
// - When you let go (or use Move to…), the new order shows straight away and
//   stays while it saves. If saving fails, the list goes back and says why.
// - Whenever the order changes, for any reason (another phone, too), rows
//   slide from where they were to where they are now.
// - A row being removed fades while it saves, then the rows below slide up.

/** What a save gives back: ok, or an error written for the user. */
export interface MoveResult { ok: boolean; error?: string }

interface Slot { id: string; top: number; height: number }
interface Drag {
  id: string
  rows: Slot[]
  from: number
  to: number
  offset: number
  grabY: number
  x: number
  y: number
  left: number
  right: number
  inside: boolean
  settling: boolean
}

export interface DragOrderOptions<T> {
  items: T[]
  idOf: (item: T) => string
  /** Save the move: put item `id` at index `to` of `items` (0 is the top). */
  save: (id: string, to: number) => Promise<MoveResult>
  /** After a move saves or fails. `place` is its new place, 1 at the top. */
  onDone: (id: string, result: MoveResult, place: number) => void
  /** The id of a row being removed, if any. It fades, and moves wait until it's gone. */
  removing?: string | null
}

const SETTLE_MS = 180
const SLIDE_MS = 220
const FLASH_MS = 1200

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** Put items in the order of `ids`. Any not in it go at the end. */
function arrange<T>(items: T[], idOf: (item: T) => string, ids: string[]): T[] {
  const index = new Map(ids.map((id, i) => [id, i]))
  return [...items].sort((a, b) => (index.get(idOf(a)) ?? ids.length) - (index.get(idOf(b)) ?? ids.length))
}

export function useDragOrder<T>({ items, idOf, save, onDone, removing = null }: DragOrderOptions<T>) {
  const [drag, setDrag] = useState<Drag | null>(null)
  const current = useRef<Drag | null>(null)
  // The order to show while a move saves.
  const [pending, setPending] = useState<string[] | null>(null)
  // The row that just moved, to light up and scroll to. `n` restarts it.
  const [moved, setMoved] = useState<{ id: string; n: number } | null>(null)
  const listRef = useRef<HTMLOListElement | null>(null)
  // `list` is given to the <ol> as its ref. A function, not the ref itself,
  // so pages never read the ref while drawing.
  const list = useCallback((element: HTMLOListElement | null) => { listRef.current = element }, [])
  const frame = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tops = useRef(new Map<string, number>())
  const wasDragging = useRef(false)

  const ordered = pending ? arrange(items, idOf, pending) : items
  const busy = pending !== null || removing !== null

  useEffect(() => () => {
    cancelAnimationFrame(frame.current)
    if (timer.current) clearTimeout(timer.current)
  }, [])

  // Slide rows that changed place. offsetTop ignores transforms, so a row
  // that's still sliding isn't mistaken for one that moved again.
  useLayoutEffect(() => {
    const list = listRef.current
    if (!list || drag) {
      wasDragging.current = !!drag
      return
    }
    // A drop has already put the row in its new place on screen.
    const slide = !wasDragging.current && !reducedMotion()
    wasDragging.current = false
    const next = new Map<string, number>()
    for (const row of list.querySelectorAll<HTMLElement>('[data-drag-id]')) {
      const id = row.dataset.dragId!
      next.set(id, row.offsetTop)
      const before = tops.current.get(id)
      if (slide && before !== undefined && Math.abs(before - row.offsetTop) > 1) {
        row.animate(
          [{ transform: `translate3d(0, ${before - row.offsetTop}px, 0)` }, { transform: 'none' }],
          { duration: SLIDE_MS, easing: 'cubic-bezier(.2, .8, .2, 1)' },
        )
      }
    }
    tops.current = next
  })

  // Scroll a moved row into view if it went off screen, and stop lighting it up after a moment.
  useEffect(() => {
    if (!moved) return
    const row = [...(listRef.current?.querySelectorAll<HTMLElement>('[data-drag-id]') ?? [])].find((r) => r.dataset.dragId === moved.id)
    row?.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' })
    const stop = setTimeout(() => setMoved((now) => (now === moved ? null : now)), FLASH_MS)
    return () => clearTimeout(stop)
  }, [moved])

  /** Show the move straight away, save it, then show what was saved. */
  async function commit(id: string, to: number) {
    const ids = ordered.map(idOf)
    const from = ids.indexOf(id)
    current.current = null
    setDrag(null)
    if (from < 0 || to < 0 || to === from) return
    ids.splice(from, 1)
    ids.splice(Math.min(to, ids.length), 0, id)
    setPending(ids)
    setMoved((last) => ({ id, n: (last?.n ?? 0) + 1 }))
    let result: MoveResult
    try {
      result = await save(id, to)
    } catch {
      result = { ok: false, error: "Couldn't save the move. Check the connection and try again." }
    }
    setPending(null)
    onDone(id, result, to + 1)
  }

  /** Move a row to index `to` of the list (0 is the top), like Move to… does. */
  function moveTo(id: string, to: number) {
    if (busy || current.current) return
    void commit(id, Math.max(0, Math.min(ordered.length - 1, to)))
  }

  // ---- Dragging (the same steps as usePitDrag.ts) ----

  function slotTop(state: Drag, id: string): number {
    const order = [...state.rows]
    const [source] = order.splice(state.from, 1)
    order.splice(state.to, 0, source)
    let top = state.rows[0].top
    for (const row of order) {
      if (row.id === id) return top
      top += row.height
    }
    return top
  }

  function measure(state: Drag): Drag {
    const source = state.rows[state.from]
    const top = state.y + window.scrollY - state.grabY
    const last = state.rows.at(-1)!
    const inside = state.x >= state.left && state.x <= state.right
      && state.y + window.scrollY >= state.rows[0].top
      && state.y + window.scrollY <= last.top + last.height
    // A neighbour moves out of the way once the dragged row's middle passes its near edge.
    const to = inside ? state.rows.filter((row, index) => row.id !== state.id
      && top + source.height / 2 > row.top + (index < state.from ? row.height : 0)).length : state.from
    return { ...state, to, inside, offset: top - source.top }
  }

  function tick() {
    const state = current.current
    if (!state || state.settling) return
    // Scroll the page when the finger is near the top or bottom edge.
    const edge = state.y > innerHeight - 70 ? Math.min(14, (state.y - innerHeight + 70) / 4)
      : state.y < 130 ? -Math.min(14, (130 - state.y) / 4) : 0
    if (edge) window.scrollBy(0, edge)
    const next = measure(state)
    current.current = next
    setDrag(next)
    frame.current = requestAnimationFrame(tick)
  }

  function finish(cancel = false) {
    if (!current.current || current.current.settling) return
    const state = measure(current.current)
    cancelAnimationFrame(frame.current)
    const to = cancel || !state.inside ? state.from : state.to
    const settled = { ...state, to, settling: true }
    settled.offset = slotTop(settled, state.id) - state.rows[state.from].top
    current.current = settled
    setDrag(settled)
    timer.current = setTimeout(() => {
      timer.current = null
      // Rows hidden from the page (like Hide picked) aren't in state.rows,
      // so find where the row it landed on is in the whole list.
      const target = state.rows[to].id
      void commit(state.id, to === state.from ? -1 : ordered.findIndex((item) => idOf(item) === target))
    }, reducedMotion() ? 0 : SETTLE_MS)
  }

  function start(event: PointerEvent<HTMLButtonElement>, id: string) {
    if (event.button !== 0 || current.current || busy) return
    const list = event.currentTarget.closest('ol')
    if (!list) return
    list.querySelectorAll('details[open]').forEach((menu) => menu.removeAttribute('open'))
    const rows = [...list.querySelectorAll<HTMLElement>('[data-drag-id]')].map((row) => {
      const rect = row.getBoundingClientRect()
      return { id: row.dataset.dragId!, top: rect.top + window.scrollY, height: rect.height }
    })
    const from = rows.findIndex((row) => row.id === id)
    const rect = list.getBoundingClientRect()
    current.current = {
      id, rows, from, to: from, offset: 0, grabY: event.clientY + window.scrollY - rows[from].top,
      x: event.clientX, y: event.clientY, left: rect.left, right: rect.right, inside: true, settling: false,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    event.currentTarget.focus()
    setDrag(current.current)
    frame.current = requestAnimationFrame(tick)
  }

  function follow(event: PointerEvent<HTMLButtonElement>) {
    if (!current.current || current.current.settling) return
    current.current.x = event.clientX
    current.current.y = event.clientY
  }

  /** Arrow keys move one place, Home and End to the top and bottom. Escape cancels a drag. */
  function key(event: KeyboardEvent<HTMLButtonElement>, id: string) {
    if (event.key === 'Escape') finish(true)
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    if (current.current || busy) return
    // The rows on screen, so a hidden row (like Hide picked) is skipped over.
    const shown = [...(listRef.current?.querySelectorAll<HTMLElement>('[data-drag-id]') ?? [])].map((row) => row.dataset.dragId!)
    const at = shown.indexOf(id)
    const target = ({ ArrowUp: shown[at - 1], ArrowDown: shown[at + 1], Home: shown[0], End: shown.at(-1) } as Record<string, string | undefined>)[event.key]
    if (target && target !== id) void commit(id, ordered.findIndex((item) => idOf(item) === target))
  }

  function style(id: string): CSSProperties | undefined {
    // With no drag, transforms clear at once, so a dropped row doesn't slide twice.
    if (!drag) return { transition: 'none' }
    const row = drag.rows.find((r) => r.id === id)
    if (!row) return
    const offset = id === drag.id ? drag.offset : slotTop(drag, id) - row.top
    return {
      transform: `translate3d(0, ${offset}px, 0)`,
      transition: id === drag.id && !drag.settling ? 'none' : undefined,
      zIndex: id === drag.id ? 6 : undefined,
    }
  }

  /** Spread on each row's <li>. */
  function rowProps(id: string) {
    const lifted = drag?.id === id
    const flash = !drag && moved?.id === id
    return {
      'data-drag-id': id,
      className: removing === id ? 'drag-leaving' : lifted ? 'drag-lifted' : flash ? 'drag-moved' : undefined,
      style: style(id),
    }
  }

  /** Spread on the drag handle <button>, with what a screen reader says for it. */
  function handleProps(id: string, label: string) {
    return {
      type: 'button' as const,
      className: 'drag-handle',
      'aria-label': label,
      'aria-disabled': busy || undefined,
      title: 'Drag to move. Or use the arrow keys.',
      onPointerDown: (event: PointerEvent<HTMLButtonElement>) => start(event, id),
      onPointerMove: follow,
      onPointerUp: (event: PointerEvent<HTMLButtonElement>) => { follow(event); finish() },
      onPointerCancel: () => finish(true),
      onLostPointerCapture: () => finish(true),
      onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => key(event, id),
    }
  }

  return { items: ordered, busy, list, rowProps, handleProps, moveTo }
}
