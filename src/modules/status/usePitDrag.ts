import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react'
import { reorderPitItem } from './data'

interface DragRow { id: string; top: number; height: number }
interface Drag {
  id: string
  rows: DragRow[]
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

/** Preview the order with transforms; save only once the drop animation ends. */
export function usePitDrag(onResult: (error: string, announcement: string) => void) {
  const [drag, setDrag] = useState<Drag | null>(null)
  const current = useRef<Drag | null>(null)
  const frame = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    cancelAnimationFrame(frame.current)
    if (timer.current) clearTimeout(timer.current)
  }, [])

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
    const inside = state.x >= state.left && state.x <= state.right
      && state.y + window.scrollY >= state.rows[0].top
      && state.y + window.scrollY <= state.rows.at(-1)!.top + state.rows.at(-1)!.height
    // Shift neighbors when the dragged center crosses their near edge, so a
    // half-row movement is enough to open the next slot in either direction.
    const to = inside ? state.rows.filter((row, index) => row.id !== state.id
      && top + source.height / 2 > row.top + (index < state.from ? row.height : 0)).length : state.from
    return { ...state, to, inside, offset: top - source.top }
  }

  function tick() {
    const state = current.current
    if (!state || state.settling) return
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
    const duration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 180
    timer.current = setTimeout(() => {
      if (to !== state.from) {
        const result = reorderPitItem(state.id, state.rows[to].id)
        onResult(result.ok ? '' : result.error, result.ok ? `Item moved to position ${to + 1}.` : '')
      }
      current.current = null
      setDrag(null)
      timer.current = null
    }, duration)
  }

  function start(event: PointerEvent<HTMLButtonElement>, id: string) {
    if (event.button !== 0 || current.current) return
    const list = event.currentTarget.closest('ul')!
    list.querySelectorAll('details[open]').forEach((menu) => menu.removeAttribute('open'))
    const rows = [...list.querySelectorAll<HTMLElement>('[data-pit-id]')].map((row) => {
      const rect = row.getBoundingClientRect()
      return { id: row.dataset.pitId!, top: rect.top + window.scrollY, height: rect.height }
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

  function move(event: PointerEvent<HTMLButtonElement>) {
    if (!current.current || current.current.settling) return
    current.current.x = event.clientX
    current.current.y = event.clientY
  }

  function style(id: string): CSSProperties | undefined {
    // Once the DOM takes over the preview order, clear transforms instantly
    // so rows stay at their settled screen positions instead of sliding twice.
    if (!drag) return { transition: 'none' }
    const row = drag.rows.find((row) => row.id === id)
    if (!row) return
    const offset = id === drag.id ? drag.offset : slotTop(drag, id) - row.top
    return {
      transform: `translate3d(0, ${offset}px, 0)`,
      transition: id === drag.id && !drag.settling ? 'none' : undefined,
      zIndex: id === drag.id ? 6 : undefined,
    }
  }

  return { start, move, finish, style, activeId: drag?.id }
}
