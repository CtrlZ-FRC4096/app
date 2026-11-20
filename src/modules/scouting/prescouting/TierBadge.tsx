import type { Tier } from './data'

/**
 * A team's tier as a small badge (#191): "B", or "Tier B" when `long`.
 * Colours in prescouting.css. Its own file so the overview and the compare
 * page (#233) can both use it.
 */
export default function TierBadge(props: { tier: Tier; long?: boolean }) {
  return <span className="prescout-tier-badge" data-tier={props.tier} title={`Tier ${props.tier}`}>{props.long ? `Tier ${props.tier}` : props.tier}</span>
}
