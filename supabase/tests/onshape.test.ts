// Tests for what the onshape server function asks Onshape and how it reads
// the answers (supabase/functions/onshape/onshape.ts). The sample answers
// below have the shape of Onshape's API answers, cut down to what we read.
import { describe, expect, it, vi } from 'vitest'
import { bomLines, createOnshape, onshapeRequest, parseOnshapeLink, partStudioLines, paths } from '../functions/onshape/onshape.ts'

const D = 'aaaaaaaaaaaaaaaaaaaaaaaa'
const W = 'bbbbbbbbbbbbbbbbbbbbbbbb'
const E = 'cccccccccccccccccccccccc'
const URL = `https://cad.onshape.com/documents/${D}/w/${W}/e/${E}`
const link = { documentId: D, wvm: 'w' as const, wvmId: W, elementId: E }

describe('parseOnshapeLink', () => {
  it('reads the document, workspace and tab from an address', () => {
    expect(parseOnshapeLink(URL)).toEqual(link)
    expect(parseOnshapeLink(`${URL}?configuration=default&renderMode=0`)).toEqual(link)
    expect(parseOnshapeLink(` ${URL.replace('/w/', '/v/')} `)).toEqual({ ...link, wvm: 'v' })
  })

  it("refuses anything that isn't a tab on cad.onshape.com", () => {
    expect(parseOnshapeLink(`https://cad.onshape.com/documents/${D}`)).toBeNull()
    expect(parseOnshapeLink(URL.replace('cad.onshape.com', 'evil.example.com'))).toBeNull()
    expect(parseOnshapeLink(URL.replace('https', 'http'))).toBeNull()
    expect(parseOnshapeLink(URL.replace(E, `${E}/../x`))).toBeNull()
    expect(parseOnshapeLink(URL.replace(D, 'not-an-id'))).toBeNull()
  })
})

describe('onshapeRequest', () => {
  it('allows a key check, and a BOM from a link', () => {
    expect(onshapeRequest({ kind: 'check' })).toEqual({ kind: 'check' })
    expect(onshapeRequest({ kind: 'bom', url: URL })).toEqual({ kind: 'bom', link })
  })

  it('refuses anything else', () => {
    expect(onshapeRequest({ kind: 'delete' })).toHaveProperty('error')
    expect(onshapeRequest({ kind: 'bom', url: 'https://example.com' })).toHaveProperty('error')
    expect(onshapeRequest(null)).toHaveProperty('error')
  })

  it('asks for a flattened BOM, so sub-assemblies are one list', () => {
    expect(paths.bom(link)).toBe(`/api/v6/assemblies/d/${D}/w/${W}/e/${E}/bom?indented=false`)
    expect(paths.element(link)).toBe(`/api/v6/documents/d/${D}/w/${W}/elements?elementId=${E}`)
    expect(paths.parts(link)).toBe(`/api/v9/parts/d/${D}/w/${W}/e/${E}`)
  })
})

// Onshape's standard property IDs, as BOM headers use them.
const H = { name: '57f3fb8efa3416c06701d60d', number: '57f3fb8efa3416c06701d60f', revision: '57f3fb8efa3416c06701d610', quantity: '5ace84d3c046ad611c65a0dd', material: '57f3fb8efa3416c06701d615', vendor: '57f3fb8efa3416c06701d612' }
const BOM = {
  headers: [
    { id: H.name, name: 'Name', propertyName: 'name' },
    { id: H.number, name: 'Part number', propertyName: 'partNumber' },
    { id: H.revision, name: 'Revision', propertyName: 'revision' },
    { id: H.quantity, name: 'Quantity', propertyName: 'quantity' },
    { id: H.material, name: 'Material', propertyName: 'material' },
    { id: H.vendor, name: 'Vendor', propertyName: 'vendor' },
  ],
  rows: [
    {
      headerIdToValue: { [H.name]: 'Side plate', [H.number]: '4096-26-INT-001', [H.revision]: 'B', [H.quantity]: 2, [H.material]: { displayName: 'Aluminum - 6061', id: 'Aluminum - 6061' }, [H.vendor]: '' },
      itemSource: { documentId: D, elementId: 'dddddddddddddddddddddddd', partId: 'JHD', configuration: 'default', wvmType: 'w', wvmId: W, isStandardContent: false },
    },
    {
      headerIdToValue: { [H.name]: 'Socket head cap screw #10-32 x 0.5', [H.number]: '91251A340', [H.quantity]: 24, [H.material]: { displayName: 'Steel' } },
      itemSource: { documentId: 'eeeeeeeeeeeeeeeeeeeeeeee', elementId: 'ffffffffffffffffffffffff', partId: 'JFD', configuration: 'size=10-32', wvmType: 'v', wvmId: '111111111111111111111111', isStandardContent: true },
    },
    // A sub-assembly row has no part ID: its parts are listed on their own.
    { headerIdToValue: { [H.name]: 'Roller sub-assembly', [H.quantity]: 1 }, itemSource: { documentId: D, elementId: '222222222222222222222222' } },
    {
      headerIdToValue: { [H.name]: 'Roller shaft', [H.quantity]: '3', [H.vendor]: 'WCP', [H.number]: 'WCP-0271' },
      itemSource: { documentId: D, elementId: 'dddddddddddddddddddddddd', partId: 'JKD', wvmType: 'w', wvmId: W },
    },
  ],
}

describe('bomLines', () => {
  it('reads each part: name, number, revision, quantity, material, vendor and where it is', () => {
    const lines = bomLines(BOM, link)
    expect(lines).toHaveLength(3)
    expect(lines[0]).toEqual({
      onshape_id: `${D}/dddddddddddddddddddddddd/JHD`,
      name: 'Side plate',
      part_number: '4096-26-INT-001',
      revision: 'B',
      quantity: 2,
      material: 'Aluminum - 6061',
      vendor: null,
      standard: false,
      url: `https://cad.onshape.com/documents/${D}/w/${W}/e/dddddddddddddddddddddddd`,
    })
  })

  it('marks standard content as bought, and keeps configurations apart', () => {
    const [, screw] = bomLines(BOM, link)
    expect(screw).toMatchObject({ standard: true, quantity: 24, part_number: '91251A340', onshape_id: expect.stringContaining('?size=10-32') })
    expect(screw.url).toContain('/v/111111111111111111111111/')
  })

  it('skips sub-assembly rows, and reads quantities given as text', () => {
    const lines = bomLines(BOM, link)
    expect(lines.map((l) => l.name)).not.toContain('Roller sub-assembly')
    expect(lines[2]).toMatchObject({ name: 'Roller shaft', quantity: 3, vendor: 'WCP' })
  })

  it('finds columns by name when their IDs differ', () => {
    const renamed = { ...BOM, headers: BOM.headers.map((h, i) => ({ ...h, id: `x${i}` })), rows: [{ ...BOM.rows[0], headerIdToValue: Object.fromEntries(Object.values(BOM.rows[0].headerIdToValue).map((v, i) => [`x${i}`, v])) }] }
    expect(bomLines(renamed, link)[0]).toMatchObject({ name: 'Side plate', quantity: 2, material: 'Aluminum - 6061' })
  })

  it('adds up the same part listed twice, and copes with an empty answer', () => {
    const twice = { ...BOM, rows: [BOM.rows[0], BOM.rows[0]] }
    expect(bomLines(twice, link)[0].quantity).toBe(4)
    expect(bomLines(null, link)).toEqual([])
  })
})

describe('partStudioLines', () => {
  it('lists each solid part once, skipping surfaces and sketches', () => {
    const parts = [
      { name: 'Bracket', partId: 'JHD', partNumber: '', revision: null, material: { displayName: 'Aluminum - 6061' }, bodyType: 'solid' },
      { name: 'Surface 1', partId: 'JID', bodyType: 'sheet' },
      { name: 'Spacer', partId: 'JJD', partNumber: '4096-26-INT-009', bodyType: 'solid' },
    ]
    expect(partStudioLines(parts, link)).toEqual([
      expect.objectContaining({ onshape_id: `${D}/${E}/JHD`, name: 'Bracket', part_number: null, material: 'Aluminum - 6061', quantity: 1 }),
      expect.objectContaining({ onshape_id: `${D}/${E}/JJD`, name: 'Spacer', part_number: '4096-26-INT-009', material: null }),
    ])
  })
})

describe('createOnshape', () => {
  it('signs in with the keys, as Basic authorization', async () => {
    const fetch = vi.fn(async () => Response.json([]))
    await createOnshape('access', 'secret', fetch)('/api/v6/documents?limit=1')
    expect(fetch).toHaveBeenCalledWith('https://cad.onshape.com/api/v6/documents?limit=1', {
      headers: expect.objectContaining({ Authorization: `Basic ${btoa('access:secret')}` }),
    })
  })

  it('says what went wrong in words', async () => {
    const answer = (status: number) => createOnshape('a', 's', vi.fn(async () => new Response('', { status })))('/x')
    expect(await answer(401)).toMatchObject({ ok: false, status: 502, error: expect.stringMatching(/ONSHAPE_ACCESS_KEY/) })
    expect(await answer(403)).toMatchObject({ ok: false, status: 403, error: expect.stringMatching(/Share the document/) })
    expect(await answer(404)).toMatchObject({ ok: false, status: 404, error: expect.stringMatching(/Onshape link/) })
    expect(await answer(429)).toMatchObject({ ok: false, error: expect.stringMatching(/slow down/) })
    expect(await createOnshape('a', 's', vi.fn(async () => { throw new TypeError('offline') }))('/x')).toMatchObject({ ok: false, error: expect.stringMatching(/Couldn't reach/) })
  })
})
