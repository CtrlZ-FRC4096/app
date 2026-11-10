import { PageHead } from '../../core/ui'
import { PitChecklist } from './PitChecklist'
import './status.css'

// The subsystem progress grid that used to be here is now its own module,
// Build progress (src/modules/progress/), under Build (#65).
export default function StatusPage() {
  return (
    <>
      <PageHead title="Robot status">
        The pit checklist to work through at events. Subsystem progress is now under Build › Build progress.
      </PageHead>
      <PitChecklist />
    </>
  )
}
