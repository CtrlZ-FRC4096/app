/**
 * How big the app is drawn: Smallest, Smaller, Normal, Larger or Largest.
 *
 * Someone picks it at the bottom of the home page, next to Appearance, and
 * it's saved in this browser. The whole app is drawn bigger or smaller with
 * CSS zoom on the page: like the browser's own zoom, but for this app only.
 *
 * index.html puts the same zoom on the page before anything is drawn (Normal
 * when nothing is saved), so it doesn't jump in size while the app loads. If
 * you change how the choice is saved, or add a size or change its number,
 * change that script too (size.test.ts checks they match).
 */
import { createStore, useStore } from './store'

export const SIZES = ['Smallest', 'Smaller', 'Normal', 'Larger', 'Largest'] as const
export type Size = (typeof SIZES)[number]

/**
 * How big each size draws the app, compared with how styles.css is written:
 * 1 is as written, 0.9 is 10% smaller. Normal, what everyone gets until they
 * pick, is a little smaller than written.
 */
export const SIZE_ZOOM: Record<Size, number> = { Smallest: 0.7, Smaller: 0.8, Normal: 0.9, Larger: 1, Largest: 1.15 }

// Saved as ctrlz-app:size:v1, which is the key index.html reads.
const sizeStore = createStore<Size>('size', 1, () => 'Normal', { keepOnReset: true })

/** The zoom for a saved size. Anything that isn't a size (like an old saved value) is Normal. */
export function zoomFor(size: unknown): number {
  return SIZE_ZOOM[SIZES.includes(size as Size) ? (size as Size) : 'Normal']
}

/**
 * Put the chosen size on the page. --zoom is for CSS that sizes something
 * from the screen's width: 100vw doesn't shrink with the zoom, so
 * `calc(100vw / var(--zoom, 1) - 32px)` is how to say "the screen less 32px".
 */
function apply() {
  const root = globalThis.document?.documentElement
  if (!root) return
  const zoom = zoomFor(sizeStore.get())
  root.style.zoom = zoom === 1 ? '' : String(zoom)
  root.style.setProperty('--zoom', String(zoom))
}

export function useSize(): Size {
  return useStore(sizeStore)
}

export function setSize(size: Size) {
  sizeStore.set(size)
  apply()
}

apply()
