import { ComingSoon } from '../../core/ui'

// Placeholder until someone builds this module. See README.md in this folder.
// When you start, replace this whole file with the real page.
export default function ScoutingPage() {
  return (
    <ComingSoon
      id="scouting"
      name="Scouting"
      goal="Match scouting for events. It has to work with no Wi-Fi: entries save on the device and sync when there is a connection."
      mustHave={[
        "A form for one robot in one match, with big buttons for phones",
        "Entries save on the device first and sync later",
        "A QR code for a waiting entry, so another device can copy it with no network",
        "The match schedule from The Blue Alliance",
        "The form's fields come from a season settings file, so a new game means new settings, not new code",
        "Export entries as CSV",
      ]}
    />
  )
}
