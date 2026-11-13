// Tells the app about this module. It's in the list in src/modules/index.ts,
// just above Scouting, so it's first in the Competition menu.
import type { ModuleDefinition } from '../../core/registry'
import { useHiddenPrescouting } from './data'

export const prescouting: ModuleDefinition = {
  id: 'prescouting',
  name: 'Prescouting',
  purpose: 'Look up every team before an event, with our notes on each.',
  group: 'competition',
  load: () => import('./PrescoutPage'),
  // Strategy team and mentors only (#167): hidden from the menu and home page for anyone else.
  useHiddenPages: useHiddenPrescouting,
}
