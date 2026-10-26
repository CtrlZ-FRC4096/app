import { ComingSoon } from '../../core/ui'

// Placeholder until someone builds this module. See README.md in this folder.
// When you start, replace this whole file with the real page.
export default function TrainingPage() {
  return (
    <ComingSoon
      id="training"
      name="Training"
      goal="The lessons live in the wiki. This keeps track of who has done them, and lets mentors sign off hands-on skills."
      mustHave={[
        "A list of lessons, each linking to its wiki page",
        "Students mark lessons done and see their progress",
        "Hands-on skills (shop safety, drill press, crimping) that a mentor signs off in person",
        "Students request a sign-off; mentors see the requests and sign off",
        "Mentors see everyone's progress",
      ]}
    />
  )
}
