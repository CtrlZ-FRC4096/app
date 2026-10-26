/**
 * State saved in this browser.
 *
 * Modules don't use this directly: their data goes in a table from
 * createTable() (src/core/table.ts), which uses these stores for example
 * data in demo mode. The app also uses them for things that belong to one
 * browser, like the "View as" switch.
 *
 * Saved copies survive a reload, but only on that device, and "Reset example
 * data" in the banner puts them back.
 */
import { useSyncExternalStore } from 'react'

type Listener = () => void

export interface Store<T> {
  get(): T
  set(next: T | ((prev: T) => T)): void
  reset(): void
  subscribe(listener: Listener): () => void
}

const PREFIX = 'ctrlz-app:'
const resettable: Store<unknown>[] = []

function readSaved(key: string): unknown {
  try {
    const raw = globalThis.localStorage?.getItem(PREFIX + key)
    return raw == null ? undefined : JSON.parse(raw)
  } catch {
    return undefined
  }
}

function writeSaved(key: string, value: unknown) {
  try {
    globalThis.localStorage?.setItem(PREFIX + key, JSON.stringify(value))
  } catch {
    // Private windows and full storage refuse writes. Keep going in memory.
  }
}

function removeSaved(key: string) {
  try {
    globalThis.localStorage?.removeItem(PREFIX + key)
  } catch {
    // Nothing saved, so nothing to remove.
  }
}

/**
 * @param key      A name no other store uses.
 * @param version  Raise this when you change the shape of the data. Copies
 *                 saved under the old version are ignored instead of
 *                 breaking the page for anyone who visited before.
 * @param initial  The example data to start from.
 */
export function createStore<T>(
  key: string,
  version: number,
  initial: () => T,
  options: { keepOnReset?: boolean; persist?: boolean } = {},
): Store<T> {
  const fullKey = `${key}:v${version}`
  const persist = options.persist !== false
  const saved = persist ? readSaved(fullKey) : undefined
  let value: T = saved === undefined ? initial() : (saved as T)
  const listeners = new Set<Listener>()
  const notify = () => listeners.forEach((listener) => listener())

  const store: Store<T> = {
    get: () => value,
    set(next) {
      value = typeof next === 'function' ? (next as (prev: T) => T)(value) : next
      if (persist) writeSaved(fullKey, value)
      notify()
    },
    reset() {
      value = initial()
      if (persist) removeSaved(fullKey)
      notify()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
  if (!options.keepOnReset) resettable.push(store as Store<unknown>)
  return store
}

/** Read a store in a component. The component re-renders when it changes. */
export function useStore<T>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, store.get, store.get)
}

/** Put every module's example data back the way it started. */
export function resetAllStores() {
  resettable.forEach((store) => store.reset())
}
