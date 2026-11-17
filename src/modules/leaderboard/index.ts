// Tells the app about this module. It's listed in src/modules/index.ts.
import type { ModuleDefinition } from '../../core/registry'

export const leaderboard: ModuleDefinition = {
  id: 'leaderboard',
  name: 'Leaderboards',
  purpose: 'Which students have solved the most issues and merged the most pull requests in the team app.',
  group: 'software',
  load: () => import('./LeaderboardPage'),
}
