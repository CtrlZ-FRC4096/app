import type { ModuleDefinition } from '../../core/registry'
import { useBomSummary } from './data'

export const bom: ModuleDefinition = {
  id: 'bom',
  name: 'BOM',
  purpose: 'The bill of materials from Onshape, checked against the shelf.',
  load: () => import('./BomPage'),
  useSummary: useBomSummary,
}
