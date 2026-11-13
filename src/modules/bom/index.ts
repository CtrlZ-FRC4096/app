import type { ModuleDefinition } from '../../core/registry'
import { useBomSummary } from './data'
import { useMyWorkAttention } from './work'

export const bom: ModuleDefinition = {
  id: 'bom',
  name: 'BOM',
  purpose: 'The bill of materials from Onshape, checked against the shelf.',
  group: 'build',
  load: () => import('./BomPage'),
  useSummary: useBomSummary,
  // "3 stages to do (1 late)" for the signed-in person's stages (#16).
  useAttention: useMyWorkAttention,
}
