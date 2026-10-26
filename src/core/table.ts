/**
 * Tables: where modules keep their data.
 *
 * A module's data.ts makes a table with createTable(), and its pages read
 * rows with useRows(). The same code runs two ways:
 *
 *   - Demo mode (your computer, the tests, and the live site until the team
 *     database is set up): rows start as the example rows you give, and
 *     changes are saved in this browser only. "Reset example data" puts
 *     them back.
 *   - Live mode (the team site once the database is set up): rows come from
 *     the table of the same name in the team database. Everyone sees the
 *     same rows, and other people's changes show up by themselves.
 *
 * Each table needs a migration in supabase/migrations/ that makes it in the
 * database, with permission rules. The tests in supabase/tests/ check that
 * every table here has one, and that its example rows fit it.
 *
 * Demo mode doesn't check permissions; the database does. Test who can do
 * what in supabase/tests/.
 */
import { use, useSyncExternalStore } from 'react'
import type { RealtimePostgresChangesPayload, SupabaseClient } from '@supabase/supabase-js'
import { createStore, useStore } from './store'
import { supabase } from './supabase'
import { demoUserId } from './demo'

/** Every row has an id and the time it was made. Most also have created_by. */
export interface Row {
  id: string
  /** ISO date and time. */
  created_at: string
}

/** The columns you fill in yourself. The database fills in the others. */
export type Fields<T> = Omit<T, 'id' | 'created_at' | 'created_by'>

/** What a function that can fail returns: the result, or a message for the user. */
export type Result<T = null> = { ok: true; value: T } | { ok: false; error: string }

export function ok<T>(value: T): { ok: true; value: T } {
  return { ok: true, value }
}

export function fail(error: string): { ok: false; error: string } {
  return { ok: false, error }
}

export interface Table<T extends Row> {
  /** The table's name in the database, like 'inventory_parts'. */
  readonly name: string
  /** The example rows used in demo mode. */
  readonly demoRows: readonly T[]
  /** Every row, in order. Use this in data.ts; in a component use useRows(). */
  rows(): T[]
  /**
   * Every row, in order, for a component. The component redraws when rows
   * change. In live mode, the page shows "Loading…" until the rows arrive.
   */
  useRows(): T[]
  /** Add a row. The database fills in id, created_at and created_by. */
  insert(fields: Fields<T>): Promise<Result<T>>
  /** Change some columns of one row. */
  update(id: string, changes: Partial<Fields<T>>): Promise<Result<T>>
  /** Delete one row. */
  remove(id: string): Promise<Result>
  /** Demo mode: put the example rows back. Tests call this before each test. */
  reset(): void
}

export interface TableOptions<T extends Row> {
  /** Example rows for demo mode. Made up: never real people's information. */
  demo: T[]
  /**
   * Raise this when you change what a row looks like, so example rows saved
   * in people's browsers under the old shape are replaced.
   */
  version?: number
  /** The order rows come in. Leave it out for oldest first. */
  sort?: (a: T, b: T) => number
}

export const oldestFirst = (a: Row, b: Row) => a.created_at.localeCompare(b.created_at)
export const newestFirst = (a: Row, b: Row) => b.created_at.localeCompare(a.created_at)

const tables = new Map<string, Table<Row>>()

/** Every table any module has made. The database tests check each one. */
export function allTables(): Table<Row>[] {
  return [...tables.values()]
}

/**
 * Make a table.
 *
 * @param name  The table's name in the database: lowercase with
 *              underscores, starting with your module's name, like
 *              'inventory_parts'.
 */
export function createTable<T extends Row>(name: string, options: TableOptions<T>): Table<T> {
  const sort = options.sort ?? oldestFirst
  const order = (rows: T[]) => [...rows].sort(sort)
  const table = supabase ? liveTable(supabase, name, options, order) : demoTable(name, options, order)
  tables.set(name, table as unknown as Table<Row>)
  return table
}

// ---------------------------------------------------------------------------
// Demo mode: rows saved in this browser.

function demoTable<T extends Row>(name: string, options: TableOptions<T>, order: (rows: T[]) => T[]): Table<T> {
  const store = createStore<T[]>(`table:${name}`, options.version ?? 1, () => order(structuredClone(options.demo)))
  const find = (id: string) => store.get().find((row) => row.id === id)

  return {
    name,
    demoRows: options.demo,
    rows: store.get,
    useRows: () => useStore(store),
    async insert(fields) {
      const row = { id: newId(), created_at: new Date().toISOString(), created_by: demoUserId(), ...fields } as unknown as T
      store.set((rows) => order([...rows, row]))
      return ok(row)
    },
    async update(id, changes) {
      const current = find(id)
      if (!current) return fail(GONE)
      const row = { ...current, ...changes }
      store.set((rows) => order(replaceRow(rows, row)))
      return ok(row)
    },
    async remove(id) {
      if (!find(id)) return fail(GONE)
      store.set((rows) => rows.filter((row) => row.id !== id))
      return ok(null)
    },
    reset: store.reset,
  }
}

/** A random id like the database makes. Works on http:// pages too, unlike crypto.randomUUID(). */
function newId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

// ---------------------------------------------------------------------------
// Live mode: rows in the team database.

type LiveState<T> =
  | { status: 'idle' }
  | { status: 'loading'; ready: Promise<void> }
  | { status: 'ready'; rows: T[] }
  | { status: 'failed'; error: Error }

const NO_ROWS: never[] = []

function liveTable<T extends Row>(
  client: SupabaseClient,
  name: string,
  options: TableOptions<T>,
  order: (rows: T[]) => T[],
): Table<T> {
  let state: LiveState<T> = { status: 'idle' }
  let listening = false
  const listeners = new Set<() => void>()

  const getState = () => state
  const setState = (next: LiveState<T>) => {
    state = next
    listeners.forEach((listener) => listener())
  }
  const subscribe = (listener: () => void) => {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }
  const change = (edit: (rows: T[]) => T[]) => {
    if (state.status === 'ready') setState({ status: 'ready', rows: order(edit(state.rows)) })
  }

  async function fetchRows(): Promise<T[]> {
    const { data, error } = await client.from(name).select('*')
    if (error) throw new Error(`Couldn't load ${name}. ${explain(error)}`)
    return order(data as T[])
  }

  // Starts loading the first time a page asks for rows. It doesn't tell
  // anyone, because it runs while a page is drawing; the page waits on
  // `ready` instead.
  function load() {
    if (state.status !== 'idle') return
    listen()
    const ready = fetchRows().then(
      (rows) => setState({ status: 'ready', rows }),
      (error: Error) => setState({ status: 'failed', error }),
    )
    state = { status: 'loading', ready }
  }

  // Other people's changes arrive by themselves. When the tab comes back
  // after being hidden (a phone asleep in a pocket), reload in case some
  // were missed.
  function listen() {
    if (listening) return
    listening = true
    client
      .channel(`table:${name}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: name }, (payload: RealtimePostgresChangesPayload<T>) =>
        change((rows) => applyChange(rows, payload)),
      )
      .subscribe()
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible' || state.status !== 'ready') return
      fetchRows().then(
        (rows) => setState({ status: 'ready', rows }),
        () => {},
      )
    })
  }

  return {
    name,
    demoRows: options.demo,
    rows: () => (state.status === 'ready' ? state.rows : NO_ROWS),
    useRows() {
      load()
      const current = useSyncExternalStore(subscribe, getState, getState)
      if (current.status === 'loading') use(current.ready)
      if (current.status === 'failed') {
        // Try again next time the page draws (the "Try again" button).
        state = { status: 'idle' }
        throw current.error
      }
      return current.status === 'ready' ? current.rows : NO_ROWS
    },
    async insert(fields) {
      const { data, error } = await client.from(name).insert(fields as Record<string, unknown>).select().single()
      if (error) return fail(explain(error))
      change((rows) => replaceRow(rows, data as T))
      return ok(data as T)
    },
    async update(id, changes) {
      const { data, error } = await client.from(name).update(changes as Record<string, unknown>).eq('id', id).select().single()
      if (error) return fail(explain(error))
      change((rows) => replaceRow(rows, data as T))
      return ok(data as T)
    },
    async remove(id) {
      const { data, error } = await client.from(name).delete().eq('id', id).select('id')
      if (error) return fail(explain(error))
      if (data.length === 0) return fail(NOT_ALLOWED)
      change((rows) => rows.filter((row) => row.id !== id))
      return ok(null)
    },
    reset() {},
  }
}

// ---------------------------------------------------------------------------
// Shared by both modes. Exported for the tests.

/** Put a row in the list, replacing the row with the same id if there is one. */
export function replaceRow<T extends Row>(rows: T[], row: T): T[] {
  return rows.some((r) => r.id === row.id) ? rows.map((r) => (r.id === row.id ? row : r)) : [...rows, row]
}

/** Apply a change someone else made, as the database reports it. */
export function applyChange<T extends Row>(
  rows: T[],
  change: { eventType: 'INSERT' | 'UPDATE' | 'DELETE'; new: Partial<T> | object; old: Partial<T> | object },
): T[] {
  if (change.eventType === 'DELETE') {
    const id = (change.old as Partial<T>).id
    return rows.filter((row) => row.id !== id)
  }
  return replaceRow(rows, change.new as T)
}

const GONE = 'That has already been deleted.'
const NOT_ALLOWED = "You don't have permission to do that, or it was already deleted."

/** Turn a database error into something to show the person. */
export function explain(error: { code?: string; message: string }): string {
  switch (error.code) {
    case '42501':
      return "You don't have permission to do that."
    case 'PGRST116':
      return NOT_ALLOWED
    case '23505':
      return "That's already there."
    case '23514':
      return "That doesn't fit the rules for this list."
    case '23503':
      return 'That refers to something that has been deleted.'
    case 'P0001':
      // Raised by the database's own rules, which are written for people to read.
      return error.message
  }
  if (/failed to fetch|network|load failed/i.test(error.message)) {
    return "Couldn't reach the team database. Check your connection and try again."
  }
  return `The team database said: ${error.message}`
}
