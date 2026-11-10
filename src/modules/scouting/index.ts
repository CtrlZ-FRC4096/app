import type { ModuleDefinition } from '../../core/registry'
import { useEntrySummary } from './data'

export const scouting: ModuleDefinition = {
  id: 'scouting',
  name: 'Scouting',
  purpose: 'Match scouting that works without Wi-Fi.',
  group: 'competition',
  load: () => import('./ScoutingPage'),
  useSummary: useEntrySummary,
}
