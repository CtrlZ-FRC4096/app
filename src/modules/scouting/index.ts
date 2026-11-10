import type { ModuleDefinition } from '../../core/registry'
import { useEntrySummary } from './data'

export const scouting: ModuleDefinition = {
  id: 'scouting',
  name: 'Scouting',
  purpose: 'Match scouting that works without Wi-Fi.',
  group: 'competition',
  load: () => import('./ScoutingPage'),
  // In the Competition menu, under Scouting. ScoutingPage reads which is open.
  pages: [
    { name: 'Match', path: '' },
    { name: 'Pit', path: 'pit' },
    { name: 'Schedule', path: 'schedule' },
  ],
  useSummary: useEntrySummary,
}
