import type { ModuleDefinition } from '../../core/registry'
import { usePitSummary } from './data'

export const status: ModuleDefinition = {
  id: 'status',
  // The folder and id stay "status", so links and other code keep working.
  name: 'Pit checklist',
  purpose: 'Get the robot ready for each of our matches: your items, everyone’s progress, and a display for the pit TV.',
  group: 'competition',
  load: () => import('./StatusPage'),
  // In the Competition menu, under Pit checklist. StatusPage reads which is open.
  pages: [
    { name: 'Checklist', path: '' },
    { name: 'Pit display', path: 'display' },
  ],
  useSummary: usePitSummary,
}
