import type { ModuleDefinition } from '../../core/registry'
import { useRosterSummary } from './data'

export const roster: ModuleDefinition = {
  id: 'roster',
  name: 'Roster',
  purpose: "Who's active this season, and their subteams.",
  group: 'team',
  roles: ['mentor', 'admin'],
  load: () => import('./RosterPage'),
  useSummary: useRosterSummary,
}
