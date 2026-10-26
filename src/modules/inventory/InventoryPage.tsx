import { ComingSoon } from '../../core/ui'

// Placeholder until someone builds this module. See README.md in this folder.
// When you start, replace this whole file with the real page.
export default function InventoryPage() {
  return (
    <ComingSoon
      id="inventory"
      name="Inventory"
      goal="Parts, where they live, and how many are left, with a record of who took or added stock."
      mustHave={[
        "A list of parts with location, quantity and a low-stock level",
        "Take and add stock, recording who did it and when",
        "A low-stock flag, and a filter to show only low parts",
        "Search by name, bin or vendor",
        "A QR label for each bin that opens that part in the app",
        "Copy the list as CSV, so the data can always leave the app",
      ]}
    />
  )
}
