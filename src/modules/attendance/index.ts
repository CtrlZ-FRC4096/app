import type { ModuleDefinition } from '../../core/registry'
import { useAttendanceAttention, useAttendanceSummary } from './data'

export const attendance: ModuleDefinition = {
  id: 'attendance',
  name: 'Attendance',
  purpose: 'Who came, for how long, and attendance points, from the Slack poll and Jibble.',
  group: 'team',
  // Attendance is personal information about students. The database's rules enforce this too.
  roles: ['mentor', 'admin'],
  load: () => import('./AttendancePage'),
  useSummary: useAttendanceSummary,
  useAttention: useAttendanceAttention,
}
