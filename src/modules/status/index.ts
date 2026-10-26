import type { ModuleDefinition } from '../../core/registry'

export const status: ModuleDefinition = {
  id: 'status',
  name: 'Robot status',
  purpose: 'Where each subsystem stands, and the pit checklist.',
  load: () => import('./StatusPage'),
  // Replace this with a hook from data.ts once the module has data, such
  // as "3 parts low". See useNoteSummary in the Example module.
  useSummary: () => ({ tone: 'plain', text: 'Not built yet' }),
}
