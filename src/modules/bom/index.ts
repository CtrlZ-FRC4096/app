import type { ModuleDefinition } from '../../core/registry'

export const bom: ModuleDefinition = {
  id: 'bom',
  name: 'BOM',
  purpose: 'The bill of materials from Onshape, checked against the shelf.',
  load: () => import('./BomPage'),
  // Replace this with a hook from data.ts once the module has data, such
  // as "3 parts low". See useNoteSummary in the Example module.
  useSummary: () => ({ tone: 'plain', text: 'Not built yet' }),
}
