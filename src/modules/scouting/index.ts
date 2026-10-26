import type { ModuleDefinition } from '../../core/registry'

export const scouting: ModuleDefinition = {
  id: 'scouting',
  name: 'Scouting',
  purpose: 'Match scouting that works without Wi-Fi.',
  load: () => import('./ScoutingPage'),
  // Replace this with a real summary once the module has data,
  // such as "3 parts low". See the Example module.
  summary: () => ({ tone: 'plain', text: 'Not built yet' }),
}
