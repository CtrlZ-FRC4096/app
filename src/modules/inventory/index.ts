import type { ModuleDefinition } from '../../core/registry'

export const inventory: ModuleDefinition = {
  id: 'inventory',
  name: 'Inventory',
  purpose: 'Parts, where they live and how many are left.',
  load: () => import('./InventoryPage'),
  // Replace this with a hook from data.ts once the module has data, such
  // as "3 parts low". See useNoteSummary in the Example module.
  useSummary: () => ({ tone: 'plain', text: 'Not built yet' }),
}
