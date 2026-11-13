// Tests for the onshape server function's part files (#24,
// supabase/functions/onshape/files.ts), with a made-up Onshape: no real
// network. The made-up answers have the shape of Onshape's, cut down to
// what we read.
import { describe, expect, it, vi } from 'vitest'
import {
  createOnshapeFiles, fileRequest, filePaths, isOnshapeServer, looksLike, MOST_BYTES, partSource, readTranslation, STEP_WAITS, stepTranslation, type FilePart, type PartSource,
} from '../functions/onshape/files.ts'
import { exampleFile } from '../../src/modules/bom/files.ts'

const D = 'aaaaaaaaaaaaaaaaaaaaaaaa'
const W = 'bbbbbbbbbbbbbbbbbbbbbbbb'
const E = 'cccccccccccccccccccccccc'
const PART_ID = '00000000-0000-4000-8000-0000000b1002'
const link = { documentId: D, wvm: 'w' as const, wvmId: W, elementId: E }
const row: FilePart = { name: 'Roller shaft', onshape_url: `https://cad.onshape.com/documents/${D}/w/${W}/e/${E}`, onshape_id: `${D}/${E}/JHD`, removed_in_onshape: false }
const source: PartSource = { link, partId: 'JHD', configuration: null }

const bytes = async (format: 'step' | 'stl') => new Uint8Array(await exampleFile(format).arrayBuffer())

describe('fileRequest', () => {
  it('allows a part (by its id in the BOM) and STEP or STL, and nothing else', () => {
    expect(fileRequest({ kind: 'file', part: PART_ID, format: 'step' })).toEqual({ part: PART_ID, format: 'step' })
    expect(fileRequest({ kind: 'file', part: PART_ID, format: 'stl' })).toEqual({ part: PART_ID, format: 'stl' })
    const refused = [
      { kind: 'file', part: PART_ID, format: 'dxf' },
      { kind: 'file', part: PART_ID, format: 'exe' },
      { kind: 'file', part: "x' or 1=1", format: 'stl' },
      { kind: 'file', format: 'stl' },
      { kind: 'bom', part: PART_ID, format: 'stl' },
      null,
    ]
    for (const body of refused) expect(fileRequest(body), JSON.stringify(body)).toHaveProperty('error')
  })
})

describe('partSource', () => {
  it("finds the part in its Part Studio from the BOM's columns, or says why it can't", () => {
    expect(partSource(row)).toEqual(source)
    expect(partSource({ ...row, onshape_id: `${D}/${E}/JHD?size=large` })).toEqual({ ...source, configuration: 'size=large' })
    const cases: [FilePart | null, RegExp][] = [
      [null, /isn't in the BOM/],
      [{ ...row, removed_in_onshape: true }, /removed in Onshape/],
      [{ ...row, onshape_id: null }, /Import its system/],
      [{ ...row, onshape_url: 'https://example.com/part' }, /Import its system/],
      // An id from a different tab than its link: don't guess.
      [{ ...row, onshape_id: `${D}/${'d'.repeat(24)}/JHD` }, /Import its system/],
    ]
    for (const [part, error] of cases) expect(partSource(part), JSON.stringify(part)).toMatchObject({ error: expect.stringMatching(error) })
  })
})

describe('filePaths', () => {
  it('asks for a binary STL in millimeters, and starts a STEP for just that part', () => {
    expect(filePaths.stl(source)).toBe(`/api/v6/partstudios/d/${D}/w/${W}/e/${E}/stl?partIds=JHD&mode=binary&units=millimeter&grouping=true`)
    expect(filePaths.stl({ ...source, configuration: 'size=large' })).toContain('&configuration=size%3Dlarge')
    expect(filePaths.translate(source)).toBe(`/api/v6/partstudios/d/${D}/w/${W}/e/${E}/translations`)
    expect(stepTranslation(source)).toEqual({ formatName: 'STEP', partIds: 'JHD', storeInDocument: false })
    expect(stepTranslation({ ...source, configuration: 'size=large' })).toMatchObject({ configuration: 'size=large' })
    expect(filePaths.download(D, 'f1')).toBe(`/api/v6/documents/d/${D}/externaldata/f1`)
  })
})

describe('readTranslation', () => {
  it('reads whether a STEP is still being made, done (and where), or failed', () => {
    const cases: [unknown, unknown][] = [
      [{ id: 't1', requestState: 'ACTIVE' }, { state: 'active', id: 't1' }],
      [{ id: 't1', requestState: 'DONE', resultExternalDataIds: ['f1'], resultDocumentId: 'r1' }, { state: 'done', documentId: 'r1', fileId: 'f1' }],
      [{ id: 't1', requestState: 'DONE', resultExternalDataIds: ['f1'] }, { state: 'done', documentId: D, fileId: 'f1' }],
      [{ id: 't1', requestState: 'FAILED', failureReason: 'Part is empty' }, { state: 'failed', reason: 'Part is empty' }],
      [{ id: 't1', requestState: 'DONE', resultExternalDataIds: [] }, { state: 'failed', reason: 'no reason given' }],
      [null, { state: 'failed', reason: 'no reason given' }],
    ]
    for (const [answer, expected] of cases) expect(readTranslation(answer, D), JSON.stringify(answer)).toEqual(expected)
  })
})

describe('looksLike', () => {
  it('only passes on a real STEP or STL, never an error page', async () => {
    const text = (t: string) => new TextEncoder().encode(t)
    const cases: ['step' | 'stl', Uint8Array, boolean][] = [
      ['step', await bytes('step'), true],
      ['stl', await bytes('stl'), true],
      ['stl', text('solid part\n facet normal 0 0 1\n endfacet\nendsolid part\n'), true],
      ['stl', (await bytes('stl')).slice(0, 200), false], // cut short
      ['step', await bytes('stl'), false],
      ['stl', text('{"message":"Not found"}'), false],
      ['step', text('<html>Sign in</html>'), false],
    ]
    for (const [format, file, expected] of cases) expect(looksLike(format, file), `${format} ${file.length}`).toBe(expected)
  })
})

describe('isOnshapeServer', () => {
  it("only sends the keys on to Onshape's own servers, over https", () => {
    const cases: [string, boolean][] = [
      ['https://cad.onshape.com/api/x', true],
      ['https://cad-usw2.onshape.com/api/x', true],
      ['http://cad.onshape.com/api/x', false],
      ['https://onshape.com.evil.example/api/x', false],
      ['https://evilonshape.com/api/x', false],
      ['not a url', false],
    ]
    for (const [address, expected] of cases) expect(isOnshapeServer(address), address).toBe(expected)
  })
})

/** A made-up Onshape: each call gets the next answer, and the calls are kept to check. */
function fakeOnshape(...answers: (Response | (() => Response))[]) {
  const get = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => {
    const next = answers.shift()
    if (!next) throw new Error('Onshape was called more times than expected')
    return typeof next === 'function' ? next() : next
  })
  const wait = vi.fn(async () => {})
  return { get, wait, partFile: createOnshapeFiles('access', 'secret', get as unknown as typeof fetch, wait) }
}
const file = (data: Uint8Array) => new Response(new Blob([data as Uint8Array<ArrayBuffer>]), { status: 200 })
const moved = (to: string) => new Response(null, { status: 307, headers: { Location: to } })

describe('createOnshapeFiles', () => {
  it('fetches an STL in one call, following Onshape to its other server with the keys', async () => {
    const stl = await bytes('stl')
    const { get, partFile } = fakeOnshape(moved('https://cad-usw2.onshape.com/api/v6/partstudios/x/stl'), file(stl))
    const answer = await partFile(source, 'stl')
    expect(answer).toMatchObject({ ok: true, calls: 2 })
    expect(answer.ok && answer.bytes).toEqual(stl)
    expect(get.mock.calls.map(([url]) => url)).toEqual([`https://cad.onshape.com${filePaths.stl(source)}`, 'https://cad-usw2.onshape.com/api/v6/partstudios/x/stl'])
    for (const [, init] of get.mock.calls) {
      expect(init).toMatchObject({ redirect: 'manual', headers: { Authorization: `Basic ${btoa('access:secret')}` } })
    }
  })

  it("never sends the keys anywhere but Onshape", async () => {
    const { get, partFile } = fakeOnshape(moved('https://files.example.com/part.stl'))
    expect(await partFile(source, 'stl')).toMatchObject({ ok: false, error: expect.stringMatching(/somewhere unexpected/) })
    expect(get).toHaveBeenCalledTimes(1)
  })

  it('makes a STEP: starts it, checks until done, then fetches it', async () => {
    const step = await bytes('step')
    const { get, wait, partFile } = fakeOnshape(
      Response.json({ id: 't1', requestState: 'ACTIVE' }),
      Response.json({ id: 't1', requestState: 'ACTIVE' }),
      Response.json({ id: 't1', requestState: 'DONE', resultExternalDataIds: ['f1'], resultDocumentId: D }),
      file(step),
    )
    const answer = await partFile(source, 'step')
    expect(answer).toMatchObject({ ok: true, calls: 4 })
    expect(wait).toHaveBeenCalledTimes(2)
    const [start, check] = get.mock.calls
    expect(start[0]).toBe(`https://cad.onshape.com${filePaths.translate(source)}`)
    expect(start[1]).toMatchObject({ method: 'POST', body: JSON.stringify(stepTranslation(source)) })
    expect(check[0]).toBe('https://cad.onshape.com/api/v6/translations/t1')
    expect(get.mock.calls[3][0]).toBe(`https://cad.onshape.com${filePaths.download(D, 'f1')}`)
  })

  it('says what went wrong in words, and gives up on a STEP that takes too long', async () => {
    const active = () => Response.json({ id: 't1', requestState: 'ACTIVE' })
    const slow = fakeOnshape(...Array.from({ length: STEP_WAITS.length + 1 }, () => active))
    expect(await slow.partFile(source, 'step')).toMatchObject({ ok: false, status: 504, error: expect.stringMatching(/taking too long/), calls: STEP_WAITS.length + 1 })

    const cases: [Response[], 'step' | 'stl', RegExp][] = [
      [[new Response('', { status: 404 })], 'stl', /can't find that part/],
      [[new Response('', { status: 403 })], 'stl', /Share the document/],
      [[new Response('', { status: 429 })], 'step', /slow down/],
      [[Response.json({ id: 't1', requestState: 'FAILED', failureReason: 'Part is empty' })], 'step', /couldn't make the STEP \(Part is empty\)/],
      [[Response.json({ message: 'not a file' })], 'stl', /didn't send a STL/],
      [[new Response(new Uint8Array(10), { headers: { 'Content-Length': String(MOST_BYTES + 1) } })], 'stl', /bigger than 20 MB/],
    ]
    for (const [answers, format, error] of cases) {
      expect(await fakeOnshape(...answers).partFile(source, format), String(error)).toMatchObject({ ok: false, error: expect.stringMatching(error) })
    }
    const offline = createOnshapeFiles('a', 's', vi.fn(async () => { throw new TypeError('offline') }))
    expect(await offline(source, 'stl')).toMatchObject({ ok: false, error: expect.stringMatching(/Couldn't reach/) })
  })

  it('stops reading a file as soon as it grows past the limit, even without a size given', async () => {
    let sent = 0
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        sent += 1024 * 1024
        controller.enqueue(new Uint8Array(1024 * 1024))
      },
    })
    const { partFile } = fakeOnshape(new Response(endless))
    expect(await partFile(source, 'stl')).toMatchObject({ ok: false, status: 413 })
    expect(sent).toBeLessThan(MOST_BYTES + 3 * 1024 * 1024)
  })
})
