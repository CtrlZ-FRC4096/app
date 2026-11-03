import type { ModuleDefinition } from '../../core/registry'
import { useLowStockAttention, useLowStockSummary } from './data'

export const inventory: ModuleDefinition = {
  id: 'inventory',
  name: 'Inventory',
  purpose: 'Parts, where they live and how many are left.',
  group: 'build',
  load: () => import('./InventoryPage'),
  useSummary: useLowStockSummary,
  useAttention: useLowStockAttention,
}
