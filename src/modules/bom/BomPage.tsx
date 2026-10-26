import { ComingSoon } from '../../core/ui'

// Placeholder until someone builds this module. See README.md in this folder.
// When you start, replace this whole file with the real page.
export default function BomPage() {
  return (
    <ComingSoon
      id="bom"
      name="BOM"
      goal="The bill of materials for each Onshape assembly, checked against Inventory, so the team can see what to make and what to order."
      mustHave={[
        "The parts each assembly needs, from Onshape",
        "For bought parts: how many are on the shelf (from Inventory), and whether we're short",
        "For made parts: whether they have been made yet",
        "Mentors mark short parts as ordered",
        "Costs, visible only to mentors and admins",
      ]}
    />
  )
}
