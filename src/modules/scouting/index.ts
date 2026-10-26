import type { ModuleDefinition } from '../../core/registry'

export const scouting: ModuleDefinition = {
  id: 'scouting',
  name: 'Scouting',
  purpose: 'Match scouting that works without Wi-Fi.',
  load: () => import('./ScoutingPage'),
  // Replace this with a hook from data.ts once the module has data, such
  // as "3 parts low". See useNoteSummary in the Example module.
  useSummary: () => ({ tone: 'plain', text: 'Not built yet' }),
}
