import type { ModuleDefinition } from '../../core/registry'
import { usePitSummary } from './data'

export const status: ModuleDefinition = {
  id: 'status',
  name: 'Robot status',
  purpose: 'The pit checklist for event day.',
  group: 'competition',
  load: () => import('./StatusPage'),
  useSummary: usePitSummary,
}
