// Tells the app about this module. It's listed in src/modules/index.ts.
// No home page summary yet: step 1 only reads a log, and saves nothing.
import type { ModuleDefinition } from '../../core/registry'

export const robotLogs: ModuleDefinition = {
  id: 'robot-logs',
  name: 'Robot logs',
  purpose: "Open the robot's log after a match and see what's in it.",
  group: 'competition',
  load: () => import('./RobotLogsPage'),
}
