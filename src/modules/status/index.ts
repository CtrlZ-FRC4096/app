import type { ModuleDefinition } from '../../core/registry'
import { usePitSummary } from './data'

export const status: ModuleDefinition = {
  id: 'status',
  // The folder and id stay "status", so links and other code keep working.
  name: 'Pit checklist',
  purpose: 'Get the robot ready for each of our matches: your items, and everyone’s progress.',
  group: 'competition',
  load: () => import('./StatusPage'),
  useSummary: usePitSummary,
}
