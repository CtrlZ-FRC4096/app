/** Short messages at the bottom of the screen, such as "Took 2 × Kraken X60 motor". */
import { createStore, useStore } from './store'

const toastStore = createStore<{ id: number; text: string } | null>('toast', 1, () => null, {
  keepOnReset: true,
  persist: false,
})
let timer: ReturnType<typeof setTimeout> | undefined
let counter = 0

export function toast(text: string) {
  counter += 1
  toastStore.set({ id: counter, text })
  clearTimeout(timer)
  timer = setTimeout(() => toastStore.set(null), 2800)
}

export function useToast() {
  return useStore(toastStore)
}
