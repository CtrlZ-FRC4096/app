/**
 * Robot photos waiting on this phone (#164), kept in the browser's
 * IndexedDB rather than a store from createStore(). Stores live in
 * localStorage, which holds only about 5 MB, and a few photos would fill
 * it. IndexedDB holds files (Blobs) and has much more room.
 *
 * This is only where the files are kept. Which photos are waiting, and the
 * rules, are in data.ts (photoStore and "Robot photos").
 *
 * If IndexedDB can't be used (tests, or some private browsing windows),
 * photos are kept in memory instead: they still upload once there's a
 * connection, but are lost if the app is closed first.
 */

const DATABASE = 'ctrlz-scouting-photos'
const FILES = 'files'

const inMemory = new Map<string, Blob>()

let opening: Promise<IDBDatabase | null> | null = null

function open(): Promise<IDBDatabase | null> {
  opening ??= new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') return resolve(null)
    try {
      const request = indexedDB.open(DATABASE, 1)
      request.onupgradeneeded = () => request.result.createObjectStore(FILES)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
  return opening
}

/** Run one request on the files, or give back null if IndexedDB can't be used. */
async function withFiles<T>(mode: IDBTransactionMode, run: (files: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  const db = await open()
  if (!db) return null
  return new Promise((resolve) => {
    try {
      const request = run(db.transaction(FILES, mode).objectStore(FILES))
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

/** Keep a photo's file on this phone. */
export async function keepFile(id: string, file: Blob): Promise<void> {
  const saved = await withFiles('readwrite', (files) => files.put(file, id))
  if (saved === null) inMemory.set(id, file)
}

/** A photo's file kept on this phone, or null if it isn't here. */
export async function readFile(id: string): Promise<Blob | null> {
  if (inMemory.has(id)) return inMemory.get(id)!
  return (await withFiles<Blob | undefined>('readonly', (files) => files.get(id))) ?? null
}

/** Forget a photo's file, once it's uploaded. */
export async function forgetFile(id: string): Promise<void> {
  inMemory.delete(id)
  await withFiles('readwrite', (files) => files.delete(id))
}
