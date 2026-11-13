// Tells the app about this module. It's listed in src/modules/index.ts.
import type { ModuleDefinition } from '../../core/registry'
import { usePurchasingSummary } from './data'

export const purchasing: ModuleDefinition = {
  id: 'purchasing',
  name: 'Purchasing',
  purpose: 'What the team needs to buy, from asking for it to it being in the shop. Replaces the BOM List in Slack.',
  group: 'build',
  load: () => import('./PurchasingPage'),
  useSummary: usePurchasingSummary,
  // Sent by supabase/migrations/..._notification_settings.sql.
  notifications: [
    { key: 'purchasing.request_updates', name: 'My requests', description: 'When something you asked for is ordered or arrives.', on: true },
  ],
}
