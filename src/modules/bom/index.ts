import type { ModuleDefinition } from '../../core/registry'

export const bom: ModuleDefinition = {
  id: 'bom',
  name: 'BOM',
  purpose: 'The bill of materials from Onshape, checked against the shelf.',
  load: () => import('./BomPage'),
  // Replace this with a real summary once the module has data,
  // such as "3 parts low". See the Example module.
  summary: () => ({ tone: 'plain', text: 'Not built yet' }),
}
