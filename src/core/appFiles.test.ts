import { describe, expect, it } from 'vitest'
import worker from '../../public/sw.js?raw'
import { FILES_MARKER, VERSION_MARKER, appFileList, fillWorker } from './appFiles'

describe('appFileList', () => {
  it('keeps every built file but the worker and source maps, sorted, with / between folders', () => {
    expect(appFileList(['sw.js', 'index.html', 'assets\\index-a1.js', 'assets/ScoutingPage-b2.js', 'assets/index-a1.js.map', 'icon-192.png'])).toEqual([
      'assets/ScoutingPage-b2.js',
      'assets/index-a1.js',
      'icon-192.png',
      'index.html',
    ])
  })
})

describe('fillWorker', () => {
  const source = `${VERSION_MARKER}\n${FILES_MARKER}\nself.addEventListener('fetch', () => {})`

  it('writes the version and the list of files into the worker', () => {
    const filled = fillWorker(source, ['index.html', 'assets/index-a1.js'], 'abc123')
    expect(filled).toContain('const VERSION = "abc123"')
    expect(filled).toContain('const APP_FILES = ["index.html","assets/index-a1.js"]')
    expect(filled).toContain("self.addEventListener('fetch'")
  })

  it('stops the build if a line is missing or there twice', () => {
    expect(() => fillWorker(FILES_MARKER, [], 'v')).toThrow(VERSION_MARKER)
    expect(() => fillWorker(`${source}\n${FILES_MARKER}`, [], 'v')).toThrow(FILES_MARKER)
  })

  it('works on the real public/sw.js', () => {
    expect(() => fillWorker(worker, ['index.html'], 'v')).not.toThrow()
  })
})
