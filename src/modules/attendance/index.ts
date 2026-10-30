import type { ModuleDefinition } from '../../core/registry'
import { useAttendanceAttention, useAttendanceSummary } from './data'

export const attendance: ModuleDefinition = {
  id: 'attendance',
  name: 'Attendance',
  purpose: 'Your points and hours, from the Slack poll and Jibble.',
  group: 'team',
  // Everyone can open it, but only mentors and admins see other people's
  // attendance: it's personal information. The database's rules enforce that.
  load: () => import('./AttendancePage'),
  useSummary: useAttendanceSummary,
  useAttention: useAttendanceAttention,
}
