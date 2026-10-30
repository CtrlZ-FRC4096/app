/**
 * Light or dark.
 *
 * The page follows the device's own setting unless someone picks one at the
 * bottom of the home page, and that choice is saved in this browser. The
 * colours themselves live in styles.css, under :root[data-theme='dark'].
 *
 * index.html sets the same attribute before anything is drawn, so a dark
 * page never flashes white while the app loads. If you change how the
 * choice is saved, change that script too.
 */
import { createStore, useStore } from './store'

export const THEMES = ['System', 'Light', 'Dark'] as const
export type Theme = (typeof THEMES)[number]

// Saved as ctrlz-app:theme:v1, which is the key index.html reads.
const themeStore = createStore<Theme>('theme', 1, () => 'System', { keepOnReset: true })

/** Which colours to use: the device's setting, unless someone chose one. */
export function resolveTheme(theme: Theme, deviceIsDark: boolean): 'light' | 'dark' {
  if (theme === 'System') return deviceIsDark ? 'dark' : 'light'
  return theme === 'Dark' ? 'dark' : 'light'
}

const deviceDark = globalThis.matchMedia?.('(prefers-color-scheme: dark)')

/** Put the chosen colours on the page. */
function paint() {
  const root = globalThis.document?.documentElement
  if (root) root.dataset.theme = resolveTheme(themeStore.get(), deviceDark?.matches ?? false)
}

export function useTheme(): Theme {
  return useStore(themeStore)
}

export function setTheme(theme: Theme) {
  themeStore.set(theme)
  paint()
}

// While it's set to System, follow the device if someone changes it there.
deviceDark?.addEventListener('change', paint)
paint()
