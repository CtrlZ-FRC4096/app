import type { ModuleDefinition } from '../../core/registry'
import { useFeedbackAttention, useFeedbackSummary } from './data'

export const feedback: ModuleDefinition = {
  id: 'feedback',
  name: 'Feedback',
  purpose: 'Ideas and problems anyone can send. Mentors keep the list tidy.',
  group: 'team',
  load: () => import('./FeedbackPage'),
  useSummary: useFeedbackSummary,
  useAttention: useFeedbackAttention,
}
