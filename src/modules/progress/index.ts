// Tells the app about this module. It's in the list in src/modules/index.ts.
import type { ModuleDefinition } from '../../core/registry'

export const progress: ModuleDefinition = {
  id: 'progress',
  name: 'Build progress',
  purpose: 'Where each subsystem stands, from design to tested.',
  group: 'build',
  load: () => import('./ProgressPage'),
}
