// Onshape, for the BOM and the CNC router. Needs the ONSHAPE_ACCESS_KEY and
// ONSHAPE_SECRET_KEY secrets; see "Server functions" in supabase/README.md.
//
// - bom: a system's parts from its assembly (with sub-assemblies flattened
//   into one list) or Part Studio, so the app can import them. Called
//   through src/modules/bom/data.ts. Two Onshape API calls: which tab it
//   is, then its parts.
// - shapes: parts' sizes and outlines, for the CNC module. One call for
//   the Part Studio's part versions, then one per part that changed since
//   the app last read it.
// - layout: where each part sits in a sheet's layout assembly, for the CNC
//   module. One call.
//
// Onshape limits calls per year, so the app only calls this when someone
// clicks a button, and keeps what it gets.
import { forMembers, reply } from '../_shared/members.ts'
import {
  bomLines,
  createOnshape,
  layoutPlacements,
  onshapeRequest,
  partStudioLines,
  partVersions,
  paths,
  type OnshapeBom,
  type OnshapeLayout,
  type OnshapeShapes,
} from './onshape.ts'
import { readEdges, shapeFromEdges } from './shape.ts'

const accessKey = Deno.env.get('ONSHAPE_ACCESS_KEY') ?? ''
const secretKey = Deno.env.get('ONSHAPE_SECRET_KEY') ?? ''
const onshape = createOnshape(accessKey, secretKey)

export default {
  fetch: forMembers(async (req) => {
    if (!accessKey || !secretKey) {
      return reply({ error: "The Onshape keys aren't set up yet. A mentor adds ONSHAPE_ACCESS_KEY and ONSHAPE_SECRET_KEY: see supabase/README.md." }, 503)
    }
    const request = onshapeRequest(await req.json().catch(() => null))
    if ('error' in request) return reply({ error: request.error }, 400)

    if (request.kind === 'check') {
      const answer = await onshape(paths.check)
      return answer.ok ? reply({ ok: true }) : reply({ error: answer.error }, answer.status)
    }

    if (request.kind === 'layout') {
      const answer = await onshape(paths.assembly(request.link))
      if (!answer.ok) {
        const error = answer.status === 404 ? "Onshape can't find that assembly. Check the sheet's layout link: it should be an assembly tab." : answer.error
        return reply({ error }, answer.status)
      }
      return reply({ placements: layoutPlacements(answer.data) } satisfies OnshapeLayout)
    }

    if (request.kind === 'shapes') {
      const { link, parts } = request
      const listed = await onshape(paths.parts(link))
      if (!listed.ok) return reply({ error: listed.error }, listed.status)
      const versions = partVersions(listed.data)
      const answer: OnshapeShapes = { shapes: [], unchanged: [], missing: [] }
      for (const part of parts) {
        const version = versions.get(part.partId)
        if (version === undefined) {
          answer.missing.push(part.onshape_id)
          continue
        }
        if (part.known && version && part.known === version) {
          answer.unchanged.push(part.onshape_id)
          continue
        }
        const edges = await onshape(paths.edges(link, part))
        if (!edges.ok) {
          if (edges.status === 404) answer.missing.push(part.onshape_id)
          else return reply({ error: edges.error }, edges.status)
          continue
        }
        const shape = shapeFromEdges(readEdges(edges.data), part.onshape_id, version || null)
        if (shape) answer.shapes.push(shape)
        else answer.missing.push(part.onshape_id)
      }
      return reply(answer)
    }

    const { link } = request
    const element = await onshape(paths.element(link))
    if (!element.ok) return reply({ error: element.error }, element.status)
    const tab = (Array.isArray(element.data) ? element.data : []).find((e: { id?: string }) => e.id === link.elementId) as
      | { name?: string; elementType?: string }
      | undefined
    if (!tab) return reply({ error: "Onshape can't find that tab. Check the system's Onshape link." }, 404)

    if (tab.elementType === 'ASSEMBLY') {
      const bom = await onshape(paths.bom(link))
      if (!bom.ok) return reply({ error: bom.error }, bom.status)
      return reply({ name: tab.name ?? 'Assembly', kind: 'assembly', lines: bomLines(bom.data, link) } satisfies OnshapeBom)
    }
    if (tab.elementType === 'PARTSTUDIO') {
      const parts = await onshape(paths.parts(link))
      if (!parts.ok) return reply({ error: parts.error }, parts.status)
      return reply({ name: tab.name ?? 'Part Studio', kind: 'partstudio', lines: partStudioLines(parts.data, link) } satisfies OnshapeBom)
    }
    return reply({ error: "That link is to a tab that isn't an assembly or Part Studio. Link the system's assembly instead." }, 400)
  }),
}
