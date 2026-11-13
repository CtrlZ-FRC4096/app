import type { ModuleDefinition } from '../../core/registry'
import { useRobotSummary } from './stats'

export const bom: ModuleDefinition = {
  id: 'bom',
  name: 'BOM',
  purpose: 'The bill of materials from Onshape, checked against the shelf.',
  group: 'build',
  load: () => import('./BomPage'),
  // "Robot 62% built" on the home page tile (#23).
  useSummary: useRobotSummary,
}
