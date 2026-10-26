import type { ModuleDefinition } from '../../core/registry'

export const inventory: ModuleDefinition = {
  id: 'inventory',
  name: 'Inventory',
  purpose: 'Parts, where they live and how many are left.',
  load: () => import('./InventoryPage'),
  // Replace this with a real summary once the module has data,
  // such as "3 parts low". See the Example module.
  summary: () => ({ tone: 'plain', text: 'Not built yet' }),
}
