// Tells the app about this module. It's listed in src/modules/index.ts.
import type { ModuleDefinition } from '../../core/registry'
import { useCncSummary } from './data'

export const cnc: ModuleDefinition = {
  id: 'cnc',
  name: 'CNC',
  purpose: 'What needs cutting on the router, the sheets on the rack, and where every part came out of each.',
  group: 'build',
  load: () => import('./CncPage'),
  useSummary: useCncSummary,
}
