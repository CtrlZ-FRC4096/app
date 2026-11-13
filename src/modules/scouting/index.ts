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
    { name: 'Overview', path: '' },
    { name: 'Match', path: 'match' },
    { name: 'Pit', path: 'pit' },
    { name: 'Schedule', path: 'schedule' },
    { name: 'Rankings', path: 'rankings' },
    { name: 'Teams', path: 'team' },
    { name: 'Picklist', path: 'picklist' },
    { name: 'Final picklist', path: 'shared-picklist' },
    { name: 'Simulator', path: 'simulate' },
    { name: 'Stats', path: 'stats' },
  ],
  useSummary: useEntrySummary,
}
