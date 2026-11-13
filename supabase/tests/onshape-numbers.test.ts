// Tests for writing team part numbers into Onshape: the onshape server
// function's part-numbers request (supabase/functions/onshape/numbers.ts).
// Onshape is made up here: a fake fetch answers like Onshape's API, cut down
// to what we read, and records what was sent. Nothing touches the network.
import { describe, expect, it, vi } from 'vitest'
import { createOnshape, paths } from '../functions/onshape/onshape.ts'
import {
  createOnshapeWriter, MOST_NUMBERS, PART_NUMBER_PROPERTY, partMetadataPath, partNumbersRequest, skipReason, writePartNumbers,
  type NumberAsk,
} from '../functions/onshape/numbers.ts'

const D = 'aaaaaaaaaaaaaaaaaaaaaaaa'
const W = 'bbbbbbbbbbbbbbbbbbbbbbbb'
const ASSEMBLY = 'cccccccccccccccccccccccc'
const STUDIO = 'dddddddddddddddddddddddd'
const STUDIO_2 = 'eeeeeeeeeeeeeeeeeeeeeeee'
const URL = `https://cad.onshape.com/documents/${D}/w/${W}/e/${ASSEMBLY}`
const link = { documentId: D, wvm: 'w' as const, wvmId: W, elementId: ASSEMBLY }
const ask = (id: string, part_number = '4096-26-INT-001') => ({ id, part_number })

describe('partNumbersRequest', () => {
  it('lets student leaders, mentors and admins write team numbers into a workspace', () => {
    for (const role of ['leader', 'mentor', 'admin']) {
      expect(partNumbersRequest({ kind: 'part-numbers', url: URL, parts: [ask(`${D}/${STUDIO}/JHD`)] }, role)).toEqual({
        link,
        parts: [{ onshape_id: `${D}/${STUDIO}/JHD`, documentId: D, elementId: STUDIO, partId: 'JHD', configuration: null, part_number: '4096-26-INT-001' }],
      })
    }
  })

  it('refuses students, version links, and anything but team numbers for Onshape parts', () => {
    const one = [ask(`${D}/${STUDIO}/JHD`)]
    const refused: [unknown, string, number, string | RegExp][] = [
      [{ url: URL, parts: one }, 'student', 403, /Only student leaders and mentors/],
      [{ url: URL.replace('/w/', '/v/'), parts: one }, 'mentor', 400, /link is to a version/],
      [{ url: URL.replace('/w/', '/m/'), parts: one }, 'mentor', 400, /link is to a version/],
      [{ url: 'https://example.com/documents', parts: one }, 'mentor', 400, /isn't a link/],
      [{ url: URL, parts: [] }, 'mentor', 400, /1 to 100 parts/],
      [{ url: URL, parts: Array.from({ length: MOST_NUMBERS + 1 }, (_, i) => ask(`${D}/${STUDIO}/J${i}`)) }, 'mentor', 400, /1 to 100 parts/],
      [{ url: URL, parts: [ask('../../account')] }, 'mentor', 400, /isn't a part from Onshape/],
      [{ url: URL, parts: [ask(`${D}/${STUDIO}/JHD`, 'BRKT-1')] }, 'mentor', 400, /isn't a team part number/],
      [{ url: URL, parts: [ask(`${D}/${STUDIO}/JHD`, '4096-26-INT-001; rm')] }, 'mentor', 400, /isn't a team part number/],
      [{ url: URL, parts: [...one, ...one] }, 'mentor', 400, /sent twice/],
      [null, 'mentor', 400, /isn't a link/],
    ]
    for (const [body, role, status, error] of refused) {
      expect(partNumbersRequest(body, role), JSON.stringify(body).slice(0, 80)).toEqual({ status, error: expect.stringMatching(error) })
    }
  })
})

describe('skipReason', () => {
  it("skips parts from another document, items that aren't parts, and parts with configurations", () => {
    const part = (more: Partial<NumberAsk>): NumberAsk => ({ onshape_id: 'x', documentId: D, elementId: STUDIO, partId: 'JHD', configuration: null, part_number: '4096-26-INT-001', ...more })
    const cases: [Partial<NumberAsk>, RegExp | null][] = [
      [{}, null],
      [{ documentId: 'ffffffffffffffffffffffff' }, /another Onshape document/],
      [{ elementId: 'item' }, /isn't a part in a Part Studio/],
      [{ configuration: 'size=10-32' }, /configurations/],
    ]
    for (const [more, reason] of cases) {
      const found = skipReason(part(more), link)
      if (reason) expect(found, JSON.stringify(more)).toMatch(reason)
      else expect(found).toBeNull()
    }
  })
})

/** A made-up Onshape: each Part Studio's parts and their Part numbers. It records every call. */
function fakeOnshape(studios: Record<string, { partId: string; partNumber: string | null }[]>, writeStatus = 200) {
  const calls: { method: string; url: string; body?: unknown }[] = []
  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    calls.push({ method, url: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined })
    if (method === 'POST') return new Response('{}', { status: writeStatus })
    const studio = Object.keys(studios).find((id) => String(url).includes(`/e/${id}`))
    return studio ? Response.json(studios[studio]) : new Response('', { status: 404 })
  }) as unknown as typeof globalThis.fetch
  return { calls, read: createOnshape('access', 'secret', fetch), write: createOnshapeWriter('access', 'secret', fetch), fetch }
}

const request = (...parts: { id: string; part_number: string }[]) => {
  const asked = partNumbersRequest({ url: URL, parts }, 'leader')
  if ('error' in asked) throw new Error(asked.error)
  return asked
}

describe('writePartNumbers', () => {
  it("reads each Part Studio once, writes only the numbers that differ, and says what it couldn't write", async () => {
    const onshape = fakeOnshape({
      [STUDIO]: [{ partId: 'JHD', partNumber: '' }, { partId: 'JID', partNumber: '4096-26-INT-002' }, { partId: 'JJD', partNumber: 'BRKT-1' }],
      [STUDIO_2]: [{ partId: 'JKD', partNumber: null }],
    })
    const result = await writePartNumbers(
      request(
        ask(`${D}/${STUDIO}/JHD`, '4096-26-INT-001'), // empty in Onshape: written
        ask(`${D}/${STUDIO}/JID`, '4096-26-INT-002'), // already matches
        ask(`${D}/${STUDIO}/JJD`, '4096-26-INT-003'), // different: written
        ask(`${D}/${STUDIO}/GONE`, '4096-26-INT-004'), // deleted in Onshape
        ask(`${D}/${STUDIO_2}/JKD`, '4096-26-INT-005'), // another Part Studio: written
        ask(`ffffffffffffffffffffffff/${STUDIO}/JLD`, '4096-26-INT-006'), // another document
        ask(`${D}/${STUDIO}/JMD?size=2`, '4096-26-INT-007'), // configured
      ),
      onshape.read,
      onshape.write,
    )
    expect(result).toEqual({
      ok: true,
      answer: {
        written: 3,
        unchanged: 1,
        skipped: [
          { onshape_id: `ffffffffffffffffffffffff/${STUDIO}/JLD`, reason: expect.stringMatching(/another Onshape document/) },
          { onshape_id: `${D}/${STUDIO}/JMD?size=2`, reason: expect.stringMatching(/configurations/) },
          { onshape_id: `${D}/${STUDIO}/GONE`, reason: expect.stringMatching(/isn't in its Part Studio any more/) },
        ],
      },
    })
    // Two reads (one per Part Studio), then one write for each part that changes, in the workspace.
    const studioLink = (elementId: string) => ({ ...link, elementId })
    expect(onshape.calls.map((c) => [c.method, c.url])).toEqual([
      ['GET', `https://cad.onshape.com${paths.parts(studioLink(STUDIO))}`],
      ['POST', `https://cad.onshape.com${partMetadataPath(link, STUDIO, 'JHD')}`],
      ['POST', `https://cad.onshape.com${partMetadataPath(link, STUDIO, 'JJD')}`],
      ['GET', `https://cad.onshape.com${paths.parts(studioLink(STUDIO_2))}`],
      ['POST', `https://cad.onshape.com${partMetadataPath(link, STUDIO_2, 'JKD')}`],
    ])
    expect(partMetadataPath(link, STUDIO, 'JHD')).toBe(`/api/v6/metadata/d/${D}/w/${W}/e/${STUDIO}/p/JHD`)
    expect(onshape.calls[1].body).toEqual({ properties: [{ propertyId: PART_NUMBER_PROPERTY, value: '4096-26-INT-001' }] })
    expect(onshape.fetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ Authorization: `Basic ${btoa('access:secret')}` }),
    }))
  })

  it("stops when Onshape won't take a change, and says how many it wrote and what a mentor should check", async () => {
    const parts = [{ partId: 'JHD', partNumber: '' }, { partId: 'JID', partNumber: '' }]
    const refused = fakeOnshape({ [STUDIO]: parts }, 403)
    expect(await writePartNumbers(request(ask(`${D}/${STUDIO}/JHD`)), refused.read, refused.write)).toEqual({
      ok: false, status: 403, error: expect.stringMatching(/Write to your documents/),
    })

    // The first write works, the second doesn't.
    const halfway = fakeOnshape({ [STUDIO]: parts })
    const write = vi.fn(halfway.write).mockImplementationOnce(halfway.write).mockImplementationOnce(async () => ({ ok: false, status: 502, error: 'Onshape had a problem (500).' }))
    expect(await writePartNumbers(request(ask(`${D}/${STUDIO}/JHD`, '4096-26-INT-001'), ask(`${D}/${STUDIO}/JID`, '4096-26-INT-002')), halfway.read, write)).toEqual({
      ok: false, status: 502, error: 'Wrote 1 part number, then Onshape said no: Onshape had a problem (500).',
    })

    // Can't reach Onshape at all.
    const offline = createOnshapeWriter('a', 's', vi.fn(async () => { throw new TypeError('offline') }) as unknown as typeof fetch)
    expect(await offline('/x', {})).toMatchObject({ ok: false, error: expect.stringMatching(/Couldn't reach/) })
  })
})
