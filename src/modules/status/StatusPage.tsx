import { ComingSoon } from '../../core/ui'

// Placeholder until someone builds this module. See README.md in this folder.
// When you start, replace this whole file with the real page.
export default function StatusPage() {
  return (
    <ComingSoon
      id="status"
      name="Robot status"
      goal="Where each subsystem stands, and what has to happen before the next event."
      mustHave={[
        "A grid of subsystems by stage: design, built, wired, programmed, tested",
        "A pit checklist for event day",
        "Tiles showing each other module's summary (low stock, short BOM lines, and so on)",
        "A big-screen view for the pit TV",
      ]}
    />
  )
}
