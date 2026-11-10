// Tells the app about this module. It's listed in src/modules/index.ts.
import type { ModuleDefinition } from '../../core/registry'
import { useBatterySummary } from './data'

export const batteries: ModuleDefinition = {
  id: 'batteries',
  name: 'Batteries',
  purpose: 'Which batteries are charged, charging or in the robot, for the pit.',
  group: 'competition',
  load: () => import('./BatteriesPage'),
  useSummary: useBatterySummary,
}
