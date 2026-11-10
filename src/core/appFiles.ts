/**
 * The list of the app's files that the service worker (public/sw.js) keeps
 * on the device: see offline.ts. After each build, vite.config.ts lists the
 * built files and writes them into dist/sw.js with these. They're here, not
 * in vite.config.ts, so they're tested.
 *
 * No browser or Node.js parts here: both the build and the app's tests use it.
 */

/** The line in public/sw.js that the build replaces with the list of files. */
export const FILES_MARKER = 'const APP_FILES = [] // The build fills this in.'

/** The line in public/sw.js that the build replaces with this version's name. */
export const VERSION_MARKER = "const VERSION = 'dev' // The build fills this in."

/** Which built files to keep on the device: all of them but the worker itself and source maps. Sorted, with / between folders. */
export function appFileList(paths: string[]): string[] {
  return paths
    .map((path) => path.replaceAll('\\', '/'))
    .filter((path) => path !== 'sw.js' && !path.endsWith('.map'))
    .sort()
}

/**
 * sw.js with the list of files and the version written in. It throws if
 * either line is missing, or there twice, so a changed sw.js fails the
 * build instead of quietly stopping the app working offline.
 */
export function fillWorker(source: string, files: string[], version: string): string {
  for (const marker of [FILES_MARKER, VERSION_MARKER]) {
    if (source.split(marker).length !== 2) throw new Error(`public/sw.js needs this line exactly once: ${marker}`)
  }
  return source
    .replace(FILES_MARKER, () => `const APP_FILES = ${JSON.stringify(files)}`)
    .replace(VERSION_MARKER, () => `const VERSION = ${JSON.stringify(version)}`)
}
