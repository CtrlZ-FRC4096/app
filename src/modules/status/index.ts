import type { ModuleDefinition } from '../../core/registry'
import { usePitSummary } from './data'

export const status: ModuleDefinition = {
  id: 'status',
  name: 'Robot status',
  purpose: 'Where each subsystem stands, and the pit checklist.',
  group: 'competition',
  load: () => import('./StatusPage'),
  useSummary: usePitSummary,
}
