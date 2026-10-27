// Onshape, for the BOM: reads a system's parts from its assembly (with
// sub-assemblies flattened into one list) or Part Studio, so the app can
// import them. Needs the ONSHAPE_ACCESS_KEY and ONSHAPE_SECRET_KEY secrets;
// see "Server functions" in supabase/README.md. The app calls this through
// src/modules/bom/data.ts.
//
// Each import costs two Onshape API calls (which tab it is, then its
// parts), and Onshape limits calls per year, so the app only calls this
// when someone clicks Import.
import { forMembers, reply } from '../_shared/members.ts'
import { bomLines, createOnshape, onshapeRequest, partStudioLines, paths, type OnshapeBom } from './onshape.ts'

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
