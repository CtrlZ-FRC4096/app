// Tests for the match videos panel on the team page (#41). VideoList is
// drawn with made-up rows, so these don't wait for The Blue Alliance.
import { describe, expect, it } from 'vitest'
import { renderToString } from 'react-dom/server'
import type { QualVideoRow } from './data'
import TeamVideos, { VideoList } from './TeamVideos'

// A played qual on red, with one video. Each test changes only the part it's about.
const row = (number: number, fields: Partial<QualVideoRow> = {}): QualVideoRow => ({
  key: `2026test_qm${number}`, number, alliance: 'red', result: 'Won', ourScore: 84, theirScore: 71, links: ['https://youtu.be/example-video'], ...fields,
})

describe('the match videos list', () => {
  it('shows each qual with how it went and a link to watch it', () => {
    const html = renderToString(<VideoList rows={[row(12)]} />)
    expect(html).toContain('Qual 12 · Red · Won 84–71')
    expect(html).toContain('href="https://youtu.be/example-video"')
    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="noopener noreferrer"')
    expect(html).toContain('Watch ↗')
  })

  it('numbers the extra videos for a match', () => {
    const html = renderToString(<VideoList rows={[row(3, { links: ['https://youtu.be/one', 'https://youtu.be/two'] })]} />)
    expect(html).toContain('Watch ↗')
    expect(html).toContain('Watch (2) ↗')
    expect(html).toContain('href="https://youtu.be/two"')
  })

  it('tells a played match with no video from one not played yet', () => {
    const html = renderToString(<VideoList rows={[row(1, { result: 'Lost', ourScore: 60, theirScore: 70, links: [] }), row(2, { alliance: 'blue', result: null, ourScore: -1, theirScore: -1, links: [] })]} />)
    expect(html).toContain('Qual 1 · Red · Lost 60–70')
    expect(html).toContain('No video yet')
    expect(html).toContain('Qual 2 · Blue · Not played yet')
    expect(html.match(/No video yet/g)).toHaveLength(1)
    expect(html).not.toContain('<a ')
  })

  it('only links to videos: no players or thumbnails', () => {
    const html = renderToString(<VideoList rows={[row(1), row(2, { links: [] })]} />)
    expect(html).not.toContain('<iframe')
    expect(html).not.toContain('<img')
  })

  it('says it is looking while the panel first loads', () => {
    const html = renderToString(<TeamVideos team={4096} />)
    expect(html).toContain('Match videos')
    expect(html).toContain('Looking for videos…')
  })
})
