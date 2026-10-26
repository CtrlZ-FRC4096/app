import type { ModuleDefinition } from '../../core/registry'

export const status: ModuleDefinition = {
  id: 'status',
  name: 'Robot status',
  purpose: 'Where each subsystem stands, and the pit checklist.',
  load: () => import('./StatusPage'),
  // Replace this with a real summary once the module has data,
  // such as "3 parts low". See the Example module.
  summary: () => ({ tone: 'plain', text: 'Not built yet' }),
}
